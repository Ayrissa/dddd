/**
 * All network calls. Uses ONLY the extension's own API settings.
 * SillyTavern's own API connections / secrets are never read.
 */
import { getContext, getSettings, t, cleanText } from './core.js';
import { describeSystem, markersSystem } from './prompts.js';

const stripThink = s => String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

async function httpError(res) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
}

/* ------------------------------------------------ analysis (text) API */

export const llmConfigured = () => { const a = getSettings().llmApi; return !!(a.url && a.model); };

export function imageConfigured() {
    const a = getSettings().imageApi;
    return a.provider === 'gemini' ? !!(a.key && a.model) : !!(a.url && a.model);
}

function llmEndpoint(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!/\/chat\/completions$/i.test(u)) u += '/chat/completions';
    return u;
}

function llmHeaders(a, json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (a.key) h['Authorization'] = 'Bearer ' + a.key;
    return h;
}

export async function callLLM(messages, { signal, maxTokens, model } = {}) {
    const a = getSettings().llmApi;
    const res = await fetch(llmEndpoint(a.url), {
        method: 'POST',
        headers: llmHeaders(a),
        credentials: 'omit',
        signal,
        body: JSON.stringify({ model: model || a.model, messages, temperature: a.temperature, max_tokens: maxTokens ?? a.maxTokens, stream: false }),
    });
    if (!res.ok) throw await httpError(res);
    const j = await res.json();
    const c = j?.choices?.[0]?.message?.content;
    return Array.isArray(c) ? c.map(p => p?.text || '').join('') : String(c ?? '');
}

export async function loadLLMModels() {
    const a = getSettings().llmApi;
    const url = String(a.url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/models';
    const res = await fetch(url, { headers: llmHeaders(a, false), credentials: 'omit' });
    if (!res.ok) throw await httpError(res);
    const j = await res.json();
    return (j.data || j.models || []).map(x => x.id || x.name).filter(Boolean);
}

/* ------------------------------------------------ story material: chat + lorebooks + character card */

async function fetchBook(name) {
    const res = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`lorebook "${name}": HTTP ${res.status}`);
    const j = await res.json();
    return Object.values(j?.entries || {})
        .filter(e => e && !e.disable && e.content)
        .map(e => ({
            title: e.comment || (Array.isArray(e.key) ? e.key.join(', ') : ''),
            keys: [...(e.key || []), ...(e.keysecondary || [])],
            content: e.content,
            constant: !!e.constant,
        }));
}

/** Entries of the lorebook bound to the chat and the one bound to the character (plus an embedded one). */
async function collectLore(recentText, budget) {
    const ctx = getContext();
    const ch = ctx.characters?.[ctx.characterId];
    const names = new Set();
    const chatBook = ctx.chatMetadata?.world_info;
    const charBook = ch?.data?.extensions?.world;
    if (chatBook) names.add(chatBook);
    if (charBook) names.add(charBook);

    const entries = [];
    for (const name of names) {
        try { entries.push(...await fetchBook(name)); } catch (e) { console.warn('[SillyMap]', e); }
    }
    if (!charBook && Array.isArray(ch?.data?.character_book?.entries)) {
        for (const e of ch.data.character_book.entries) {
            if (e?.enabled === false || !e?.content) continue;
            entries.push({ title: e.comment || (e.keys || []).join(', '), keys: [...(e.keys || []), ...(e.secondary_keys || [])], content: e.content, constant: !!e.constant });
        }
    }
    if (!entries.length) return '';

    const low = recentText.toLowerCase();
    entries.forEach(e => { e.score = e.constant ? 2 : (e.keys.some(k => k && low.includes(String(k).toLowerCase())) ? 1 : 0); });
    entries.sort((x, y) => y.score - x.score);

    const lines = [];
    let used = 0;
    for (const e of entries) {
        const line = `- ${e.title ? e.title + ': ' : ''}${cleanText(e.content, 800)}`;
        if (used + line.length > budget) break;
        lines.push(line);
        used += line.length;
    }
    return lines.join('\n');
}

/** Builds the text material for the analysis model according to the "source" setting. */
async function buildMaterial() {
    const ctx = getContext();
    const s = getSettings();
    const chat = (ctx.chat || []).filter(m => !m.is_system).slice(-s.contextMessages);
    const history = chat.map(m => `${m.name}: ${cleanText(m.mes, 1500)}`).join('\n\n');
    const parts = [];

    if (s.source === 'chat_lore_card') {
        const ch = ctx.characters?.[ctx.characterId];
        const card = ch ? [
            ch.name ? `Name: ${ch.name}` : '',
            ch.description ? `Description: ${cleanText(ch.description, 1500)}` : '',
            ch.scenario ? `Scenario: ${cleanText(ch.scenario, 800)}` : '',
        ].filter(Boolean).join('\n') : '';
        if (card) parts.push('Character card:\n' + card);
    }
    if (s.source === 'chat_lore' || s.source === 'chat_lore_card') {
        const lore = await collectLore(chat.map(m => cleanText(m.mes, 3000)).join(' '), s.loreChars);
        if (lore) parts.push('Lorebook:\n' + lore);
    }
    parts.push('Recent chat:\n' + history);
    return parts.join('\n\n');
}

export async function describeFromChat(kind, signal) {
    const material = await buildMaterial();
    const out = await callLLM([
        { role: 'system', content: describeSystem(kind) },
        { role: 'user', content: `${material}\n\nWrite the description now.` },
    ], { signal });
    const text = stripThink(out);
    if (!text) throw new Error(t('emptyDesc'));
    return text;
}

/* ------------------------------------------------ vision: names and pins on the finished map */

async function imageForVision(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('fetch failed');
        const bmp = await createImageBitmap(await r.blob());
        const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k);
        c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.85);
    } catch {
        return new URL(url, location.origin).href;
    }
}

const MARKER_TYPES = ['place', 'hero', 'visited'];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function normalizeMarkers(raw, kind) {
    const list = (Array.isArray(raw?.markers) ? raw.markers : []).map(m => ({
        type: MARKER_TYPES.includes(m?.type) ? m.type : 'place',
        name: String(m?.name ?? '').trim().slice(0, 60),
        x: parseFloat(m?.x), y: parseFloat(m?.y),
        note: String(m?.note ?? '').trim().slice(0, 140),
    })).filter(m => m.name && Number.isFinite(m.x) && Number.isFinite(m.y));
    if (!list.length) return [];
    const frac = list.every(m => m.x <= 1 && m.y <= 1); // some models answer 0..1 instead of 0..100
    const k = frac ? 1 : 100;
    return list.slice(0, 40)
        .filter(m => !(kind === 'scene' && m.type === 'visited'))
        .map(m => ({
            id: uid(), type: m.type, name: m.name, note: m.note, auto: true,
            x: Math.min(0.98, Math.max(0.02, +(m.x / k).toFixed(4))),
            y: Math.min(0.98, Math.max(0.02, +(m.y / k).toFixed(4))),
        }));
}

export function newMarkerId() { return uid(); }

export async function analyzeMap(kind, item, signal) {
    const s = getSettings();
    const material = await buildMaterial();
    const image = await imageForVision(item.image);
    const names = [...new Set((getContext().chat || []).filter(m => !m.is_system).slice(-s.contextMessages).map(m => m.name))].join(', ');
    const text = `Map description: ${item.desc || '(none)'}\n\nCharacters: ${names || '(unknown)'}\n\n${material}\n\nReturn the JSON object now.`;
    const out = await callLLM([
        { role: 'system', content: markersSystem(kind, s.markerCount) },
        { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] },
    ], { signal, model: s.llmApi.visionModel || s.llmApi.model, maxTokens: Math.max(s.llmApi.maxTokens, 2500) });

    const clean = stripThink(out).replace(/```(?:json)?/gi, '');
    const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error(t('badMarkers'));
    const markers = normalizeMarkers(JSON.parse(clean.slice(a, b + 1)), kind);
    if (!markers.length) throw new Error(t('badMarkers'));
    return markers;
}

/* ------------------------------------------------ image API */

const ASPECT_OPENAI = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
const ASPECT_RATIO = { square: '1:1', landscape: '4:3', portrait: '3:4' };

function sniffMime(b64) {
    if (b64.startsWith('/9j/')) return 'image/jpeg';
    if (b64.startsWith('UklG')) return 'image/webp';
    return 'image/png';
}

function blobToB64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

async function imageFromUrl(url, signal) {
    try {
        const r = await fetch(url, { signal, credentials: 'omit' });
        if (!r.ok) throw new Error('fetch failed');
        const blob = await r.blob();
        return { b64: await blobToB64(blob), mime: blob.type || 'image/png' };
    } catch (e) {
        if (e?.name === 'AbortError') throw e;
        return { externalUrl: url }; // CORS blocked: keep the remote URL (may expire)
    }
}

async function genOpenAI(a, prompt, aspect, signal) {
    const base = a.url.trim().replace(/\/+$/, '').replace(/\/images\/generations$/i, '');
    const res = await fetch(base + '/images/generations', {
        method: 'POST',
        headers: llmHeaders(a),
        credentials: 'omit',
        signal,
        body: JSON.stringify({ model: a.model, prompt, n: 1, size: (a.customSize || '').trim() || ASPECT_OPENAI[aspect] || '1024x1024' }),
    });
    if (!res.ok) throw await httpError(res);
    const d = (await res.json())?.data?.[0];
    if (d?.b64_json) return { b64: d.b64_json, mime: sniffMime(d.b64_json) };
    if (d?.url) return imageFromUrl(d.url, signal);
    throw new Error(t('noImage'));
}

async function genGemini(a, prompt, aspect, signal) {
    const base = (a.url || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': a.key };
    const ratio = ASPECT_RATIO[aspect] || '1:1';

    if (/^imagen/i.test(a.model)) {
        const res = await fetch(`${base}/models/${a.model}:predict`, {
            method: 'POST', headers, credentials: 'omit', signal,
            body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: ratio } }),
        });
        if (!res.ok) throw await httpError(res);
        const p = (await res.json())?.predictions?.[0];
        if (!p?.bytesBase64Encoded) throw new Error(t('noImage'));
        return { b64: p.bytesBase64Encoded, mime: p.mimeType || sniffMime(p.bytesBase64Encoded) };
    }

    const res = await fetch(`${base}/models/${a.model}:generateContent`, {
        method: 'POST', headers, credentials: 'omit', signal,
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } },
        }),
    });
    if (!res.ok) throw await httpError(res);
    const j = await res.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const img = parts.map(p => p.inlineData || p.inline_data).find(Boolean);
    if (!img?.data) {
        const why = parts.map(p => p.text).filter(Boolean).join(' ') || j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || '';
        throw new Error(`${t('noImage')}${why ? ': ' + String(why).slice(0, 200) : ''}`);
    }
    return { b64: img.data, mime: img.mimeType || img.mime_type || sniffMime(img.data) };
}

export function generateImage(prompt, kind, signal) {
    const a = getSettings().imageApi;
    const aspect = kind === 'world' ? a.aspectWorld : a.aspectScene;
    return a.provider === 'gemini' ? genGemini(a, prompt, aspect, signal) : genOpenAI(a, prompt, aspect, signal);
}

/* ------------------------------------------------ saving the picture on the ST server */

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Uploads the image to SillyTavern's own user-files storage (no keys involved) and returns its URL. */
export async function storeImage(img, kind) {
    if (img.externalUrl) return img.externalUrl;
    const ext = EXT[img.mime] || 'png';
    const name = `sillymap_${kind}_${Date.now()}.${ext}`;
    const ctx = getContext();
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ name, data: img.b64 }),
    });
    if (!res.ok) throw new Error(t('uploadFail') + `HTTP ${res.status}`);
    const j = await res.json();
    const p = String(j.path || '');
    if (!p) throw new Error(t('uploadFail'));
    return /^(https?:)?\//.test(p) ? p : '/' + p;
}

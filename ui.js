import { getSettings, t, esc } from './core.js';
import { STYLES, buildImagePrompt } from './prompts.js';
import { imageConfigured, llmConfigured, describeFromChat, generateImage, storeImage, analyzeMap, newMarkerId } from './api.js';
import { getMap, currentItem, setField, addItem, setCur, markersOf, addMarker, deleteMarker, clearMarkers, updateMarker, replaceAutoMarkers } from './storage.js';
import { Viewer } from './viewer.js';

const state = {
    open: false, tab: 'world', busy: false, abort: null, viewer: null, shownUrl: null,
    edit: false, adding: false, showMarkers: true, popId: null,
};

const $q = sel => $('#sm_overlay').find(sel);
const clamp01 = v => Math.min(1, Math.max(0, v));

/* ------------------------------------------------ markup */

function pinSvg(type) {
    const fill = { place: '#B8420F', hero: '#2F6DB5', visited: '#8A7B6B' }[type] || '#B8420F';
    const dot = type === 'hero' ? '<circle cx="12" cy="10" r="1.5" fill="#111"/>' : '';
    return `<svg viewBox="0 0 24 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 24C12 24 3.5 15.8 3.5 10a8.5 8.5 0 0 1 17 0C20.5 15.8 12 24 12 24z" fill="${fill}" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="10" r="3.6" fill="#FBF1E6" stroke="#111" stroke-width="1.5"/>${dot}</svg>`;
}

function markerHtml(m) {
    return `<div class="sm-mk sm-mk-${m.type}" data-id="${esc(m.id)}" style="left:${m.x * 100}%;top:${m.y * 100}%"><div class="sm-mk-in"><span class="sm-mk-pin">${pinSvg(m.type)}</span><span class="sm-mk-name">${esc(m.name)}</span></div></div>`;
}

function windowHtml() {
    return `
<div class="sm-overlay" id="sm_overlay">
  <div class="sm-window" role="dialog">
    <div class="sm-head">
      <div class="sm-title"><i class="fa-solid fa-map-location-dot"></i><span>SillyMap</span></div>
      <div class="sm-tabs">
        <button class="sm-tab" data-tab="world"><i class="fa-solid fa-earth-europe"></i><span>${esc(t('tabWorld'))}</span></button>
        <button class="sm-tab" data-tab="scene"><i class="fa-solid fa-location-dot"></i><span>${esc(t('tabScene'))}</span></button>
      </div>
      <button class="sm-close" title="${esc(t('close'))}"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="sm-main">
      <div class="sm-viewport" id="sm_vp">
        <div class="sm-stage" id="sm_stage"><img id="sm_img" alt="" draggable="false"><div class="sm-markers" id="sm_markers"></div></div>
        <div class="sm-empty sm-ui" id="sm_empty">
          <div id="sm_empty_text"></div>
          <button class="sm-gen-big" id="sm_gen_big"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <div class="sm-tools sm-ui" id="sm_tools">
          <button data-tool="eye" title="${esc(t('toggleMarkers'))}"><i class="fa-solid fa-eye"></i></button>
          <button data-tool="edit" title="${esc(t('editMode'))}"><i class="fa-solid fa-pen"></i></button>
          <button data-tool="add" title="${esc(t('addPoint'))}"><i class="fa-solid fa-map-pin"></i></button>
        </div>
        <div class="sm-zoom sm-ui" id="sm_zoom">
          <button data-z="in" title="${esc(t('zoomIn'))}"><i class="fa-solid fa-plus"></i></button>
          <button data-z="out" title="${esc(t('zoomOut'))}"><i class="fa-solid fa-minus"></i></button>
          <button data-z="fit" title="${esc(t('zoomFit'))}"><i class="fa-solid fa-expand"></i></button>
        </div>
        <div class="sm-pop sm-ui" id="sm_pop" hidden>
          <div class="sm-pop-head"><b>${esc(t('pointTitle'))}</b><button id="sm_pop_close"><i class="fa-solid fa-xmark"></i></button></div>
          <select id="sm_pop_type" class="text_pole">${['place', 'hero', 'visited'].map(x => `<option value="${x}">${esc(t('type_' + x))}</option>`).join('')}</select>
          <input id="sm_pop_name" class="text_pole" placeholder="${esc(t('fName'))}">
          <textarea id="sm_pop_note" class="text_pole" rows="2" placeholder="${esc(t('fNote'))}"></textarea>
          <button id="sm_pop_del" class="sm-btn"><i class="fa-solid fa-trash"></i><span>${esc(t('del'))}</span></button>
        </div>
        <div class="sm-loading sm-ui" id="sm_loading" hidden>
          <div class="sm-spin"></div>
          <div id="sm_status"></div>
          <button class="sm-btn" id="sm_cancel">${esc(t('cancel'))}</button>
        </div>
      </div>
      <div class="sm-panel">
        <label class="sm-field"><span>${esc(t('style'))}</span>
          <select id="sm_style" class="text_pole">${STYLES.map(s => `<option value="${s}">${esc(t('style_' + s))}</option>`).join('')}</select>
        </label>
        <label class="sm-field"><span>${esc(t('extra'))}</span>
          <textarea id="sm_extra" class="text_pole" rows="3"></textarea>
        </label>
        <button id="sm_gen" class="sm-btn sm-primary"><i class="fa-solid fa-rotate"></i><span id="sm_gen_label"></span></button>
        <div class="sm-versions" id="sm_versions">
          <button id="sm_prev"><i class="fa-solid fa-chevron-left"></i></button>
          <span id="sm_ver"></span>
          <button id="sm_next"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <button id="sm_analyze" class="sm-btn"><i class="fa-solid fa-signature"></i><span>${esc(t('analyze_btn'))}</span></button>
        <button id="sm_clear" class="sm-btn"><i class="fa-solid fa-eraser"></i><span>${esc(t('clearMarkers'))}</span></button>
        <button id="sm_prompt_btn" class="sm-btn"><i class="fa-solid fa-code"></i><span></span></button>
        <textarea id="sm_prompt" class="text_pole" readonly hidden rows="7"></textarea>
      </div>
    </div>
  </div>
</div>`;
}

/* ------------------------------------------------ rendering */

function setLoading(on, text = '') {
    $q('#sm_loading').prop('hidden', !on);
    $q('#sm_status').text(text);
}

async function showImage(url) {
    if (state.shownUrl === url) return;
    state.shownUrl = url;
    try {
        await state.viewer.setImage(url);
    } catch {
        state.shownUrl = null;
        toastr.error(t('imgLoadErr'));
    }
}

function renderMarkers() {
    if (!state.open) return;
    $q('#sm_markers').html(markersOf(state.tab).map(markerHtml).join('')).prop('hidden', !state.showMarkers);
    $q('#sm_vp').toggleClass('sm-edit', state.edit).toggleClass('sm-adding', state.adding);
    $q('[data-tool="eye"]').toggleClass('on', state.showMarkers).find('i').attr('class', `fa-solid ${state.showMarkers ? 'fa-eye' : 'fa-eye-slash'}`);
    $q('[data-tool="edit"]').toggleClass('on', state.edit);
    $q('[data-tool="add"]').toggleClass('on', state.adding).prop('hidden', !state.edit);
}

function render() {
    if (!state.open) return;
    const s = getSettings();
    const kind = state.tab;
    const m = getMap(kind);
    const item = currentItem(kind);

    $q('.sm-tab').each(function () { $(this).toggleClass('active', $(this).data('tab') === kind); });
    $q('#sm_style').val(m?.style || s.defaultStyle);
    $q('#sm_extra').val(m?.extra || '').attr('placeholder', t(kind === 'world' ? 'extraPhWorld' : 'extraPhScene'));
    $q('#sm_gen_label').text(' ' + t(item ? 'regen' : 'create'));
    $q('#sm_gen, #sm_gen_big').prop('disabled', !m || state.busy);
    $q('#sm_analyze, #sm_clear').prop('hidden', !item).prop('disabled', state.busy);
    $q('.sm-panel select, .sm-panel textarea:not(#sm_prompt)').prop('disabled', !m);

    const hasImg = !!item;
    $q('#sm_empty').prop('hidden', hasImg);
    $q('#sm_empty_text').text(m ? t(kind === 'world' ? 'emptyWorld' : 'emptyScene') : t('noChat'));
    $q('#sm_zoom, #sm_tools').prop('hidden', !hasImg);
    $q('#sm_stage').toggle(hasImg);

    const n = m?.items.length || 0;
    $q('#sm_versions').prop('hidden', n < 2);
    $q('#sm_ver').text(n ? `${m.cur + 1} / ${n}` : '');
    $q('#sm_prev').prop('disabled', !m || m.cur <= 0);
    $q('#sm_next').prop('disabled', !m || m.cur >= n - 1);

    const $p = $q('#sm_prompt');
    $q('#sm_prompt_btn').prop('hidden', !item).find('span').text(' ' + t($p.prop('hidden') ? 'showPrompt' : 'hidePrompt'));
    $p.val(item?.prompt || '');
    if (!item) $p.prop('hidden', true);

    closePop();
    renderMarkers();
    if (item) showImage(item.image);
    else { state.shownUrl = null; state.viewer.clear(); }
}

/* ------------------------------------------------ marker popup */

function openPop(id) {
    const m = markersOf(state.tab).find(x => x.id === id);
    if (!m) return;
    state.popId = id;
    $q('#sm_pop_type').val(m.type);
    $q('#sm_pop_name').val(m.name);
    $q('#sm_pop_note').val(m.note || '');
    $q('#sm_pop').prop('hidden', false);
}

function closePop() {
    state.popId = null;
    $q('#sm_pop').prop('hidden', true);
}

function popUpdate(patch) {
    if (!state.popId) return;
    updateMarker(state.tab, state.popId, patch);
    renderMarkers();
}

/* ------------------------------------------------ actions */

async function runBusy(statusKey, fn) {
    state.busy = true;
    state.abort = new AbortController();
    $q('#sm_gen, #sm_gen_big, #sm_analyze, #sm_clear').prop('disabled', true);
    setLoading(true, t(statusKey));
    try {
        await fn(state.abort.signal);
    } catch (e) {
        if (e?.name === 'AbortError') toastr.info(t('cancelled'));
        else { console.error('[SillyMap]', e); toastr.error(t('errGen') + (e?.message || e)); }
    } finally {
        state.busy = false;
        state.abort = null;
        if (state.open) { setLoading(false); render(); }
    }
}

async function onGenerate() {
    if (state.busy) return;
    const s = getSettings();
    const kind = state.tab;
    const m = getMap(kind);
    if (!m) return toastr.warning(t('noChat'));
    if (!imageConfigured()) return toastr.warning(t('noImageApi'));

    const style = m.style || s.defaultStyle;
    const extra = (m.extra || '').trim();
    const useLlm = s.analyze && llmConfigured();
    if (!useLlm && !extra) return toastr.warning(t('needDesc'));

    await runBusy(useLlm ? 'statusAnalyze' : 'statusDraw', async signal => {
        let desc = '';
        if (useLlm) desc = await describeFromChat(kind, signal);
        const prompt = buildImagePrompt(kind, style, desc, extra);
        setLoading(true, t('statusDraw'));
        const img = await generateImage(prompt, kind, signal);
        setLoading(true, t('statusSave'));
        const url = await storeImage(img, kind);
        addItem(kind, { image: url, style, prompt, desc, created: Date.now(), markers: [] });
        state.shownUrl = null;

        if (s.autoMarkers && llmConfigured()) {
            setLoading(true, t('statusMarkers'));
            try {
                const list = await analyzeMap(kind, currentItem(kind), signal);
                replaceAutoMarkers(kind, list);
            } catch (e) {
                if (e?.name === 'AbortError') throw e;
                console.error('[SillyMap]', e);
                toastr.error(t('errGen') + (e?.message || e)); // the map itself is kept
            }
        }
        if (!state.open) toastr.success(t('done'));
    });
}

async function onAnalyze() {
    if (state.busy) return;
    const kind = state.tab;
    const item = currentItem(kind);
    if (!item) return;
    if (!llmConfigured()) return toastr.warning(t('noLlm'));
    await runBusy('statusMarkers', async signal => {
        const list = await analyzeMap(kind, item, signal);
        replaceAutoMarkers(kind, list);
        toastr.success(t('markersDone') + list.length);
    });
}

function stagePoint(e) {
    const r = document.getElementById('sm_stage').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

function onMapTap(e) {
    if (!state.adding || !currentItem(state.tab)) return;
    const p = stagePoint(e);
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    const marker = { id: newMarkerId(), type: 'place', name: t('newPoint'), note: '', x: +p.x.toFixed(4), y: +p.y.toFixed(4), auto: false };
    addMarker(state.tab, marker);
    state.adding = false;
    renderMarkers();
    openPop(marker.id);
}

/* ------------------------------------------------ events */

function bindWindow() {
    const $o = $('#sm_overlay');
    $o.on('click', '.sm-close', closeWindow);
    $o.on('click', '.sm-tab', function () { state.tab = $(this).data('tab'); state.adding = false; render(); });
    $o.on('click', '#sm_gen, #sm_gen_big', onGenerate);
    $o.on('click', '#sm_analyze', onAnalyze);
    $o.on('click', '#sm_clear', () => {
        if (!markersOf(state.tab).length || !window.confirm(t('confirmClear'))) return;
        clearMarkers(state.tab);
        render();
    });
    $o.on('click', '#sm_cancel', () => state.abort?.abort());
    $o.on('change', '#sm_style', function () { setField(state.tab, 'style', this.value); });
    $o.on('change', '#sm_extra', function () { setField(state.tab, 'extra', this.value); });
    $o.on('click', '#sm_prompt_btn', () => { $q('#sm_prompt').prop('hidden', (_, v) => !v); render(); });
    $o.on('click', '#sm_prev', () => { const m = getMap(state.tab); if (m) { setCur(state.tab, m.cur - 1); render(); } });
    $o.on('click', '#sm_next', () => { const m = getMap(state.tab); if (m) { setCur(state.tab, m.cur + 1); render(); } });
    $o.on('click', '#sm_zoom button', function () {
        const z = $(this).data('z');
        if (z === 'in') state.viewer.zoomBy(1.4);
        else if (z === 'out') state.viewer.zoomBy(1 / 1.4);
        else state.viewer.fit();
    });
    $o.on('mousedown', function (e) { if (e.target === this) closeWindow(); });

    // tools: show/hide pins, edit mode, add pin
    $o.on('click', '#sm_tools button', function () {
        const tool = $(this).data('tool');
        if (tool === 'eye') state.showMarkers = !state.showMarkers;
        else if (tool === 'edit') { state.edit = !state.edit; if (!state.edit) state.adding = false; }
        else if (tool === 'add') state.adding = !state.adding;
        renderMarkers();
    });

    // pin popup
    $o.on('click', '#sm_pop_close', closePop);
    $o.on('change', '#sm_pop_type', function () { popUpdate({ type: this.value }); });
    $o.on('change', '#sm_pop_name', function () { popUpdate({ name: this.value.trim().slice(0, 60) || t('newPoint') }); });
    $o.on('change', '#sm_pop_note', function () { popUpdate({ note: this.value.trim().slice(0, 140) }); });
    $o.on('click', '#sm_pop_del', () => { if (state.popId) { deleteMarker(state.tab, state.popId); closePop(); renderMarkers(); } });

    // pins: tap = open popup, drag (edit mode) = move
    let drag = null;
    let suppressClick = false;
    $o.on('pointerdown', '.sm-mk', function (e) {
        if (!state.edit) return;
        drag = { id: $(this).data('id'), pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, fx: 0, fy: 0 };
        try { this.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
    });
    $o.on('pointermove', '.sm-mk', function (e) {
        if (!drag || e.pointerId !== drag.pid) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
        drag.moved = true;
        const p = stagePoint(e);
        drag.fx = clamp01(p.x);
        drag.fy = clamp01(p.y);
        this.style.left = drag.fx * 100 + '%';
        this.style.top = drag.fy * 100 + '%';
    });
    $o.on('pointerup pointercancel', '.sm-mk', function (e) {
        if (!drag || e.pointerId !== drag.pid) return;
        const d = drag;
        drag = null;
        if (d.moved) {
            updateMarker(state.tab, d.id, { x: +d.fx.toFixed(4), y: +d.fy.toFixed(4) });
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
        }
    });
    $o.on('click', '.sm-mk', function () {
        if (suppressClick) return;
        openPop($(this).data('id'));
    });
}

function onKey(e) {
    if (e.key !== 'Escape' || !state.open) return;
    if (state.popId) closePop(); else closeWindow();
}

export function openWindow() {
    if (state.open) return;
    $('#sm_overlay').remove();
    $('body').append(windowHtml());
    state.open = true;
    state.shownUrl = null;
    state.popId = null;
    state.adding = false;
    state.viewer = new Viewer(document.getElementById('sm_vp'), document.getElementById('sm_stage'));
    state.viewer.onTap = onMapTap;
    bindWindow();
    document.addEventListener('keydown', onKey);
    render();
    if (state.busy) setLoading(true, t('statusDraw'));
}

export function closeWindow() {
    if (!state.open) return;
    state.open = false;
    document.removeEventListener('keydown', onKey);
    state.viewer?.destroy();
    state.viewer = null;
    $('#sm_overlay').remove();
}

export function onChatChanged() {
    if (!state.open) return;
    state.shownUrl = null;
    render();
}

# SillyMap

**Русский** | [English below](#english)

Карты мира и локаций для ролевых игр в SillyTavern. Нейросеть анализирует чат, описывает мир или текущее место, а генератор картинок рисует карту в выбранном стиле.

## Возможности (v0.2)
- Открывается из меню волшебной палочки: **SillyMap**.
- Две вкладки: **Мир** и **Локация**.
- Стили: фэнтези, средневековье, бумага, современность и свой стиль. Есть пожелания к карте и просмотр итогового промпта.
- Зум колёсиком/кнопками, перемещение, щипок и свайп на телефоне, двойной клик.
- История версий карты (до 12), переключение стрелками.
- Карта мира привязывается к чату или к персонажу (настройка), карта локации всегда к чату.
- Картинки сохраняются на сервере SillyTavern (user files), в данных чата лежит только ссылка.
- Два отдельных API: для картинок (OpenAI-совместимый или Google Gemini/Imagen) и для анализа чата (OpenAI-совместимый текстовый).
- Русский и английский интерфейс.
- **Источники анализа** (в настройках): чат / чат + лорбук / чат + лорбук + карточка персонажа. Берутся лорбук чата и лорбук персонажа.
- **Названия и точки**: модель с поддержкой изображений смотрит на готовую карту и ставит места, героев и посещённые места. Точки можно переименовывать, менять тип, добавлять, удалять и перетаскивать (режим правки). Точки вручную правленные не затираются повторным анализом.

## Приватность
Расширение использует **только собственные API** из своих настроек. Оно **не читает и не использует** API-подключения и ключи SillyTavern.

## Установка
`Extensions → Install extension`:
```
https://github.com/Ayrissa/SillyMap
```

## Настройка
1. `Extensions → SillyMap`: заполните API для картинок (адрес, ключ, модель) и, по желанию, API анализа.
2. В чате откройте волшебную палочку → SillyMap → нажмите кнопку обновления.

> Запросы идут из браузера напрямую; если провайдер блокирует их (CORS), выберите другой. Названия на карте нейросети рисуют плохо, поэтому в промптах стоит запрет на текст; подписи будут накладываться расширением (в планах).

## Планы
v0.3: пути, значки, экспорт.

---

## English

AI-generated world and location maps for SillyTavern roleplay. A text model analyzes the chat and describes the world or current place; an image model draws the map in the chosen style.

### Features (v0.2)
- Opens from the wand menu: **SillyMap**. Two tabs: **World** and **Location**.
- Styles: fantasy, medieval, paper, modern, custom. Map wishes and prompt preview.
- Zoom (wheel/buttons/pinch), pan, double-click.
- Version history (up to 12) with arrows.
- World map bound to the chat or the character (setting); the location map is always per chat.
- Images are stored on the SillyTavern server (user files); chat data only keeps a link.
- Two separate APIs: images (OpenAI-compatible or Google Gemini/Imagen) and chat analysis (OpenAI-compatible text).
- Russian and English UI.
- **Analysis sources** (settings): chat / chat + lorebook / chat + lorebook + character card. Uses the chat's lorebook and the character's lorebook.
- **Names and pins**: a vision-capable model looks at the finished map and places locations, heroes and visited places. Pins can be renamed, retyped, added, deleted and dragged (edit mode). Manually edited pins are kept on re-analysis.

### Privacy
Uses **only its own APIs**. Never reads SillyTavern's API connections or keys.

### Install
`Extensions → Install extension`: `https://github.com/Ayrissa/SillyMap`

### Roadmap
v0.3: paths, icons, export.

## License
MIT © Ayrissa

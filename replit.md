# Read

Vanilla JS web app. Ask AI questions, get streaming responses where each word is a clickable span (lookup popup with definition + language detection). Multi-thread chat with reusable blueprint, side-by-side vertical thread columns workspace.

## Stack

- Vanilla JS in the browser (no bundler, scripts loaded with `defer`)
- Express server (`server.js`) 
- OpenAI SDK (`javascript_openai_ai_integrations` integration)


## Client storage

Conversations are persisted client-side in **SQLite** (sql.js compiled to WASM, loaded from CDN). The whole `.db` blob is stored as a single value in **IndexedDB** via `idb-keyval`.

- `client/storage.js` — owns the database. Exposes `initStorage()`, `dbLoadAll()`, `dbSaveAll(list)`. Auto-flushes on `pagehide` / `visibilitychange = hidden`.
- Schema: `conversations(id INTEGER PRIMARY KEY, title TEXT, model TEXT NOT NULL, messages_json TEXT NOT NULL, is_open INTEGER NOT NULL DEFAULT 1)`. Older databases get the `is_open` column added via `ALTER TABLE` (try/catch on duplicate-column). `messages_json` stores `{ messages, summary, summarizedCount }`; legacy array-shape rows are auto-detected on load and re-saved in the new shape.
- Save flow: `BEGIN; DELETE FROM conversations; bulk INSERT; COMMIT;` then a debounced (100 ms) IDB write. IDB writes are serialized via a promise chain so newer writes always win. Empty conversations (`messages.length === 0`) are not persisted.
- Migration: on first run with this version, any existing `localStorage.listOfConversations` is imported once into SQLite (only when the table is empty), then the localStorage key is removed. Old array-shape entries are upgraded to `{ model, messages, title }`.

## UI

- `client/client.js` — multi-thread orchestration: `listOfConversations`, sidebar render + open/focus/delete, thread blocks, title editing (auto from first user message until edited), export menu wiring, header history-toggle + new-chat icons. Each entry has an in-memory `clientId` (UUID) used to bind sidebar items to columns via `block.dataset.clientId`. Per-entry `streaming` flag disables that entry's column-minimize and sidebar-delete while a response is in flight (prevents "stream-into-detached-DOM" data loss). Bootstrapping is wrapped in an async IIFE that awaits `initStorage()` before rendering and enables the new-chat buttons.
- `client/createChatThread.js` — single-thread blueprint: input handling, streaming render with `Intl.Segmenter`, clickable-word spans, restore-on-reload via `renderExistingConversation`. `buildRequestBody` uses `getMemoryState` to slice off already-summarized messages and attach the prior `summary` to each request. Calls `onStreamStart` / `onStreamEnd` around fetch+stream.
- `client/exportConversations.js` — JSON / Markdown / HTML / Plain-text export from the in-memory list. Each message carries a `timestamp` (epoch ms, set in `createChatThread.js` when the message is pushed). The four format builders include a human-readable local time next to each speaker label when present; the JSON builder normalizes `timestamp` to ISO 8601. Messages without a timestamp (legacy rows from before this field existed, or invalid values) export cleanly with no time annotation — `formatTimestamp` returns `''` and the JSON builder simply omits the field. Each conversation heading also includes a "Started <time> · Last updated <time>" line (Markdown italics, plain line in text, `<p class="convo-time">` in HTML) derived from the first and last messages that carry a timestamp via `conversationTimeRange`; the JSON payload mirrors this with optional `startedAt` / `updatedAt` ISO 8601 fields. Conversations whose messages all lack timestamps export with no time line and no JSON time fields. Exposes `exportConversations(list, format, { baseName? })` for the global "export all" and `exportSingleConversation(convo, format)` (uses a slugified per-conversation filename) for the per-thread export menu.
- `index.html` — left `<aside id="conversations-panel" class="conversations-panel hidden">` (sidebar with "+ New" + `#conversation-list`), main workspace with header (h1, history-toggle clock icon, Export dropdown), right prompts panel, then a block of `<template>` elements: `#lookup-popup-template`, `#typing-template`, `#thread-block-template`, `#thread-header-template`, `#context-divider-template`. Loads `sql.js` and `idb-keyval` from jsDelivr CDN before app scripts.
- **Static-DOM convention**: declarative skeletons live as `<template>` elements in `index.html`; JS clones with `tpl.content.firstElementChild.cloneNode(true)` (or `tpl.content.cloneNode(true)` for fragment templates like the lookup popup) and uses `querySelector` to wire dynamic bits. We only fall back to `createElement` chains for genuinely data-driven nodes (conversation-list rows with conditional checkbox/delete, per-message turns with clickable spans, toasts, badges).

### Landing / layout behavior

- **Clean landing**: the app starts with no thread columns mounted and the conversations sidebar hidden. Saved conversations are loaded into memory but their `isOpen` is forced to `false` on load so the sidebar reflects "no columns mounted".
- The header **clock icon** toggles the conversations sidebar (wired with `aria-expanded` / `aria-controls` for screen readers). The header **pencil icon** creates a new chat (same handler as the sidebar's "+ New").

### Sidebar / column behavior

- The sidebar lists every entry in `listOfConversations`. Clicking the title opens that conversation as a column on the right; if it's already open, the column scrolls into view and its input is focused.
- Column header **`−` (minimize)** closes the column (sets `isOpen = false`) but keeps the conversation in the sidebar. If the entry is empty and untitled, it's dropped entirely (no clutter from never-used "+ New" clicks).
- Sidebar `×` deletes the conversation entirely. Empty conversations delete immediately; non-empty ones show inline "Delete / Cancel" confirm and, on delete, a 6-second undo toast that restores the entry (and reopens the column if it was open).
- While a stream is running for an entry, both that entry's column-minimize button and sidebar-delete button are disabled.
- The conversations panel header has a **"Select"** button that enters multi-select mode: each list row gets a checkbox, clicking the title toggles selection (instead of opening the column), and the row delete buttons are hidden. A toolbar replaces the normal panel actions and shows the live count, an All/None toggle, an **"Export ▾"** dropdown (same four formats as the global Export, scoped to the checked entries), and a **"Done"** button to leave the mode. Empty conversations are listed but greyed out and uncheckable. Selection state is held in a `selectedClientIds` Set in `client/client.js` (state lives in memory only — exiting the mode discards it). `refreshSelectionToolbar` prunes IDs whose conversations were removed/emptied so stale selections can't slip into the export. The bulk export reuses `exportConversations(picked, format)` with the standard combined `read-conversations-YYYY-MM-DD.<ext>` filename.

## History trimming + running summary

The full conversation lives client-side; `/api/chat` enforces a `MAX_HISTORY_MESSAGES = 20` window on the messages it forwards to the chat model. Anything dropped is folded into a per-thread running summary (`gpt-4o-mini`) that is prepended as a system message so older context (persona, vocab, corrections) survives.

- Each conversation entry has `summary` (string) and `summarizedCount` (how many leading messages have been folded in).
- Client uploads `conversation.slice(summarizedCount)` plus `summary` per request.
- Server only re-summarizes when the trim window pushes *new* messages out, then returns `{ summary, newDropCount }` as a final SSE event before `done`. When summarization will run, the server flushes a `{ summarizing: { current, total } }` SSE event before *each* summary-model call (one per `SUMMARY_CHUNK_SIZE` chunk of dropped turns) so the client can show a "Updating memory of earlier messages…" status above the typing dots until the first chat token arrives. On long legacy imports that span multiple chunks, the client appends "chunk X of Y" to the status when `total > 1`; single-chunk runs (the common case) keep the plain wording.
- Client adds `newDropCount` to its local `summarizedCount` and persists via `saveConversations()`.
- Wired through `getMemoryState` / `onMemoryUpdate` callbacks on `createChatThread`.
- Each rendered `.turn` carries `data-msg-start-index` (the conversation index of its first message). `createChatThread` inserts a `.context-divider` ("Older messages condensed into a summary") just above the first turn whose start index is ≥ `summarizedCount`, so users can see at a glance which on-screen messages have aged out of the model's working memory. The divider is re-anchored (not re-created) after each `{ summary, newDropCount }` SSE event so its open/closed state is preserved. The divider's label is a button that toggles a `.context-summary-panel` showing the current running summary; the panel reads its text via a `getSummary` callback so live updates flow in while it's already open. When `summarizedCount === 0` the divider (and therefore the panel) is not exposed at all. `MAX_HISTORY_MESSAGES` is mirrored client-side (in `client/createChatThread.js` for the divider tooltip and in `client/client.js` as `PRECOMPUTE_MIN_MESSAGES` for the precompute trigger) — keep all three constants in sync.

### Background precompute for long imported threads

After bootstrap, `client/client.js` walks `listOfConversations` and queues every entry with `messages.length > PRECOMPUTE_MIN_MESSAGES` and `summarizedCount === 0` for proactive summarization (`queuePrecomputeForLegacyConversations` → `runPrecomputeForEntry`, chained on a single `precomputeQueue` promise so requests run serially). Each call hits a dedicated `POST /api/summarize` route on the server that reuses `buildHistory` (and therefore `summarizeInChunks`) and emits the same chunked `{ summarizing: { current, total } }` SSE protocol as `/api/chat`, terminating with `{ summary, newDropCount, done: true }`. The result is persisted via `saveConversations()` so the next user-initiated `/api/chat` skips the long warm-up.

While precompute is in flight, the entry's `precomputing: { current, total }` field drives a small "Updating memory of earlier messages…" status (with optional "chunk X of Y") in the sidebar row (`.conversation-item-status`) and, if the column is open, in a banner above the input (`.thread-precompute-status`). Both reuse `.memory-status` styling. To avoid the precompute racing with a user-initiated `/api/chat` (both would write `summary` / `summarizedCount`), `createChatThread` fires an `onUserMessage` callback when the user submits a message and `wireThreadBlock` uses it to call `cancelPrecompute(entry)` (also called by sidebar delete). The cancel just `.abort()`s the fetch and clears `precomputing`; the chat path then handles summarization via the original code path. Short imported threads (`messages.length ≤ PRECOMPUTE_MIN_MESSAGES`) skip the queue entirely.

## Deployment notes

- `scripts/post-merge.sh` runs `npm ci` after task agent merges.
- CDN dependencies (`sql.js`, `idb-keyval`) require network access at page load.

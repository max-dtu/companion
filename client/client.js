// Populate both export menus from a single template, removing the HTML duplication
(function stampExportMenus() {
  const tpl = document.getElementById('tpl-export-items');
  if (!tpl) return;
  for (const id of ['export-menu', 'selection-export-menu']) {
    const menu = document.getElementById(id);
    if (menu) menu.appendChild(tpl.content.cloneNode(true));
  }
})();

let threadCounter = 0;
let listOfConversations = [];

let activeStreamCount = 0;
function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}
function streamStarted() {
  activeStreamCount++;
  if (activeStreamCount === 1) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }
}
function streamEnded() {
  if (activeStreamCount === 0) return;
  activeStreamCount--;
  if (activeStreamCount === 0) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  }
}

const exportBtn = document.getElementById('export-btn');
const exportMenu = document.getElementById('export-menu');
const threadsContainer = document.querySelector('.threads-container');
const conversationsPanel = document.querySelector('.conversations-panel');
const conversationList = document.getElementById('conversation-list');
const newChatBtn = document.getElementById('new-chat-btn');
const toggleHistoryBtn = document.getElementById('toggle-history-btn');
const selectBtn = document.getElementById('select-btn');
const selectionToolbar = document.getElementById('selection-toolbar');
const selectionCountEl = document.getElementById('selection-count');
const selectionAllBtn = document.getElementById('selection-all-btn');
const selectionExportBtn = document.getElementById('selection-export-btn');
const selectionExportMenu = document.getElementById('selection-export-menu');
const selectionCancelBtn = document.getElementById('selection-cancel-btn');
const panelActions = document.querySelector('.conversations-panel-actions');

function generateClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function refreshExportButton() {
  const hasContent = listOfConversations.some((c) => c.messages.length > 0);
  exportBtn.disabled = !hasContent;
  selectBtn.disabled = !hasContent;
  if (selectionMode && !hasContent) {
    exitSelectionMode();
  }
}

function saveConversations() {
  const nonEmpty = listOfConversations.filter((c) => c.messages.length > 0);
  dbSaveAll(nonEmpty);
  refreshExportButton();
  renderConversationList();
}

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('hidden');
});

exportMenu.addEventListener('click', (e) => {
  const format = e.target.dataset.format;
  if (!format) return;
  exportConversations(listOfConversations, format);
  exportMenu.classList.add('hidden');
});

function closeAllThreadExportMenus() {
  for (const menu of document.querySelectorAll('.thread-export-menu:not(.hidden)')) {
    menu.classList.add('hidden');
    const btn = menu.parentElement?.querySelector('.thread-export-btn');
    btn?.setAttribute('aria-expanded', 'false');
  }
}

function clipboardWriteAvailable() {
  return typeof navigator !== 'undefined'
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === 'function';
}

let pendingInfoToast = null;

function dismissInfoToast(animate = true) {
  if (!pendingInfoToast) return;
  clearTimeout(pendingInfoToast.timer);
  const { toastEl } = pendingInfoToast;
  pendingInfoToast = null;
  if (animate) {
    toastEl.classList.remove('visible');
    setTimeout(() => toastEl.remove(), 200);
  } else {
    toastEl.remove();
  }
}

function showInfoToast(message, { isError = false, duration = 1800 } = {}) {
  dismissInfoToast(false);

  const toast = document.createElement('div');
  toast.className = 'undo-toast info-toast';
  if (isError) toast.classList.add('info-toast-error');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const label = document.createElement('span');
  label.className = 'undo-toast-label';
  label.textContent = message;
  toast.appendChild(label);

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  const timer = setTimeout(() => dismissInfoToast(), duration);
  pendingInfoToast = { timer, toastEl: toast };
}

async function copyConversationToClipboard(entry, format) {
  const text = conversationToCopyableString(entry, format);
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
    const label = format === 'markdown' ? 'Markdown' : 'Plain text';
    showInfoToast(`Copied as ${label}.`);
  } catch (err) {
    console.error('Failed to copy conversation to clipboard:', err);
    showInfoToast('Copy failed — clipboard unavailable.', { isError: true, duration: 2400 });
  }
}

document.addEventListener('click', () => {
  exportMenu.classList.add('hidden');
  selectionExportMenu.classList.add('hidden');
  closeAllThreadExportMenus();
});

selectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  enterSelectionMode();
});

selectionCancelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exitSelectionMode();
});

selectionAllBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const exportable = exportableConversations();
  if (exportable.length === 0) return;
  const allSelected = selectedClientIds.size === exportable.length;
  selectedClientIds.clear();
  if (!allSelected) {
    for (const c of exportable) selectedClientIds.add(c.clientId);
  }
  refreshSelectionToolbar();
  renderConversationList();
});

selectionExportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (selectionExportBtn.disabled) return;
  selectionExportMenu.classList.toggle('hidden');
});

selectionExportMenu.addEventListener('click', (e) => {
  const format = e.target.dataset.format;
  if (!format) return;
  const picked = listOfConversations.filter(
    (c) => selectedClientIds.has(c.clientId) && c.messages.length > 0,
  );
  if (picked.length === 0) return;
  exportConversations(picked, format);
  selectionExportMenu.classList.add('hidden');
  exitSelectionMode();
});

// === Sidebar ===

let openSidebarConfirm = null;
let selectionMode = false;
const selectedClientIds = new Set();

function exportableConversations() {
  return listOfConversations.filter((c) => c.messages.length > 0);
}

function refreshSelectionToolbar() {
  if (!selectionMode) return;
  const exportable = exportableConversations();
  const liveIds = new Set(exportable.map((c) => c.clientId));
  for (const id of selectedClientIds) {
    if (!liveIds.has(id)) selectedClientIds.delete(id);
  }
  const total = exportable.length;
  const count = selectedClientIds.size;
  selectionCountEl.textContent = `${count} selected`;
  selectionExportBtn.disabled = count === 0;
  if (count === 0) {
    selectionExportMenu.classList.add('hidden');
  }
  const allSelected = total > 0 && count === total;
  selectionAllBtn.textContent = allSelected ? 'None' : 'All';
  selectionAllBtn.disabled = total === 0;
  selectionAllBtn.setAttribute(
    'aria-label',
    allSelected ? 'Clear selection' : 'Select all conversations',
  );
}

function enterSelectionMode() {
  if (selectionMode) return;
  if (exportableConversations().length === 0) return;
  selectionMode = true;
  selectedClientIds.clear();
  panelActions.classList.add('hidden');
  selectionToolbar.classList.remove('hidden');
  conversationList.classList.add('selection-mode');
  exportMenu.classList.add('hidden');
  refreshSelectionToolbar();
  renderConversationList();
}

function exitSelectionMode() {
  if (!selectionMode) return;
  selectionMode = false;
  selectedClientIds.clear();
  panelActions.classList.remove('hidden');
  selectionToolbar.classList.add('hidden');
  selectionExportMenu.classList.add('hidden');
  conversationList.classList.remove('selection-mode');
  renderConversationList();
}

function toggleSelection(entry) {
  if (entry.messages.length === 0) return;
  if (selectedClientIds.has(entry.clientId)) {
    selectedClientIds.delete(entry.clientId);
  } else {
    selectedClientIds.add(entry.clientId);
  }
  refreshSelectionToolbar();
  const li = conversationList.querySelector(
    `[data-client-id="${entry.clientId}"]`,
  );
  if (li) {
    const checked = selectedClientIds.has(entry.clientId);
    li.classList.toggle('is-selected', checked);
    const cb = li.querySelector('.conversation-item-checkbox');
    if (cb) cb.checked = checked;
  }
}

// Builds the human-readable status line shown next to a conversation
// (sidebar) and above its column input while a background precompute
// is running. Returns an empty string when nothing is in flight so
// callers can hide the affordance.
function formatPrecomputeStatus(state) {
  if (!state) return '';
  const { current, total } = state;
  if (total > 1 && current > 0) {
    return `Updating memory of earlier messages… chunk ${current} of ${total}`;
  }
  return 'Updating memory of earlier messages…';
}

function renderConversationList() {
  if (openSidebarConfirm) {
    openSidebarConfirm.cancel();
  }
  conversationList.innerHTML = '';

  if (listOfConversations.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'conversation-list-empty';
    empty.textContent = 'No conversations yet.';
    conversationList.appendChild(empty);
    return;
  }

  for (const entry of listOfConversations) {
    const li = document.createElement('li');
    li.className = 'conversation-item';
    if (entry.isOpen) li.classList.add('is-open');
    li.dataset.clientId = entry.clientId;

    if (selectionMode) {
      const exportable = entry.messages.length > 0;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'conversation-item-checkbox';
      checkbox.checked = selectedClientIds.has(entry.clientId);
      checkbox.disabled = !exportable;
      checkbox.setAttribute(
        'aria-label',
        exportable
          ? `Select conversation: ${entry.title || 'Untitled'}`
          : 'Empty conversation cannot be exported',
      );
      if (!exportable) {
        checkbox.title = 'Empty conversation — nothing to export';
      }
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', () => toggleSelection(entry));
      li.appendChild(checkbox);
      if (checkbox.checked) li.classList.add('is-selected');
      if (!exportable) li.classList.add('is-unexportable');
    }

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'conversation-item-title';
    const titleText = entry.title || 'Untitled';
    titleBtn.textContent = titleText;
    titleBtn.title = titleText;
    titleBtn.addEventListener('click', () => {
      if (selectionMode) {
        toggleSelection(entry);
      } else {
        openOrFocusConversation(entry);
      }
    });
    li.appendChild(titleBtn);

    if (!selectionMode) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'conversation-item-delete';
      deleteBtn.textContent = '×';
      if (entry.streaming) {
        deleteBtn.disabled = true;
        deleteBtn.title = 'Cannot delete while a response is streaming';
      } else {
        deleteBtn.title = 'Delete conversation';
      }
      deleteBtn.setAttribute('aria-label', 'Delete conversation');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestSidebarDelete(entry, li);
      });
      li.appendChild(deleteBtn);
    }

    // Surface in-flight background precompute progress on the sidebar row
    // so users can see why a long imported thread isn't immediately ready.
    // Reuses `.memory-status` styling. The element is inserted as a final
    // child so it wraps onto its own line (see `.conversation-item` flex
    // rule in style.css).
    const statusText = formatPrecomputeStatus(entry.precomputing);
    if (statusText) {
      const statusEl = document.createElement('span');
      statusEl.className = 'conversation-item-status memory-status';
      statusEl.textContent = statusText;
      li.appendChild(statusEl);
    }

    conversationList.appendChild(li);
  }

  if (selectionMode) refreshSelectionToolbar();
}

function findBlockByClientId(clientId) {
  return threadsContainer.querySelector(`[data-client-id="${clientId}"]`);
}

function openOrFocusConversation(entry) {
  let block = findBlockByClientId(entry.clientId);
  if (block) {
    block.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    block.querySelector('.thread-input')?.focus();
    return;
  }
  entry.isOpen = true;
  block = createThreadBlock();
  block.dataset.clientId = entry.clientId;
  wireThreadBlock(block, entry);
  saveConversations();
  block.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
  block.querySelector('.thread-input').focus();
}

function closeColumn(entry, block) {
  block.remove();
  if (entry.messages.length === 0 && !entry.titleEdited) {
    const idx = listOfConversations.indexOf(entry);
    if (idx >= 0) listOfConversations.splice(idx, 1);
  } else {
    entry.isOpen = false;
  }
  saveConversations();
  setHistoryPanelOpen(true);
}

// === Delete from sidebar (with undo) ===

let pendingUndo = null;

function dismissUndoToast(animate = true) {
  if (!pendingUndo) return;
  clearTimeout(pendingUndo.timer);
  const { toastEl } = pendingUndo;
  pendingUndo = null;
  if (animate) {
    toastEl.classList.remove('visible');
    setTimeout(() => toastEl.remove(), 200);
  } else {
    toastEl.remove();
  }
}

function showUndoToast(entry, listIndex) {
  dismissUndoToast(false);

  const toast = document.createElement('div');
  toast.className = 'undo-toast';

  const label = document.createElement('span');
  label.className = 'undo-toast-label';
  label.textContent = 'Conversation deleted.';
  toast.appendChild(label);

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'undo-toast-btn';
  undoBtn.textContent = 'Undo';
  toast.appendChild(undoBtn);

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  undoBtn.addEventListener('click', () => {
    const insertIndex = Math.min(Math.max(listIndex, 0), listOfConversations.length);
    listOfConversations.splice(insertIndex, 0, entry);
    if (entry.isOpen) {
      const block = createThreadBlock();
      block.dataset.clientId = entry.clientId;
      wireThreadBlock(block, entry);
    }
    saveConversations();
    dismissUndoToast();
  });

  const timer = setTimeout(() => dismissUndoToast(), 6000);
  pendingUndo = { timer, toastEl: toast };
}

function performSidebarDelete(entry) {
  const listIndex = listOfConversations.indexOf(entry);
  if (listIndex < 0) return;
  // Stop any background precompute for this entry — the entry is leaving
  // the list (or going into the undo buffer) and we don't want a late
  // response writing back into a deleted conversation.
  cancelPrecompute(entry);
  const block = findBlockByClientId(entry.clientId);
  block?.remove();
  listOfConversations.splice(listIndex, 1);
  saveConversations();
  if (entry.messages.length > 0) {
    showUndoToast(entry, listIndex);
  }
}

function requestSidebarDelete(entry, li) {
  if (entry.messages.length === 0) {
    performSidebarDelete(entry);
    return;
  }
  if (openSidebarConfirm) {
    openSidebarConfirm.cancel();
  }

  const deleteBtn = li.querySelector('.conversation-item-delete');
  deleteBtn.style.display = 'none';

  const confirmGroup = document.createElement('span');
  confirmGroup.className = 'thread-confirm';

  const yesBtn = document.createElement('button');
  yesBtn.type = 'button';
  yesBtn.className = 'thread-confirm-yes';
  yesBtn.textContent = 'Delete';
  confirmGroup.appendChild(yesBtn);

  const noBtn = document.createElement('button');
  noBtn.type = 'button';
  noBtn.className = 'thread-confirm-no';
  noBtn.textContent = 'Cancel';
  confirmGroup.appendChild(noBtn);

  li.appendChild(confirmGroup);
  yesBtn.focus();

  const reset = () => {
    confirmGroup.remove();
    deleteBtn.style.display = '';
    if (openSidebarConfirm && openSidebarConfirm.li === li) openSidebarConfirm = null;
  };

  yesBtn.addEventListener('click', () => {
    reset();
    performSidebarDelete(entry);
  });
  noBtn.addEventListener('click', reset);

  openSidebarConfirm = { cancel: reset, li };
}

// === Thread blocks ===

function createThreadBlock() {
  // Static skeleton lives in #thread-block-template in index.html.
  // The template carries the per-column .thread-precompute-status banner
  // (hidden by default) used by the background precompute pass on long
  // imported threads — wireThreadBlock looks it up via querySelector.
  const block = document
    .getElementById('thread-block-template')
    .content.firstElementChild.cloneNode(true);
  threadsContainer.appendChild(block);
  return block;
}

function wireThreadBlock(block, entry) {
  const threadEl = block.querySelector('.chat-thread');
  const inputEl = block.querySelector('.thread-input');
  const stopBtn = block.querySelector('.thread-stop');
  const precomputeStatus = block.querySelector('.thread-precompute-status');
  if (!threadEl.id) threadEl.id = `chat-thread-${++threadCounter}`;

  if (typeof entry.summary !== 'string') entry.summary = '';
  if (typeof entry.summarizedCount !== 'number') entry.summarizedCount = 0;

  // Mirror the entry's current precompute state into the per-column banner.
  // Called both up-front (in case a precompute was already in flight when
  // the user opened this column) and from the global precompute hook each
  // time progress changes.
  const refreshPrecomputeBanner = () => {
    const text = formatPrecomputeStatus(entry.precomputing);
    if (text) {
      precomputeStatus.textContent = text;
      precomputeStatus.hidden = false;
    } else {
      precomputeStatus.textContent = '';
      precomputeStatus.hidden = true;
    }
  };
  entry.refreshPrecomputeBanner = refreshPrecomputeBanner;
  refreshPrecomputeBanner();

  // Static skeleton lives in #thread-header-template in index.html.
  const header = document
    .getElementById('thread-header-template')
    .content.firstElementChild.cloneNode(true);

  const titleEl = header.querySelector('.thread-title');
  if (entry.title) titleEl.textContent = entry.title;

  const threadExportBtn = header.querySelector('.thread-export-btn');
  threadExportBtn.disabled = entry.messages.length === 0;

  const threadExportMenu = header.querySelector('.thread-export-menu');
  // Hide the Copy entries when the async Clipboard API isn't available
  // (insecure context, unsupported browser) so we don't show buttons that
  // always error.
  if (!clipboardWriteAvailable()) {
    threadExportMenu
      .querySelectorAll('.thread-export-copy-only')
      .forEach((el) => el.remove());
  }

  const closeBtn = header.querySelector('.thread-close');

  block.insertBefore(header, block.firstChild);

  closeBtn.addEventListener('click', () => closeColumn(entry, block));

  const closeThreadExportMenu = () => {
    threadExportMenu.classList.add('hidden');
    threadExportBtn.setAttribute('aria-expanded', 'false');
  };
  threadExportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = threadExportMenu.classList.contains('hidden');
    closeAllThreadExportMenus();
    threadExportMenu.classList.toggle('hidden', !willOpen);
    threadExportBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  threadExportMenu.addEventListener('click', (e) => {
    const format = e.target.dataset.format;
    if (!format) return;
    const action = e.target.dataset.action || 'download';
    if (action === 'copy') {
      copyConversationToClipboard(entry, format);
    } else {
      exportSingleConversation(entry, format);
    }
    closeThreadExportMenu();
  });

  const refreshThreadExportButton = () => {
    const enabled = entry.messages.length > 0;
    threadExportBtn.disabled = !enabled;
    if (!enabled) closeThreadExportMenu();
  };

  const onLocalStreamStart = () => {
    entry.streaming = true;
    closeBtn.disabled = true;
    closeBtn.title = 'Cannot close while a response is streaming';
    stopBtn.hidden = false;
    streamStarted();
    renderConversationList();
  };
  const onLocalStreamEnd = () => {
    entry.streaming = false;
    closeBtn.disabled = false;
    closeBtn.title = 'Minimize';
    stopBtn.hidden = true;
    streamEnded();
    renderConversationList();
  };

  titleEl.addEventListener('input', () => {
    entry.title = titleEl.textContent.trim();
    entry.titleEdited = true;
    saveConversations();
  });

  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleEl.blur();
    }
  });

  const handleUpdate = () => {
    if (!entry.titleEdited && !entry.title) {
      const firstUser = entry.messages.find((m) => m.role === 'user');
      if (firstUser) {
        entry.title = firstUser.content.slice(0, 80);
        titleEl.textContent = entry.title;
      }
    }
    refreshThreadExportButton();
    saveConversations();
  };

  const chat = createChatThread({
    threadEl,
    inputEl,
    model: entry.model,
    conversation: entry.messages,
    onUpdate: handleUpdate,
    onStreamStart: onLocalStreamStart,
    onStreamEnd: onLocalStreamEnd,
    getMemoryState: () => ({
      summary: entry.summary,
      summarizedCount: entry.summarizedCount,
    }),
    onMemoryUpdate: (summary, newDropCount) => {
      entry.summary = summary;
      entry.summarizedCount = Math.min(
        (entry.summarizedCount || 0) + (newDropCount || 0),
        entry.messages.length
      );
      saveConversations();
    },
    onSummaryEdit: (newSummary) => {
      entry.summary = newSummary;
      saveConversations();
    },
    onUserMessage: () => {
      // A user-initiated chat is about to call /api/chat, which will
      // re-summarize on its own. Cancel any background precompute for
      // this entry so the two paths don't race on the saved
      // `summary` / `summarizedCount`.
      cancelPrecompute(entry);
    },
  });

  stopBtn.addEventListener('click', () => chat.stop());

  block.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!entry.streaming) return;
    const active = document.activeElement;
    if (active !== inputEl && !threadEl.contains(active)) return;
    e.preventDefault();
    chat.stop();
  });
}

function createNewChat() {
  const settings = window.getAISettings?.() || {};
  const entry = {
    clientId: generateClientId(),
    model: settings.model || 'gpt-4o',
    messages: [],
    title: '',
    titleEdited: false,
    isOpen: true,
  };
  listOfConversations.push(entry);
  const block = createThreadBlock();
  block.dataset.clientId = entry.clientId;
  wireThreadBlock(block, entry);
  saveConversations();
  block.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
  block.querySelector('.thread-input').focus();
}

// === Conversations panel toggle ===

function setHistoryPanelOpen(open) {
  conversationsPanel.classList.toggle('hidden', !open);
  toggleHistoryBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  toggleHistoryBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggleHistoryBtn.title = open ? 'Hide conversations' : 'Show conversations';
  toggleHistoryBtn.setAttribute('aria-label', toggleHistoryBtn.title);
}

toggleHistoryBtn.addEventListener('click', () => {
  const isOpen = !conversationsPanel.classList.contains('hidden');
  setHistoryPanelOpen(!isOpen);
});

// === Background precompute for long imported threads ===

// Mirror of MAX_HISTORY_MESSAGES in server.js / createChatThread.js. The
// only thing this client uses it for is deciding whether a freshly loaded
// (or migrated) conversation is long enough to warrant a background
// summary precompute. Keep all three constants in sync.
const PRECOMPUTE_MIN_MESSAGES = 20;

let precomputeQueue = Promise.resolve();

// Update just this entry's sidebar status badge + column banner after
// its `precomputing` state changes. Avoids a full `renderConversationList()`
// rebuild because progress events can fire many times (one per
// `SUMMARY_CHUNK_SIZE` chunk) and a full rebuild would clobber any open
// delete confirmation, scroll position, or focus on neighboring rows.
function refreshPrecomputeUI(entry) {
  const li = conversationList.querySelector(
    `[data-client-id="${entry.clientId}"]`,
  );
  if (li) {
    let statusEl = li.querySelector('.conversation-item-status');
    const text = formatPrecomputeStatus(entry.precomputing);
    if (text) {
      if (!statusEl) {
        statusEl = document.createElement('span');
        statusEl.className = 'conversation-item-status memory-status';
        li.appendChild(statusEl);
      }
      statusEl.textContent = text;
    } else if (statusEl) {
      statusEl.remove();
    }
  }
  entry.refreshPrecomputeBanner?.();
}

// Cancel any in-flight precompute for `entry` and clear the visible
// status. Safe to call when nothing is running.
function cancelPrecompute(entry) {
  if (entry.precomputeAbort) {
    entry.precomputeAbort.abort();
    entry.precomputeAbort = null;
  }
  if (entry.precomputing) {
    entry.precomputing = null;
    refreshPrecomputeUI(entry);
  }
}

// Streams /api/summarize for one entry, surfacing per-chunk progress and
// persisting the resulting summary so the next /api/chat call doesn't
// have to fold the backlog itself. Bails out cleanly on abort (e.g. user
// sent a chat in this conversation) without touching saved state.
async function runPrecomputeForEntry(entry) {
  // Re-check inside the queue: another path (chat send, deletion, manual
  // summary edit) may have invalidated the precompute by the time the
  // queue gets to this entry. The membership check guards against the
  // case where the user deleted a long imported conversation before its
  // queued precompute had a chance to start — without this we'd burn
  // an OpenAI request and then write the result back into a detached
  // entry object.
  if (!listOfConversations.includes(entry)) return;
  if (!entry.messages || entry.messages.length <= PRECOMPUTE_MIN_MESSAGES) return;
  if ((entry.summarizedCount || 0) > 0) return;

  const abort = new AbortController();
  entry.precomputeAbort = abort;
  entry.precomputing = { current: 0, total: 0 };
  refreshPrecomputeUI(entry);

  try {
    const settings = window.getAISettings?.() || {};
    const summarizeBody = {
      messages: entry.messages.slice(entry.summarizedCount || 0),
      summary: entry.summary || '',
      model: entry.model,
    };
    if (settings.baseURL) summarizeBody.baseURL = settings.baseURL;
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: window.getAIHeaders?.() || { 'Content-Type': 'application/json' },
      body: JSON.stringify(summarizeBody),
      signal: abort.signal,
    });

    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try {
        const errData = await res.json();
        msg = errData.error || msg;
      } catch {}
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let stream = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stream += decoder.decode(value, { stream: true });
      const lines = stream.split('\n');
      stream = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.error) throw new Error(data.error);
        if (data.summarizing) {
          entry.precomputing = {
            current: data.summarizing.current,
            total: data.summarizing.total,
          };
          refreshPrecomputeUI(entry);
        }
        if (typeof data.summary === 'string' && typeof data.newDropCount === 'number') {
          if (data.newDropCount > 0) {
            entry.summary = data.summary;
            entry.summarizedCount = Math.min(
              (entry.summarizedCount || 0) + data.newDropCount,
              entry.messages.length,
            );
            saveConversations();
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    // Don't surface errors as a blocking notice — precompute is best-effort.
    // The first /api/chat call will handle summarization the old way.
    console.error('Precompute summary failed:', err);
  } finally {
    if (entry.precomputeAbort === abort) entry.precomputeAbort = null;
    entry.precomputing = null;
    refreshPrecomputeUI(entry);
  }
}

// Queue every long, never-summarized conversation for background
// precompute. Runs them serially (chained on `precomputeQueue`) so we
// don't open N parallel sockets / blow the OpenAI rate limit on first
// load with a large legacy import.
function queuePrecomputeForLegacyConversations() {
  for (const entry of listOfConversations) {
    if (!Array.isArray(entry.messages)) continue;
    if (entry.messages.length <= PRECOMPUTE_MIN_MESSAGES) continue;
    if ((entry.summarizedCount || 0) > 0) continue;
    precomputeQueue = precomputeQueue
      .catch(() => {})
      .then(() => runPrecomputeForEntry(entry));
  }
}

// === Bootstrap ===

newChatBtn.disabled = true;

function showStorageFailureNotice() {
  const notice = document.querySelector('.storage-notice');
  if (!notice) return;
  notice.textContent =
    'Saving is unavailable right now — your chats will not persist this session.';
  notice.classList.add('storage-notice-error');
}

(async () => {
  try {
    await initStorage();
    listOfConversations = dbLoadAll();
  } catch (err) {
    console.error('Failed to initialise storage:', err);
    listOfConversations = [];
    showStorageFailureNotice();
  }

  // Landing page is intentionally clean: no thread columns are auto-opened
  // and no empty conversation is auto-created. Users open chats from the
  // history panel via the clock-icon toggle and the in-panel "+ New" button.
  // We force isOpen=false for every loaded entry so the sidebar accurately
  // reflects "no columns mounted" — isOpen will flip back to true the moment
  // a user opens one.
  for (const entry of listOfConversations) {
    if (!entry.clientId) entry.clientId = generateClientId();
    entry.isOpen = false;
  }

  refreshExportButton();
  renderConversationList();

  newChatBtn.disabled = false;
  newChatBtn.addEventListener('click', () => createNewChat());

  // Long imported / legacy conversations (e.g. just migrated out of
  // localStorage) start with `summarizedCount === 0`, which means the
  // first /api/chat call would otherwise have to fold the entire backlog
  // into the running summary in chunked sequential summarize calls
  // before the user sees a single chat token. Kick that work off in the
  // background now so the next message feels as fast as any other.
  queuePrecomputeForLegacyConversations();
})();

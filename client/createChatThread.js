const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

// Mirror of MAX_HISTORY_MESSAGES in server.js — keep in sync.
// Used in the context-divider tooltip so users know how many recent
// messages the model still sees directly.
const MAX_HISTORY_MESSAGES = 20;

function cloneTyping() {
  return document
    .getElementById('typing-template')
    .content.firstElementChild.cloneNode(true);
}

function setSummaryPanelText(panel, summary) {
  const textEl = panel.querySelector('.context-summary-text');
  if (textEl) textEl.textContent = summary || '';
  if (panel.downloadButton) {
    panel.downloadButton.disabled = !summary;
  }
}

function canCopyToClipboard() {
  return typeof navigator !== 'undefined'
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === 'function';
}

function createCopySummaryButton(getSummary) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'context-summary-copy';
  btn.textContent = 'Copy';
  btn.title = 'Copy summary text to clipboard';

  let resetTimer = null;

  btn.addEventListener('click', async () => {
    const text = getSummary?.() || '';
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('is-copied');
    } catch {
      btn.textContent = 'Copy failed';
      btn.classList.add('is-error');
    }

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('is-copied', 'is-error');
      resetTimer = null;
    }, 1500);
  });

  return btn;
}

function todayDateStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function createDownloadSummaryButton(getSummary) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'context-summary-download';
  btn.textContent = 'Download';
  btn.title = 'Download summary as a .txt file';

  btn.addEventListener('click', () => {
    const text = getSummary?.() || '';
    if (!text) return;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `running-summary-${todayDateStamp()}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  });

  return btn;
}

function formatSummarizedCount(count) {
  return `(${count} ${count === 1 ? 'message' : 'messages'})`;
}

function setDividerCount(divider, summarizedCount) {
  const countEl = divider.querySelector('.context-divider-count');
  if (countEl) countEl.textContent = formatSummarizedCount(summarizedCount);
}

function createContextDivider(getSummary, summarizedCount, onSummaryEdit) {
  // Static skeleton lives in #context-divider-template in index.html.
  // We clone it and wire handlers / inject the conditional Copy + Download
  // buttons (which need closures over getSummary) here.
  const wrapper = document
    .getElementById('context-divider-template')
    .content.firstElementChild.cloneNode(true);

  const label = wrapper.querySelector('.context-divider-label');
  label.title =
    `The assistant only sees the last ${MAX_HISTORY_MESSAGES} messages directly. ` +
    `Earlier ones have been condensed into a running summary that's sent as context. ` +
    `Click to view the current summary.`;

  const count = wrapper.querySelector('.context-divider-count');
  count.textContent = formatSummarizedCount(summarizedCount);

  const panel = wrapper.querySelector('.context-summary-panel');
  const headingActions = wrapper.querySelector('.context-summary-heading-actions');
  const editBtn = wrapper.querySelector('.context-summary-edit-btn');
  const text = wrapper.querySelector('.context-summary-text');
  const editor = wrapper.querySelector('.context-summary-editor');
  const textarea = wrapper.querySelector('.context-summary-textarea');
  const saveBtn = wrapper.querySelector('.context-summary-save-btn');
  const cancelBtn = wrapper.querySelector('.context-summary-cancel-btn');

  if (canCopyToClipboard()) {
    headingActions.appendChild(createCopySummaryButton(getSummary));
  }

  const downloadBtn = createDownloadSummaryButton(getSummary);
  downloadBtn.disabled = !(getSummary?.() || '');
  headingActions.appendChild(downloadBtn);
  panel.downloadButton = downloadBtn;

  let editing = false;

  function enterEdit() {
    editing = true;
    textarea.value = getSummary?.() || '';
    text.hidden = true;
    editor.hidden = false;
    editBtn.hidden = true;
    textarea.focus();
  }

  function exitEdit() {
    editing = false;
    editor.hidden = true;
    text.hidden = false;
    editBtn.hidden = false;
    // Revert the visible text to the latest server-provided summary so any
    // updates that arrived during editing are reflected.
    setSummaryPanelText(panel, getSummary?.() || '');
  }

  editBtn.addEventListener('click', enterEdit);
  cancelBtn.addEventListener('click', exitEdit);
  saveBtn.addEventListener('click', () => {
    const newText = textarea.value;
    onSummaryEdit?.(newText);
    exitEdit();
  });

  // Expose editing state so the divider's refresh logic can avoid clobbering
  // a textarea the user is still typing into.
  panel.isEditing = () => editing;

  label.addEventListener('click', () => {
    if (panel.hidden) {
      setSummaryPanelText(panel, getSummary?.() || '');
      panel.hidden = false;
      label.setAttribute('aria-expanded', 'true');
    } else {
      panel.hidden = true;
      label.setAttribute('aria-expanded', 'false');
      // If the user collapses the panel mid-edit, drop the in-progress edit
      // so reopening shows a fresh editor with the latest server summary.
      if (editing) exitEdit();
    }
  });

  return wrapper;
}

// Places (or re-places) a single divider just above the first turn whose
// starting message index is at or after `summarizedCount`. Removes the
// divider entirely when nothing has been summarized yet. The divider's
// expandable summary panel reads from `getSummary` so it always reflects
// the latest server-provided summary text — including live refresh while
// the panel is already open.
function updateContextDivider(threadEl, summarizedCount, getSummary, onSummaryEdit) {
  let anchorTurn = null;
  if (summarizedCount > 0) {
    const turns = threadEl.querySelectorAll('.turn');
    for (const turn of turns) {
      const idx = Number(turn.dataset.msgStartIndex);
      if (Number.isFinite(idx) && idx >= summarizedCount) {
        anchorTurn = turn;
        break;
      }
    }
  }

  const existing = threadEl.querySelector('.context-divider');
  if (!anchorTurn) {
    if (existing) existing.remove();
    return;
  }

  if (!existing) {
    threadEl.insertBefore(
      createContextDivider(getSummary, summarizedCount, onSummaryEdit),
      anchorTurn,
    );
    return;
  }

  // Re-anchor the existing divider in front of the new first un-summarized
  // turn, preserving its open/closed state so users don't lose their place.
  if (existing.nextSibling !== anchorTurn) {
    threadEl.insertBefore(existing, anchorTurn);
  }

  // Keep the "(N messages)" hint on the label in sync as new messages are
  // folded into the summary.
  setDividerCount(existing, summarizedCount);

  // If the panel is already open, refresh its text so newly arrived
  // summaries appear without the user having to toggle. Skip the refresh
  // when the user is mid-edit so we don't clobber unsaved keystrokes.
  const panel = existing.querySelector('.context-summary-panel');
  if (panel && !panel.hidden && !panel.isEditing?.()) {
    setSummaryPanelText(panel, getSummary?.() || '');
  }
}

function appendClickableText(parent, text) {
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike) {
      const span = document.createElement('span');
      span.textContent = segment;
      span.className = 'clickable-word';
      span.onclick = () => onWordClick(span, segment);
      parent.appendChild(span);
    } else {
      parent.append(segment);
    }
  }
}

function appendTruncatedBadge(aiMsg) {
  const badge = document.createElement('span');
  badge.className = 'truncated-badge';
  badge.textContent = 'truncated';
  badge.title = 'This reply was cut off before it finished.';
  aiMsg.appendChild(badge);
}

// Render a stored timestamp in a human-readable local format. Mirrors
// the formatting used in exported transcripts (see exportConversations.js)
// so users see consistent times across the live thread and exports.
// Returns an empty string for missing/invalid timestamps so callers can
// skip the annotation entirely on legacy messages.
function formatMessageTime(ts) {
  if (ts === undefined || ts === null || ts === '') return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function appendMessageTime(msgEl, ts) {
  const text = formatMessageTime(ts);
  if (!text) return;
  const el = document.createElement('time');
  el.className = 'msg-time';
  el.textContent = text;
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) el.dateTime = d.toISOString();
  msgEl.appendChild(el);
}

// Renders an existing conversation. `onTruncatedAssistant(turn, aiMsg)` is
// invoked for any persisted assistant message flagged as truncated so the
// caller can attach a Retry affordance.
function renderExistingConversation(threadEl, conversation, onTruncatedAssistant) {
  let i = 0;
  while (i < conversation.length) {
    const turnStart = i;
    const turn = document.createElement('div');
    turn.className = 'turn';
    turn.dataset.msgStartIndex = String(turnStart);

    const msg = conversation[i];
    if (msg.role === 'user') {
      const userMsg = document.createElement('div');
      userMsg.className = 'user-msg';
      userMsg.textContent = msg.content;
      appendMessageTime(userMsg, msg.timestamp);
      turn.appendChild(userMsg);
      i++;

      if (i < conversation.length && conversation[i].role === 'assistant') {
        const assistantMsg = conversation[i];
        const aiMsg = document.createElement('div');
        aiMsg.className = 'ai-msg';
        appendClickableText(aiMsg, assistantMsg.content);
        if (assistantMsg.truncated) appendTruncatedBadge(aiMsg);
        appendMessageTime(aiMsg, assistantMsg.timestamp);
        turn.appendChild(aiMsg);
        if (assistantMsg.truncated) {
          onTruncatedAssistant?.(turn, aiMsg);
        }
        i++;
      }
    } else {
      const aiMsg = document.createElement('div');
      aiMsg.className = 'ai-msg';
      appendClickableText(aiMsg, msg.content);
      if (msg.truncated) appendTruncatedBadge(aiMsg);
      appendMessageTime(aiMsg, msg.timestamp);
      turn.appendChild(aiMsg);
      if (msg.truncated) {
        onTruncatedAssistant?.(turn, aiMsg);
      }
      i++;
    }

    threadEl.appendChild(turn);
  }
  threadEl.scrollTop = threadEl.scrollHeight;
}

// The full conversation is kept in memory for display and persistence, but
// only the slice that hasn't already been folded into the running summary is
// uploaded each turn. The server may then trim further and condense newly
// dropped turns into the summary; it returns an updated `summary` string and
// the count of additional messages folded in via the SSE stream.
function buildRequestBody(conversation, model, getMemoryState) {
  const memory = getMemoryState?.() || {};
  const summarizedCount = Math.max(
    0,
    Math.min(memory.summarizedCount || 0, conversation.length)
  );
  const settings = window.getAISettings?.() || {};
  const body = {
    messages: conversation.slice(summarizedCount),
    model: settings.model || model,
    temperature: typeof settings.temperature === 'number' ? settings.temperature : 1,
  };
  if (memory.summary) body.summary = memory.summary;
  if (settings.baseURL) body.baseURL = settings.baseURL;
  return body;
}

function createChatThread({
  threadEl,
  inputEl,
  model,
  conversation = [],
  onUpdate,
  onStreamStart,
  onStreamEnd,
  getMemoryState,
  onMemoryUpdate,
  onSummaryEdit,
  onUserMessage,
}) {
  const getSummaryText = () => getMemoryState?.()?.summary || '';

  let currentAbortController = null;

  function stop() {
    window.webllmEngine?.interruptGenerate?.();
    if (currentAbortController) {
      currentAbortController.abort();
    }
  }

  // Streams an assistant reply into the given `turn`/`aiMsg`. Used both
  // for fresh user input and for retrying a previously-truncated reply.
  // `aiMsg` should already contain the typing-dots placeholder.
  async function runStream(turn, aiMsg) {
    inputEl.disabled = true;
    threadEl.classList.remove('error');

    let firstChunk = true;
    let stream = '', buffer = '', assistantText = '';

    const render = (text, final = false) => {
      const parts = [...segmenter.segment(text)];
      const limit = final ? parts.length : parts.length - 1;

      for (let i = 0; i < limit; i++) {
        const { segment, isWordLike } = parts[i];

        if (isWordLike) {
          const span = document.createElement('span');
          span.textContent = segment;
          span.className = 'clickable-word';
          span.onclick = () => onWordClick(span, segment);
          aiMsg.appendChild(span);
        } else {
          aiMsg.append(segment);
        }
      }

      threadEl.scrollTop = threadEl.scrollHeight;

      return final ? '' : parts.at(-1)?.segment || '';
    };

    const abortController = new AbortController();
    currentAbortController = abortController;

    onStreamStart?.();
    try {
      if (window.webllmEngine) {
        const reqBody = buildRequestBody(conversation, model, getMemoryState);
        const chunks = await window.webllmEngine.chat.completions.create({
          messages: reqBody.messages,
          model: window.webllmModel,
          temperature: reqBody.temperature,
          stream: true,
        });
        for await (const chunk of chunks) {
          const token = chunk.choices[0]?.delta?.content || '';
          if (!token) continue;
          if (firstChunk) { aiMsg.replaceChildren(); firstChunk = false; }
          assistantText += token;
          buffer += token;
          buffer = render(buffer);
        }
        if (buffer) render(buffer, true);
        const assistantTs = Date.now();
        conversation.push({ role: 'assistant', content: assistantText, timestamp: assistantTs });
        appendMessageTime(aiMsg, assistantTs);
        onUpdate?.();
        return;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: window.getAIHeaders?.() || { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(conversation, model, getMemoryState)),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

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

          if (data.summarizing && firstChunk) {
            // Server is about to call the summary model — show a muted
            // status above the typing dots so users don't think the app
            // froze during the gap before the first chat token arrives.
            // The server fires one progress event per summary chunk; on
            // long legacy imports that's several events (chunk 1 of N,
            // chunk 2 of N, …), so we update the existing status node in
            // place rather than re-rendering the typing dots each time.
            const progress =
              data.summarizing && typeof data.summarizing === 'object'
                ? data.summarizing
                : null;
            const showProgress =
              progress && progress.total > 1 && progress.current > 0;
            const statusText = showProgress
              ? `Updating memory of earlier messages… chunk ${progress.current} of ${progress.total}`
              : 'Updating memory of earlier messages…';
            let statusEl = aiMsg.querySelector('.memory-status');
            if (!statusEl) {
              statusEl = document.createElement('div');
              statusEl.className = 'memory-status';
              aiMsg.replaceChildren(statusEl, cloneTyping());
            }
            statusEl.textContent = statusText;
          }

          if (data.content) {
            if (firstChunk) {
              aiMsg.replaceChildren();
              firstChunk = false;
            }
            assistantText += data.content;
            buffer += data.content;
            buffer = render(buffer);
          }

          if (typeof data.summary === 'string' && typeof data.newDropCount === 'number') {
            onMemoryUpdate?.(data.summary, data.newDropCount);
            updateContextDivider(
              threadEl,
              getMemoryState?.()?.summarizedCount || 0,
              getSummaryText,
              onSummaryEdit,
            );
          }
        }
      }

      if (buffer) render(buffer, true);

      const assistantTs = Date.now();
      conversation.push({ role: 'assistant', content: assistantText, timestamp: assistantTs });
      appendMessageTime(aiMsg, assistantTs);
      onUpdate?.();

    } catch (err) {
      if (err.name === 'AbortError') {
        if (buffer) render(buffer, true);
        if (assistantText) {
          const assistantTs = Date.now();
          conversation.push({ role: 'assistant', content: assistantText, timestamp: assistantTs });
          appendMessageTime(aiMsg, assistantTs);
          onUpdate?.();
        } else {
          aiMsg.remove();
        }
      } else {
        threadEl.classList.add('error');
        if (assistantText) {
          if (buffer) buffer = render(buffer, true);
          appendTruncatedBadge(aiMsg);
          const errNote = document.createElement('div');
          errNote.className = 'stream-error';
          errNote.textContent = `Error: ${err.message}`;
          aiMsg.appendChild(errNote);
          const assistantTs = Date.now();
          conversation.push({
            role: 'assistant',
            content: assistantText,
            truncated: true,
            timestamp: assistantTs,
          });
          appendMessageTime(aiMsg, assistantTs);
          onUpdate?.();
          attachRetry(turn, aiMsg);
        } else {
          aiMsg.textContent = `Error: ${err.message}`;
          const retryBtn = document.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'retry-btn';
          retryBtn.textContent = 'Retry';
          retryBtn.title = 'Try generating this reply again';
          retryBtn.addEventListener('click', () => {
            if (currentAbortController) return;
            aiMsg.replaceChildren(cloneTyping());
            threadEl.classList.remove('error');
            runStream(turn, aiMsg);
          });
          aiMsg.appendChild(retryBtn);
        }
      }
    } finally {
      if (currentAbortController === abortController) {
        currentAbortController = null;
      }
      onStreamEnd?.();
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  // Drops the truncated assistant reply (and anything after it) from
  // both the conversation array and the DOM, then re-runs the stream
  // against the unchanged preceding user message. The aiMsg DOM element
  // is reused so the visual position of the reply stays put.
  function doRetry(turn, aiMsg) {
    if (currentAbortController) return; // another stream in flight

    const startIdx = Number(turn.dataset.msgStartIndex);
    if (!Number.isFinite(startIdx)) return;

    let assistantIdx;
    if (conversation[startIdx]?.role === 'assistant') {
      assistantIdx = startIdx;
    } else {
      assistantIdx = startIdx + 1;
    }

    if (conversation[assistantIdx]?.role !== 'assistant') return;

    // Discard the truncated reply plus any messages that came after it
    // (e.g. if the user sent a follow-up before deciding to retry).
    conversation.splice(assistantIdx);

    // Tear down DOM for everything past this turn so the thread reflects
    // the trimmed conversation. updateContextDivider is run after the
    // splice so the divider re-anchors (or disappears) correctly.
    let next = turn.nextSibling;
    while (next) {
      const cur = next;
      next = next.nextSibling;
      cur.remove();
    }

    // Reset this aiMsg back to a typing-dots placeholder; runStream will
    // replace its contents on the first streamed token.
    aiMsg.replaceChildren(cloneTyping());
    threadEl.classList.remove('error');

    // Clamp the saved summarizedCount back down if it now exceeds the
    // (shorter) conversation length. The handler's clamp uses the
    // current conversation.length, so this is a no-op when nothing
    // needs trimming.
    onMemoryUpdate?.(getMemoryState?.()?.summary || '', 0);
    onUpdate?.();
    updateContextDivider(
      threadEl,
      getMemoryState?.()?.summarizedCount || 0,
      getSummaryText,
      onSummaryEdit,
    );

    threadEl.scrollTop = threadEl.scrollHeight;
    runStream(turn, aiMsg);
  }

  // Adds a Retry button to a truncated assistant message. Idempotent so
  // it's safe to call again on a message that already has one.
  function attachRetry(turn, aiMsg) {
    if (aiMsg.querySelector('.retry-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'retry-btn';
    btn.textContent = 'Retry';
    btn.title = 'Try generating this reply again';
    btn.addEventListener('click', () => doRetry(turn, aiMsg));
    aiMsg.appendChild(btn);
  }

  if (conversation.length > 0) {
    renderExistingConversation(threadEl, conversation, attachRetry);
    updateContextDivider(
      threadEl,
      getMemoryState?.()?.summarizedCount || 0,
      getSummaryText,
      onSummaryEdit,
    );
  }

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;

    const question = inputEl.value.trim();
    if (!question) return;

    inputEl.value = '';

    const turn = document.createElement('div');
    turn.className = 'turn';
    // The user message is pushed to `conversation` below — its index is
    // the current length. Recording it here lets the context divider
    // re-anchor to the right turn after summary updates.
    turn.dataset.msgStartIndex = String(conversation.length);

    const userTs = Date.now();
    const userMsg = document.createElement('div');
    userMsg.className = 'user-msg';
    userMsg.textContent = question;
    appendMessageTime(userMsg, userTs);
    turn.appendChild(userMsg);

    const aiMsg = document.createElement('div');
    aiMsg.className = 'ai-msg';
    aiMsg.appendChild(cloneTyping());
    turn.appendChild(aiMsg);

    threadEl.appendChild(turn);
    threadEl.scrollTop = threadEl.scrollHeight;

    conversation.push({ role: 'user', content: question, timestamp: userTs });
    onUpdate?.();
    // Fired after the message is queued but before the chat request goes
    // out. The caller uses this to cancel any background precompute that
    // was running for this conversation so the chat path doesn't race
    // with it (last-write-wins on `summary` / `summarizedCount`).
    onUserMessage?.();

    await runStream(turn, aiMsg);
  });

  return { stop };
}

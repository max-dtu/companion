function conversationHeading(convo, index) {
  const base = convo.title?.trim() || `Conversation ${index + 1}`;
  return `${base} (${convo.model})`;
}

function hasSummary(convo) {
  return typeof convo.summary === 'string' && convo.summary.trim().length > 0;
}

// Render a message timestamp in a human-readable local format. Messages
// stored before timestamps were introduced (or any other case where the
// field is missing or invalid) return an empty string so callers can omit
// the timestamp entirely instead of printing "undefined" or empty brackets.
function formatTimestamp(ts) {
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

// Derive the conversation's started/last-updated times from its first and
// last messages that carry a usable timestamp. Returns null when no message
// has a timestamp, so callers can omit the line/fields entirely instead of
// showing empty placeholders.
function conversationTimeRange(convo) {
  const msgs = convo.messages || [];
  let startedAt = null;
  let updatedAt = null;
  for (const m of msgs) {
    if (m.timestamp === undefined || m.timestamp === null || m.timestamp === '') continue;
    const d = new Date(m.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    if (startedAt === null) startedAt = d;
    updatedAt = d;
  }
  if (startedAt === null) return null;
  return { startedAt, updatedAt };
}

function formatTimeRangeLine(range) {
  return `Started ${formatTimestamp(range.startedAt)} · Last updated ${formatTimestamp(range.updatedAt)}`;
}

function conversationsToMarkdown(conversations) {
  return conversations
    .map((convo, i) => {
      const turns = convo.messages
        .map((msg) => {
          const who = msg.role === 'user' ? 'You' : 'AI';
          const ts = formatTimestamp(msg.timestamp);
          const label = ts ? `**${who}** _(${ts})_:` : `**${who}:**`;
          return `${label} ${msg.content}`;
        })
        .join('\n\n');
      const summaryBlock = hasSummary(convo)
        ? `### Earlier-context summary\n\n${convo.summary.trim()}\n\n`
        : '';
      const range = conversationTimeRange(convo);
      const timeBlock = range ? `_${formatTimeRangeLine(range)}_\n\n` : '';
      return `## ${conversationHeading(convo, i)}\n\n${timeBlock}${summaryBlock}${turns}`;
    })
    .join('\n\n---\n\n');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function conversationsToHtml(conversations) {
  const sections = conversations
    .map((convo, i) => {
      const turns = convo.messages
        .map((msg) => {
          const label = msg.role === 'user' ? 'You' : 'AI';
          const ts = formatTimestamp(msg.timestamp);
          const tsHtml = ts
            ? ` <time class="msg-time">${escapeHtml(ts)}</time>`
            : '';
          return `    <div class="msg ${msg.role}"><strong>${label}:</strong>${tsHtml} ${escapeHtml(msg.content)}</div>`;
        })
        .join('\n');
      const summaryBlock = hasSummary(convo)
        ? `    <div class="summary"><h3>Earlier-context summary</h3><p>${escapeHtml(convo.summary.trim())}</p></div>\n`
        : '';
      const range = conversationTimeRange(convo);
      const timeBlock = range
        ? `    <p class="convo-time">${escapeHtml(formatTimeRangeLine(range))}</p>\n`
        : '';
      return `  <section>\n    <h2>Conversation ${i + 1} (${escapeHtml(convo.model)})</h2>\n${timeBlock}${summaryBlock}${turns}\n  </section>`;
    })
    .join('\n  <hr>\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Read — Exported Conversations</title>
<style>
  body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  section { margin-bottom: 2rem; }
  h2 { font-size: 1.1rem; color: #333; }
  .convo-time { color: #888; font-size: 0.85rem; margin: 0 0 0.75rem; }
  .summary { background: #f5f5f5; border-left: 3px solid #888; padding: 0.5rem 0.75rem; margin: 0.75rem 0; }
  .summary h3 { margin: 0 0 0.25rem; font-size: 0.95rem; color: #555; }
  .summary p { margin: 0; white-space: pre-wrap; color: #333; }
  .msg { margin: 0.75rem 0; white-space: pre-wrap; }
  .msg.user { color: #007aff; }
  .msg.assistant { color: #222; }
  .msg-time { color: #888; font-size: 0.85em; font-weight: normal; margin-left: 0.25rem; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
</style>
</head>
<body>
${sections}
</body>
</html>`;
}

function conversationsToText(conversations) {
  return conversations
    .map((convo, i) => {
      const turns = convo.messages
        .map((msg) => {
          const who = msg.role === 'user' ? 'You' : 'AI';
          const ts = formatTimestamp(msg.timestamp);
          const label = ts ? `${who} (${ts})` : who;
          return `${label}: ${msg.content}`;
        })
        .join('\n\n');
      const heading = conversationHeading(convo, i);
      const summaryBlock = hasSummary(convo)
        ? `Earlier-context summary:\n${convo.summary.trim()}\n\n`
        : '';
      const range = conversationTimeRange(convo);
      const timeBlock = range ? `${formatTimeRangeLine(range)}\n\n` : '';
      return `${heading}\n${'='.repeat(20)}\n\n${timeBlock}${summaryBlock}${turns}`;
    })
    .join('\n\n\n');
}

function downloadFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugifyTitle(title) {
  const cleaned = (title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return cleaned || 'conversation';
}

function exportConversations(conversations, format, options = {}) {
  const nonEmpty = conversations.filter((c) => c.messages.length > 0);
  if (!nonEmpty.length) return;

  const date = new Date().toISOString().slice(0, 10);
  const base = options.baseName || `read-conversations-${date}`;

  if (format === 'json') {
    const payload = nonEmpty.map((c) => {
      const entry = {
        title: c.title?.trim() || '',
        model: c.model,
        messages: c.messages.map((m) => {
          const out = { role: m.role, content: m.content };
          if (m.truncated) out.truncated = true;
          // Normalize timestamps to ISO 8601 so JSON exports are a clean,
          // portable archive. Drop the field entirely when it's missing or
          // unparseable so older messages export without "timestamp": null.
          if (m.timestamp !== undefined && m.timestamp !== null && m.timestamp !== '') {
            const d = new Date(m.timestamp);
            if (!Number.isNaN(d.getTime())) out.timestamp = d.toISOString();
          }
          return out;
        }),
      };
      if (hasSummary(c)) entry.summary = c.summary.trim();
      const range = conversationTimeRange(c);
      if (range) {
        entry.startedAt = range.startedAt.toISOString();
        entry.updatedAt = range.updatedAt.toISOString();
      }
      return entry;
    });
    downloadFile(JSON.stringify(payload, null, 2), 'application/json', `${base}.json`);
  } else if (format === 'markdown') {
    downloadFile(conversationsToMarkdown(nonEmpty), 'text/markdown', `${base}.md`);
  } else if (format === 'html') {
    downloadFile(conversationsToHtml(nonEmpty), 'text/html', `${base}.html`);
  } else if (format === 'text') {
    downloadFile(conversationsToText(nonEmpty), 'text/plain', `${base}.txt`);
  }
}

function exportSingleConversation(conversation, format) {
  if (!conversation || !conversation.messages || conversation.messages.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const baseName = `read-${slugifyTitle(conversation.title)}-${date}`;
  exportConversations([conversation], format, { baseName });
}

// Render a single conversation to a plain string in the given text format,
// suitable for writing to the clipboard. Only formats that are meaningfully
// useful as pasted text are supported here — JSON and HTML stay
// download-only because they're awkward to paste into chats/docs/email.
// Returns null for unknown/unsupported formats so callers can decide how to
// react.
function conversationToCopyableString(conversation, format) {
  if (!conversation || !conversation.messages || conversation.messages.length === 0) return null;
  if (format === 'markdown') return conversationsToMarkdown([conversation]);
  if (format === 'text') return conversationsToText([conversation]);
  return null;
}

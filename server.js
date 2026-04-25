const express = require('express');
const OpenAI = require('openai').default;
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const serverOpenAI = process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    })
  : null;

// Returns a per-request OpenAI client when the request supplies its own
// apiKey (via Authorization header) or baseURL, falling back to the
// server-level client.
function resolveClient(req, { baseURL } = {}) {
  const authHeader = req.headers['authorization'] || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (baseURL || apiKey) {
    return new OpenAI({
      apiKey: apiKey || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || 'local',
      baseURL: baseURL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return serverOpenAI;
}

// History-trimming rule for /api/chat:
// The full conversation is persisted client-side. To keep latency, token cost,
// and context usage in check, we cap the history sent to the model: any
// leading system messages are preserved, then we keep only the most recent
// MAX_HISTORY_MESSAGES non-system messages. If the cut would land on an
// assistant message (orphaning a reply from its user turn), we drop one more
// so the trimmed history starts with a user message.
//
// To avoid losing earlier context entirely (persona, vocabulary, corrections
// etc.), the dropped turns are condensed into a short running "summary so
// far" using the cheap SUMMARY_MODEL. The summary is prepended as a system
// message and grows incrementally: each request only folds in the *newly*
// dropped turns rather than re-summarizing from scratch.
//
// The client sends `conversation.slice(summarizedCount)` as `messages` plus
// the prior `summary` string. The server streams the chat reply, then sends
// a final SSE event `{ summary, newDropCount }` so the client can update
// its local state.
// Mirrored on the client (see MAX_HISTORY_MESSAGES in
// client/createChatThread.js) so the in-thread "older messages condensed"
// divider's tooltip stays accurate. Keep both values in sync.
const MAX_HISTORY_MESSAGES = 20;
const SUMMARY_MODEL = 'gpt-4o-mini';
const SUMMARY_HEADER =
  'Summary of earlier turns in this conversation (older messages were trimmed for brevity — use this as context):\n';
// Cap on how many messages get folded into the summary in a single API call.
// Protects against a first-request spike when a long legacy thread arrives
// with `summarizedCount = 0` and dozens of trimmed messages need to be
// summarized at once. Larger backlogs are processed in sequential chunks so
// each summarize call stays small and bounded.
const SUMMARY_CHUNK_SIZE = 30;

function splitSystemPrefix(messages) {
  const systemPrefix = [];
  let i = 0;
  while (i < messages.length && messages[i].role === 'system') {
    systemPrefix.push(messages[i]);
    i++;
  }
  return { systemPrefix, rest: messages.slice(i) };
}

async function summarizeInChunks(openai, prevSummary, newTurns, onProgress, signal, summaryModel) {
  let summary = prevSummary || '';
  const total = Math.ceil(newTurns.length / SUMMARY_CHUNK_SIZE);
  for (let i = 0; i < newTurns.length; i += SUMMARY_CHUNK_SIZE) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    const current = Math.floor(i / SUMMARY_CHUNK_SIZE) + 1;
    // Fire the progress hint *before* the (slow) summarize call so the
    // client's status text updates as each chunk starts, not after it
    // finishes. The first call here also covers the "we're about to
    // summarize at all" hint that used to be a separate up-front event.
    onProgress?.(current, total);
    const chunk = newTurns.slice(i, i + SUMMARY_CHUNK_SIZE);
    summary = await summarizeOnce(openai, summary, chunk, signal, summaryModel);
  }
  return summary;
}

async function summarizeOnce(openai, prevSummary, newTurns, signal, summaryModel) {
  const transcript = newTurns
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const userPrompt = prevSummary
    ? `You are maintaining a running summary of an ongoing chat between a user and an assistant. Update the existing summary to incorporate the new turns below. Keep it under 250 words. Preserve key facts: any persona or instructions the user established, learning goals, vocabulary or phrases discussed, corrections, and ongoing topics. Write in plain prose with no preamble or headings.\n\nExisting summary:\n${prevSummary}\n\nNew turns to fold in:\n${transcript}`
    : `Summarize the following turns of a chat between a user and an assistant into a concise running summary (under 250 words). Preserve key facts: any persona or instructions the user established, learning goals, vocabulary or phrases discussed, corrections, and ongoing topics. Write in plain prose with no preamble or headings.\n\n${transcript}`;

  const completion = await openai.chat.completions.create(
    {
      model: summaryModel || SUMMARY_MODEL,
      messages: [{ role: 'user', content: userPrompt }],
    },
    signal ? { signal } : undefined,
  );
  return completion.choices[0]?.message?.content?.trim() || prevSummary || '';
}

// Decides what to send to the chat model and whether the running summary
// needs to grow. Returns:
//   - messagesForModel: the array to pass to the chat completion
//   - summary: the (possibly updated) summary string
//   - newDropCount: how many additional leading messages of the request's
//     `messages` array were folded into the summary on this call. The client
//     adds this to its local `summarizedCount`.
async function buildHistory(openai, messages, prevSummary, onSummaryProgress, signal, summaryModel) {
  const { systemPrefix, rest } = splitSystemPrefix(messages);
  let summary = prevSummary || '';
  let newDropCount = 0;
  let trimmed = rest;

  if (rest.length > MAX_HISTORY_MESSAGES) {
    let dropCount = rest.length - MAX_HISTORY_MESSAGES;
    trimmed = rest.slice(dropCount);
    if (trimmed[0]?.role === 'assistant') {
      dropCount += 1;
      trimmed = trimmed.slice(1);
    }
    const newlyDropped = rest.slice(0, dropCount);
    summary = await summarizeInChunks(openai, summary, newlyDropped, onSummaryProgress, signal, summaryModel);
    newDropCount = dropCount;
  }

  const summaryMsg = summary
    ? [{ role: 'system', content: SUMMARY_HEADER + summary }]
    : [];

  return {
    messagesForModel: [...systemPrefix, ...summaryMsg, ...trimmed],
    summary,
    newDropCount,
  };
}

app.post('/api/chat', async (req, res) => {
  const { messages, model, summary: prevSummary, baseURL, temperature } = req.body;
  const openai = resolveClient(req, { baseURL });
  const summaryModel = baseURL ? (model || SUMMARY_MODEL) : SUMMARY_MODEL;
  if (!openai) return res.status(503).json({ error: 'AI features unavailable: no API key configured.' });
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Messages are required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // If the client disconnects mid-stream (e.g. user clicked Stop, navigated
  // away, or refreshed), abort the upstream OpenAI requests — both the
  // summary calls in `buildHistory` and the chat completion below — so we
  // stop being billed for tokens the user has rejected and free the request
  // slot. Wired before `buildHistory` so the (slow) warm-up summarization
  // is interruptible too.
  const upstreamAbort = new AbortController();
  let clientClosed = false;
  const onClientClose = () => {
    clientClosed = true;
    upstreamAbort.abort();
  };
  res.on('close', onClientClose);

  // Hint the client when we're about to call the summary model so it can
  // show an "updating memory" status during the gap before chat tokens
  // start streaming. `summarizeInChunks` invokes the progress callback
  // *before* each chunk's API call, so the very first event also serves
  // as the initial "we're summarizing" hint — no separate up-front event
  // is needed. On long legacy imports the backlog is processed in
  // multiple SUMMARY_CHUNK_SIZE-sized chunks, and each chunk triggers a
  // fresh `{ summarizing: { current, total } }` event so the client can
  // show "chunk X of Y" instead of a static status.
  let history;
  try {
    history = await buildHistory(openai, messages, prevSummary, (current, total) => {
      res.write(
        `data: ${JSON.stringify({ summarizing: { current, total } })}\n\n`
      );
    }, upstreamAbort.signal, summaryModel);
  } catch (err) {
    if (clientClosed || err?.name === 'AbortError') {
      res.off('close', onClientClose);
      return;
    }
    console.error('Summary build error:', err);
    // If summarization fails, fall back to a plain trim so the chat still
    // works — the client just won't get an updated summary this turn.
    const { systemPrefix, rest } = splitSystemPrefix(messages);
    let trimmed = rest;
    if (rest.length > MAX_HISTORY_MESSAGES) {
      trimmed = rest.slice(-MAX_HISTORY_MESSAGES);
      if (trimmed[0]?.role === 'assistant') trimmed = trimmed.slice(1);
    }
    const summaryMsg = prevSummary
      ? [{ role: 'system', content: SUMMARY_HEADER + prevSummary }]
      : [];
    history = {
      messagesForModel: [...systemPrefix, ...summaryMsg, ...trimmed],
      summary: prevSummary || '',
      newDropCount: 0,
    };
  }

  try {
    const stream = await openai.chat.completions.create(
      {
        model: model || 'gpt-4o',
        messages: history.messagesForModel,
        stream: true,
        temperature: typeof temperature === 'number' ? temperature : 1,
      },
      { signal: upstreamAbort.signal }
    );

    try {
      for await (const chunk of stream) {
        if (clientClosed) break;
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    } finally {
      // Ensure the underlying HTTP stream is released even if we broke out
      // early so the OpenAI SDK doesn't keep the socket open in the
      // background.
      stream.controller?.abort?.();
    }

    if (clientClosed) return;

    if (history.newDropCount > 0) {
      res.write(
        `data: ${JSON.stringify({
          summary: history.summary,
          newDropCount: history.newDropCount,
        })}\n\n`
      );
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    // A client cancel surfaces here as an AbortError from the OpenAI SDK —
    // that's the success path for this code, not something to log or report
    // back (the response is already gone).
    if (clientClosed || err?.name === 'AbortError') return;

    console.error('OpenAI error:', err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Failed to get response.' })}\n\n`);
      res.end();
    }
  } finally {
    res.off('close', onClientClose);
  }
});

// Proactive summarization for long imported/legacy threads. Lets the client
// fold a backlog into the running summary outside a /api/chat turn so the
// next user message doesn't pay the "summarize from scratch" tax. Reuses
// `buildHistory` (and therefore `summarizeInChunks`) so the chunked
// `{ summarizing: { current, total } }` SSE protocol matches /api/chat.
//
// Body: `{ messages, summary }` — the same shape /api/chat expects (the
// client sends `conversation.slice(summarizedCount)` plus the prior
// summary). Response: a stream of `{ summarizing }` events followed by a
// final `{ summary, newDropCount, done: true }` event. Short backlogs
// (`messages.length <= MAX_HISTORY_MESSAGES`) finish immediately with
// `newDropCount: 0`.
app.post('/api/summarize', async (req, res) => {
  const { messages, model, summary: prevSummary, baseURL } = req.body;
  const openai = resolveClient(req, { baseURL });
  const summaryModel = baseURL ? (model || SUMMARY_MODEL) : SUMMARY_MODEL;
  if (!openai) return res.status(503).json({ error: 'AI features unavailable: no API key configured.' });
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Messages are required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Same abort plumbing as /api/chat: when the client disconnects (browser
  // tab closed, fetch().signal aborted by the precompute canceller, etc.)
  // we propagate the abort into the summary-model calls so background work
  // doesn't keep burning tokens after the user has moved on.
  const upstreamAbort = new AbortController();
  let clientClosed = false;
  const onClientClose = () => {
    clientClosed = true;
    upstreamAbort.abort();
  };
  res.on('close', onClientClose);

  try {
    const history = await buildHistory(openai, messages, prevSummary, (current, total) => {
      if (clientClosed) return;
      res.write(`data: ${JSON.stringify({ summarizing: { current, total } })}\n\n`);
    }, upstreamAbort.signal, summaryModel);
    if (clientClosed) return;
    res.write(
      `data: ${JSON.stringify({
        summary: history.summary,
        newDropCount: history.newDropCount,
        done: true,
      })}\n\n`
    );
    res.end();
  } catch (err) {
    if (clientClosed || err?.name === 'AbortError') return;
    console.error('Summarize error:', err);
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({ error: err.message || 'Failed to summarize.' })}\n\n`
      );
      res.end();
    }
  } finally {
    res.off('close', onClientClose);
  }
});

app.post('/api/lookup', async (req, res) => {
  const { word, sentence, baseURL } = req.body;
  const openai = resolveClient(req, { baseURL });
  if (!openai) return res.status(503).json({ error: 'AI features unavailable: no API key configured.' });
  if (!word) {
    return res.status(400).json({ error: 'Word is required.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Given the word "${word}" used in this context: "${sentence}", respond ONLY with a JSON object in this exact shape: {"meaning": "<brief simple meaning>", "lang": "<BCP-47 language tag of the WORD itself (not the surrounding context). For example, if the word is "Amor" return es-ES or pt-BR, if "محبت" return ur-PK, if "Amour" return fr-FR. Use the context only as a hint to disambiguate.>"}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw);
    res.json({
      meaning: parsed.meaning || 'No definition found.',
      lang: parsed.lang || null,
    });
  } catch (err) {
    console.error('Lookup error:', err);
    res.status(500).json({ error: err.message || 'Failed to get definition.' });
  }
});

app.post('/api/pull', async (req, res) => {
  const { model, baseURL } = req.body;
  if (!model) return res.status(400).json({ error: 'Model name required.' });

  // Derive Ollama base: strip the /v1 suffix that the OpenAI-compat URL has
  const ollamaBase = (baseURL || 'http://localhost:11434').replace(/\/v1\/?$/, '');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const pullRes = await fetch(`${ollamaBase}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });

    if (!pullRes.ok) {
      const errText = await pullRes.text().catch(() => pullRes.status);
      res.write(`data: ${JSON.stringify({ error: `Ollama returned HTTP ${pullRes.status}: ${errText}` })}\n\n`);
      res.end();
      return;
    }

    const reader  = pullRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          if (data.status === 'success') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
        } catch {}
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      let msg = err.message || 'Unknown error';
      if (msg === 'fetch failed') {
        const cause = err.cause;
        const code  = cause?.code ?? cause?.errors?.[0]?.code;
        if (code === 'ECONNREFUSED') {
          msg = `Cannot reach Ollama at ${ollamaBase} — make sure Ollama is running (ollama serve).`;
        } else if (code === 'ENOTFOUND') {
          msg = `Cannot resolve host in "${ollamaBase}" — check the Base URL in AI Settings.`;
        } else {
          msg = cause?.message || msg;
        }
      }
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/test', async (req, res) => {
  const { model, baseURL } = req.body;
  const openai = resolveClient(req, { baseURL });
  if (!openai) return res.json({ ok: false, error: 'No API key configured on the server.' });
  try {
    const completion = await openai.chat.completions.create({
      model: model || SUMMARY_MODEL,
      messages: [{ role: 'user', content: 'Reply with just "ok".' }],
      max_tokens: 5,
    });
    res.json({ ok: true, model: completion.model || model || '' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

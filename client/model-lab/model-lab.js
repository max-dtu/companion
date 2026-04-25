// ============================================================
// Model Lab — logic only.
// HTML lives in model-lab.html, styles in model-lab.css.
// To remove the feature: delete the model-lab/ folder
// and its <script> tag from index.html.
// ============================================================
const _labScript = document.currentScript;
(async function initModelLab() {
  'use strict';

  const BASE = _labScript
    ? _labScript.src.replace(/[^/]*$/, '')
    : 'client/model-lab/';

  // ---- Load CSS ----
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = BASE + 'model-lab.css';
  document.head.appendChild(link);

  // ---- Load HTML into a <dialog> ----
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return;

  let html;
  try {
    const res = await fetch(BASE + 'model-lab.html');
    if (!res.ok) return;
    html = await res.text();
  } catch { return; }

  const dialog = document.createElement('dialog');
  dialog.className = 'lab-dialog';
  dialog.innerHTML = html;
  document.body.appendChild(dialog);

  // ---- Header button ----
  const labBtn = document.createElement('button');
  labBtn.type = 'button';
  labBtn.className = 'icon-btn';
  labBtn.title = 'Model Lab';
  labBtn.setAttribute('aria-label', 'Open Model Lab');
  labBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>';
  headerRight.insertBefore(labBtn, headerRight.firstChild);

  // ---- DOM references ----
  const closeBtn    = dialog.querySelector('.lab-close');
  const tabs        = dialog.querySelectorAll('.lab-tab');
  const panes       = dialog.querySelectorAll('.lab-pane');
  const textarea    = dialog.querySelector('.lab-textarea');
  const logEl       = dialog.querySelector('[data-pane="train"] .lab-log');
  const chatLogEl   = dialog.querySelector('#lab-chat-log');
  const trainBtn    = dialog.querySelector('[data-action="train"]');
  const stopBtn     = dialog.querySelector('[data-action="stop"]');
  const generateBtn = dialog.querySelector('[data-action="generate"]');
  const paramInputs = {};
  dialog.querySelectorAll('[data-param]').forEach(el => { paramInputs[el.dataset.param] = el; });

  // ---- Dialog open / close ----
  labBtn.addEventListener('click', () => dialog.showModal());
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  // ---- Tab switching ----
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    dialog.querySelector(`[data-pane="${tab.dataset.tab}"]`).classList.add('active');
  }));

  // ---- Log helper ----
  function log(tag, msg, target) {
    const el = target || logEl;
    const span = document.createElement('span');
    span.className = `t-${tag}`;
    span.textContent = `[${tag}] ${msg}\n`;
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }

  // ===========================================================
  // CHAT STATS INTERCEPTOR
  // ===========================================================
  const session = { requests: 0, inputTokens: 0, outputTokens: 0, totalTime: 0 };
  const _fetch = window.fetch;

  window.fetch = function(url, opts) {
    if (typeof url !== 'string' || !url.endsWith('/api/chat'))
      return _fetch.apply(this, arguments);

    let body;
    try { body = JSON.parse(opts?.body || '{}'); } catch { body = {}; }
    const t0 = performance.now();
    let outputChars = 0, firstChunk = true, ttfb = 0;

    return _fetch.apply(this, arguments).then(res => {
      if (!res.ok || !res.body) return res;

      const decoder = new TextDecoder();
      const { readable, writable } = new TransformStream({
        transform(chunk, controller) {
          if (firstChunk) { ttfb = performance.now() - t0; firstChunk = false; }
          const text = decoder.decode(chunk, { stream: true });
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.content) outputChars += d.content.length;
              if (d.done) {
                const totalMs = performance.now() - t0;
                const inputMsgs = body.messages?.length || 0;
                const inputChars = JSON.stringify(body.messages || []).length;
                const inputTok = Math.ceil(inputChars / 4);
                const outputTok = Math.ceil(outputChars / 4);
                const tokSec = totalMs > 0 ? (outputTok / (totalMs / 1000)).toFixed(1) : '—';

                session.requests++;
                session.inputTokens += inputTok;
                session.outputTokens += outputTok;
                session.totalTime += totalMs;

                updateStatCards(body, inputMsgs, inputTok, outputTok, ttfb, totalMs, tokSec);
                log('chat',
                  `${body.model || '?'} | in:~${inputTok} tok (${inputMsgs} msgs) | out:~${outputTok} tok | ${(totalMs/1000).toFixed(1)}s (${tokSec} tok/s) | ttfb:${(ttfb/1000).toFixed(2)}s | temp:${body.temperature ?? '—'}`,
                  chatLogEl);
              }
            } catch {}
          }
          controller.enqueue(chunk);
        },
      });
      res.body.pipeTo(writable);
      return new Response(readable, { status: res.status, statusText: res.statusText, headers: res.headers });
    });
  };

  function updateStatCards(body, inputMsgs, inputTok, outputTok, ttfb, totalMs, tokSec) {
    const lastEl = document.getElementById('lab-stat-last');
    const sessEl = document.getElementById('lab-stat-session');
    if (lastEl) lastEl.innerHTML =
      `<b>Model:</b> ${body.model || '?'} &nbsp;|&nbsp; <b>Temp:</b> ${body.temperature ?? '—'}<br>` +
      `<b>Input:</b> ${inputMsgs} msgs (~${inputTok} tok est.)<br>` +
      `<b>Output:</b> ~${outputTok} tok in ${(totalMs/1000).toFixed(1)}s<br>` +
      `<b>Speed:</b> ${tokSec} tok/s &nbsp;|&nbsp; <b>TTFB:</b> ${(ttfb/1000).toFixed(2)}s`;
    if (sessEl) sessEl.innerHTML =
      `<b>Requests:</b> ${session.requests}<br>` +
      `<b>Input tokens:</b> ~${session.inputTokens.toLocaleString()}<br>` +
      `<b>Output tokens:</b> ~${session.outputTokens.toLocaleString()}<br>` +
      `<b>Total time:</b> ${(session.totalTime/1000).toFixed(1)}s`;
  }

  // ===========================================================
  // TF.js LAZY LOADER
  // ===========================================================
  function loadTf() {
    if (window.tf) return Promise.resolve(window.tf);
    return new Promise((resolve, reject) => {
      log('info', 'Downloading TensorFlow.js (~2 MB, first time only)…');
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
      s.onload = () => {
        log('info', `TF.js ${tf.version.tfjs} ready (backend: ${tf.getBackend()})`);
        log('learn', 'TF.js uses WebGL/WebGPU to run math on your GPU — same hardware that renders games.');
        resolve(window.tf);
      };
      s.onerror = () => reject(new Error('Failed to load TensorFlow.js'));
      document.head.appendChild(s);
    });
  }

  // ===========================================================
  // TRAINING
  // ===========================================================
  let model = null, tokenizer = null, stopped = false;

  trainBtn.addEventListener('click', startTraining);
  stopBtn.addEventListener('click', () => { stopped = true; });
  generateBtn.addEventListener('click', runGenerate);

  async function startTraining() {
    const text = textarea.value.trim();
    const seqLenCheck = parseInt(paramInputs.seqLen.value) || 40;
    const minLen = Math.max(50, seqLenCheck + 2);
    if (text.length < minLen) { log('error', `Need at least ${minLen} characters of training text (seq length is ${seqLenCheck}).`); return; }

    trainBtn.disabled = true; stopBtn.disabled = false; generateBtn.disabled = true;
    stopped = false;
    logEl.innerHTML = '';

    try {
      const tf = await loadTf();
      if (model) { model.dispose(); model = null; }

      // ---- Tokenizer ----
      log('info', '═══ STEP 1: TOKENIZATION ═══');
      log('learn', 'Computers need numbers, not letters. We assign each unique character an integer ID.');

      const chars = [...new Set([...text])].sort();
      const charToIdx = Object.fromEntries(chars.map((c, i) => [c, i]));
      const idxToChar = chars;
      const vocabSize = chars.length;
      tokenizer = { charToIdx, idxToChar, vocabSize };

      log('info', `Found ${vocabSize} unique characters in your text`);
      log('info', `Vocabulary: ${chars.map(c => c === '\n' ? '\\n' : c === ' ' ? '·' : c).join('')}`);
      log('info', `Text: ${text.length} chars = ${text.length} tokens (at char-level, 1 char = 1 token)`);
      const sample = text.slice(0, 24);
      log('info', `Example: "${sample}" → [${[...sample].map(c => charToIdx[c]).join(', ')}]`);
      log('learn', 'GPT uses ~100K "subword" tokens (e.g. "un" + "believ" + "able"). We use raw chars for simplicity.');

      // ---- Encode ----
      const encoded = [...text].map(c => charToIdx[c]);

      // ---- Params ----
      const hidden = parseInt(paramInputs.hidden.value) || 128;
      const lr     = parseFloat(paramInputs.lr.value) || 0.003;
      const seqLen = parseInt(paramInputs.seqLen.value) || 40;
      const steps  = parseInt(paramInputs.steps.value) || 300;

      // ---- Build model ----
      log('info', '═══ STEP 2: BUILD MODEL ═══');
      log('learn', 'A neural network is layers of math. Data flows in, gets transformed, and a prediction comes out.');

      model = tf.sequential();
      model.add(tf.layers.embedding({ inputDim: vocabSize, outputDim: 32, inputLength: seqLen }));
      log('info', `  Layer 1 — Embedding(${vocabSize} → 32d)`);
      log('learn', '  Maps each character ID to a 32-number vector. The model learns WHERE to place each character in this space.');

      model.add(tf.layers.lstm({ units: hidden, returnSequences: true }));
      log('info', `  Layer 2 — LSTM(${hidden} units)`);
      log('learn', `  Reads the sequence step-by-step, keeping a ${hidden}-number "memory" that captures patterns like word boundaries and common sequences.`);

      model.add(tf.layers.dense({ units: vocabSize, activation: 'softmax' }));
      log('info', `  Layer 3 — Dense(${vocabSize}) + Softmax`);
      log('learn', '  Converts memory → probability for each character. Softmax ensures all probabilities sum to 1.');

      model.compile({ optimizer: tf.train.adam(lr), loss: 'categoricalCrossentropy' });

      const paramCount = model.countParams();
      log('info', `Total parameters: ${paramCount.toLocaleString()}`);
      log('learn', `These ${paramCount.toLocaleString()} numbers are what the model "learns". They all start random.`);
      log('info', `Optimizer: Adam (lr=${lr})`);
      log('learn', 'Adam adjusts each parameter\'s learning rate individually — faster for rarely-used params, slower for frequent ones.');

      const baseline = -Math.log(1 / vocabSize);
      const baselinePpl = vocabSize;
      log('info', `Random-guess baseline: loss=${baseline.toFixed(3)}, perplexity=${baselinePpl}`);
      log('learn', `Perplexity = e^loss. It means "the model is choosing between ~N equally likely options." Starting at ${baselinePpl} (total vocab). Goal: much lower.`);

      // ---- Training loop ----
      log('info', '═══ STEP 3: TRAINING ═══');
      log('learn', 'Each step: pick random text chunks → model predicts next char → measure error (loss) → nudge weights to reduce error.');
      log('info', '────────────────────────────────────────');

      const batchSize = 32;
      let prevLoss = baseline, bestLoss = baseline, stuckCount = 0;
      const milestones = { halfBaseline: false, ppl10: false, ppl5: false, wordsForming: false };

      for (let step = 1; step <= steps; step++) {
        if (stopped) { log('info', 'Stopped by user.'); break; }
        const t0 = performance.now();

        const xs = [], ys = [];
        for (let b = 0; b < batchSize; b++) {
          const i = Math.floor(Math.random() * (encoded.length - seqLen - 1));
          xs.push(encoded.slice(i, i + seqLen));
          ys.push(encoded.slice(i + 1, i + seqLen + 1));
        }
        const xTensor = tf.tensor2d(xs, [batchSize, seqLen], 'float32');
        const yTensor = tf.oneHot(tf.tensor2d(ys, [batchSize, seqLen], 'int32'), vocabSize);

        const loss = await model.trainOnBatch(xTensor, yTensor);
        const stepMs = (performance.now() - t0).toFixed(0);
        const ppl = Math.exp(loss);

        xTensor.dispose(); yTensor.dispose();

        log('train', `Step ${step}/${steps} | loss: ${loss.toFixed(4)} | perplexity: ${ppl.toFixed(1)} | ${stepMs}ms`);

        // ---- Educational milestones ----
        if (!milestones.halfBaseline && loss < baseline * 0.7) {
          milestones.halfBaseline = true;
          log('milestone', 'Loss dropped well below random! The model is learning real patterns in your text.');
        }
        if (!milestones.wordsForming && ppl < 15) {
          milestones.wordsForming = true;
          log('milestone', 'Perplexity < 15 — the model is narrowing its guesses. Recognizable words should start appearing in samples.');
        }
        if (!milestones.ppl10 && ppl < 10) {
          milestones.ppl10 = true;
          log('milestone', 'Perplexity < 10 — the model picks from ~10 likely chars per step. Samples should look like plausible text.');
        }
        if (!milestones.ppl5 && ppl < 5) {
          milestones.ppl5 = true;
          log('milestone', 'Perplexity < 5 — strong pattern capture. If your text is short, this may be overfitting (memorizing, not generalizing).');
        }

        // ---- Stuck / divergence detection ----
        if (loss > prevLoss * 1.5 && step > 10) {
          log('warn', `Loss jumped! (${prevLoss.toFixed(3)} → ${loss.toFixed(3)}). If this persists, try a lower learning rate.`);
        }
        if (loss < bestLoss) { bestLoss = loss; stuckCount = 0; }
        else { stuckCount++; }
        if (stuckCount === 40) {
          log('warn', 'Loss hasn\'t improved in 40 steps. The model may be stuck. Try: lower learning rate, more hidden units, or more training text.');
        }
        prevLoss = loss;

        // ---- Detailed inspection every 25 steps ----
        if (step % 25 === 0 || step === 1) {
          const weightLines = [];
          for (const w of model.weights) {
            const d = w.val.dataSync();
            let sum = 0, sq = 0;
            for (let k = 0; k < d.length; k++) { sum += d[k]; sq += d[k] * d[k]; }
            const mean = sum / d.length;
            const std = Math.sqrt(Math.max(0, sq / d.length - mean * mean));
            weightLines.push(`${w.name}: μ=${mean.toFixed(4)} σ=${std.toFixed(4)}`);
          }
          log('weights', weightLines.join(' | '));
          if (step === 1) {
            log('learn', 'μ (mean) ≈ 0 and σ (spread) ≈ 0.05–0.15 is typical at the start. Watch σ grow as layers specialize.');
          }

          const mem = tf.memory();
          log('memory', `${mem.numTensors} tensors | ${(mem.numBytes / 1e6).toFixed(1)} MB GPU memory`);

          const sampleText = generateText(tf, model, tokenizer, seqLen, 60, parseFloat(paramInputs.temp.value) || 0.8);
          log('sample', `"${sampleText}"`);
          if (step === 1) {
            log('learn', 'First sample is random gibberish — the model hasn\'t learned anything yet. Watch it improve!');
          }
        }

        if (step % 2 === 0) await tf.nextFrame();
      }

      // ---- Post-training summary ----
      log('info', '════════════════════════════════════════');
      log('info', `Final loss: ${prevLoss.toFixed(4)} | Perplexity: ${Math.exp(prevLoss).toFixed(1)} | Best loss: ${bestLoss.toFixed(4)}`);
      const pctImproved = ((1 - bestLoss / baseline) * 100).toFixed(0);
      log('info', `Improvement over random baseline: ${pctImproved}%`);

      log('info', '═══ WHAT TO TRY NEXT ═══');
      log('experiment', 'Change temperature (0.2 vs 1.5) and click Generate — see how randomness affects output.');
      log('experiment', 'Double the hidden units and retrain — does it learn faster or overfit?');
      log('experiment', 'Halve the learning rate — smoother training but slower. Is the final loss better?');
      log('experiment', 'Use very different training text (poetry vs code vs dialogue) — compare the samples.');
      if (text.length < 1000) {
        log('experiment', `Your text is only ${text.length} chars. Try 2000+ characters — more data almost always helps.`);
      }

      generateBtn.disabled = false;
    } catch (err) {
      log('error', err.message);
    } finally {
      trainBtn.disabled = false; stopBtn.disabled = true;
    }
  }

  // ===========================================================
  // TEXT GENERATION
  // ===========================================================
  function generateText(tf, mdl, tok, seqLen, length, temperature) {
    const seed = tok.idxToChar.slice(0, Math.min(seqLen, 5));
    let input = seed.map(c => tok.charToIdx[c]);
    let result = seed.join('');

    for (let i = 0; i < length; i++) {
      const seq = input.length >= seqLen ? input.slice(-seqLen) : input;
      const padded = seq.length < seqLen
        ? new Array(seqLen - seq.length).fill(0).concat(seq)
        : seq;
      const xs = tf.tensor2d([padded], [1, seqLen], 'int32');
      const preds = mdl.predict(xs);
      const lastProbs = preds.squeeze().slice([seqLen - 1], [1]).squeeze();
      const scaled = lastProbs.log().div(Math.max(temperature, 0.01)).softmax();
      const sampled = tf.multinomial(scaled, 1);
      const idx = sampled.dataSync()[0];

      result += tok.idxToChar[idx] || '?';
      input.push(idx);

      xs.dispose(); preds.dispose(); lastProbs.dispose(); scaled.dispose(); sampled.dispose();
    }
    return result;
  }

  async function runGenerate() {
    if (!model || !tokenizer) { log('error', 'Train a model first.'); return; }
    const tf = window.tf;
    if (!tf) return;
    const temp = parseFloat(paramInputs.temp.value) || 0.8;
    const seqLen = parseInt(paramInputs.seqLen.value) || 40;
    log('learn', `Generating with temperature=${temp}. Lower = predictable (picks top chars). Higher = creative (more random picks).`);
    const text = generateText(tf, model, tokenizer, seqLen, 120, temp);
    log('sample', `(temp=${temp}) "${text}"`);
  }
})();

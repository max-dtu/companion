(function () {
  'use strict';

  const headerRight = document.querySelector('.header-right');
  const tpl = document.getElementById('tpl-model-lab');
  if (!headerRight || !tpl) return;

  // Clone dialog from template and mount
  const dialog = tpl.content.querySelector('dialog').cloneNode(true);
  document.body.appendChild(dialog);

  // DOM refs
  const closeBtn   = dialog.querySelector('.lab-close');
  const tabs       = dialog.querySelectorAll('.lab-tab');
  const panes      = dialog.querySelectorAll('.lab-pane');
  const textarea   = dialog.querySelector('.lab-textarea');
  const logEl      = dialog.querySelector('[data-pane="train"] .lab-log');
  const chatLogEl  = dialog.querySelector('#lab-chat-log');
  const statLast   = dialog.querySelector('#lab-stat-last');
  const statSess   = dialog.querySelector('#lab-stat-session');
  const trainBtn   = dialog.querySelector('[data-action="train"]');
  const stopBtn    = dialog.querySelector('[data-action="stop"]');
  const genBtn     = dialog.querySelector('[data-action="generate"]');
  const params     = {};
  dialog.querySelectorAll('[data-param]').forEach(el => { params[el.dataset.param] = el; });

  // Open button in header
  const labBtn = document.createElement('button');
  labBtn.type = 'button';
  labBtn.className = 'icon-btn';
  labBtn.title = 'Model Lab';
  labBtn.setAttribute('aria-label', 'Open Model Lab');
  labBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>';
  headerRight.insertBefore(labBtn, headerRight.firstChild);

  // Open / close
  labBtn.addEventListener('click', () => dialog.showModal());
  closeBtn.addEventListener('click', () => dialog.close());

  // Tabs
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    dialog.querySelector('[data-pane="' + tab.dataset.tab + '"]').classList.add('active');
  }));

  // ── Log helper ───────────────────────────────────────────────
  function log(tag, msg, target) {
    const el = target || logEl;
    const span = document.createElement('span');
    span.className = 't-' + tag;
    span.textContent = '[' + tag + '] ' + msg + '\n';
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }

  // ── Chat Stats interceptor ───────────────────────────────────
  const sess = { n: 0, inTok: 0, outTok: 0, ms: 0 };
  const _fetch = window.fetch;
  window.fetch = function (url, opts) {
    if (typeof url !== 'string' || !url.endsWith('/api/chat'))
      return _fetch.apply(this, arguments);

    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}

    const t0 = performance.now();
    let outChars = 0, firstChunk = true, ttfb = 0;

    return _fetch.apply(this, arguments).then(function (res) {
      if (!res.ok || !res.body) return res;
      const dec = new TextDecoder();
      const ts = new TransformStream({
        transform(chunk, ctrl) {
          if (firstChunk) { ttfb = performance.now() - t0; firstChunk = false; }
          dec.decode(chunk, { stream: true }).split('\n').forEach(line => {
            if (!line.startsWith('data: ')) return;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.content) outChars += d.content.length;
              if (d.done) {
                const totalMs = performance.now() - t0;
                const inTok  = Math.ceil(JSON.stringify(body.messages || []).length / 4);
                const outTok = Math.ceil(outChars / 4);
                const tps    = totalMs > 0 ? (outTok / (totalMs / 1000)).toFixed(1) : '—';
                sess.n++; sess.inTok += inTok; sess.outTok += outTok; sess.ms += totalMs;
                if (statLast) statLast.innerHTML =
                  '<b>Model:</b> ' + (body.model || '?') +
                  ' &nbsp;|&nbsp; <b>Temp:</b> ' + (body.temperature ?? '—') + '<br>' +
                  '<b>Input:</b> ~' + inTok + ' tok' +
                  '&nbsp;&nbsp;<b>Output:</b> ~' + outTok + ' tok in ' + (totalMs/1000).toFixed(1) + 's<br>' +
                  '<b>Speed:</b> ' + tps + ' tok/s&nbsp;&nbsp;<b>TTFB:</b> ' + (ttfb/1000).toFixed(2) + 's';
                if (statSess) statSess.innerHTML =
                  '<b>Requests:</b> ' + sess.n + '<br>' +
                  '<b>Input:</b> ~' + sess.inTok.toLocaleString() + ' tok<br>' +
                  '<b>Output:</b> ~' + sess.outTok.toLocaleString() + ' tok<br>' +
                  '<b>Time:</b> ' + (sess.ms/1000).toFixed(1) + 's';
                log('chat',
                  (body.model || '?') + ' | in:~' + inTok + ' out:~' + outTok +
                  ' tok | ' + (totalMs/1000).toFixed(1) + 's (' + tps + ' tok/s)' +
                  ' | ttfb:' + (ttfb/1000).toFixed(2) + 's',
                  chatLogEl);
              }
            } catch (e) {}
          });
          ctrl.enqueue(chunk);
        }
      });
      res.body.pipeTo(ts.writable);
      return new Response(ts.readable, { status: res.status, statusText: res.statusText, headers: res.headers });
    });
  };

  // ── TF.js loader ─────────────────────────────────────────────
  function loadTf() {
    if (window.tf) return Promise.resolve(window.tf);
    return new Promise((resolve, reject) => {
      log('info', 'Downloading TensorFlow.js (~2 MB, first time only)…');
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
      s.onload = () => { log('info', 'TF.js ' + tf.version.tfjs + ' ready'); resolve(window.tf); };
      s.onerror = () => reject(new Error('Failed to load TensorFlow.js'));
      document.head.appendChild(s);
    });
  }

  // ── Training ─────────────────────────────────────────────────
  let model = null, tokenizer = null, stopped = false;

  trainBtn.addEventListener('click', train);
  stopBtn.addEventListener('click', () => { stopped = true; });
  genBtn.addEventListener('click', generate);

  async function train() {
    const text = textarea.value.trim();
    const seqLen = parseInt(params.seqLen.value) || 40;
    const minLen = Math.max(50, seqLen + 2);
    if (text.length < minLen) { log('error', 'Need at least ' + minLen + ' characters.'); return; }

    trainBtn.disabled = true; stopBtn.disabled = false; genBtn.disabled = true;
    stopped = false; logEl.innerHTML = '';

    try {
      const tf = await loadTf();
      if (model) { model.dispose(); model = null; }

      // Tokenizer
      const chars = [...new Set([...text])].sort();
      const c2i = Object.fromEntries(chars.map((c, i) => [c, i]));
      const vocabSize = chars.length;
      tokenizer = { chars, c2i, vocabSize };
      const encoded = [...text].map(c => c2i[c]);

      log('info', 'Vocab: ' + vocabSize + ' chars | Text: ' + text.length + ' tokens');

      // Model
      const hidden  = parseInt(params.hidden.value) || 128;
      const lr      = parseFloat(params.lr.value) || 0.003;
      const steps   = parseInt(params.steps.value) || 300;

      model = tf.sequential();
      model.add(tf.layers.embedding({ inputDim: vocabSize, outputDim: 32, inputLength: seqLen }));
      model.add(tf.layers.lstm({ units: hidden, returnSequences: true }));
      model.add(tf.layers.dense({ units: vocabSize, activation: 'softmax' }));
      model.compile({ optimizer: tf.train.adam(lr), loss: 'categoricalCrossentropy' });
      log('info', 'Model: ' + model.countParams().toLocaleString() + ' params | lr=' + lr);

      const baseline = -Math.log(1 / vocabSize);
      log('info', 'Baseline loss=' + baseline.toFixed(3) + ' (random). Goal: much lower.');
      log('info', '────────────────────────────────────────');

      const batchSize = 32;
      const milestones = { half: false, ppl15: false, ppl10: false, ppl5: false };

      for (let step = 1; step <= steps; step++) {
        if (stopped) { log('info', 'Stopped.'); break; }

        const xs = [], ys = [];
        for (let b = 0; b < batchSize; b++) {
          const i = Math.floor(Math.random() * (encoded.length - seqLen - 1));
          xs.push(encoded.slice(i, i + seqLen));
          ys.push(encoded.slice(i + 1, i + seqLen + 1));
        }
        const xT = tf.tensor2d(xs, [batchSize, seqLen], 'float32');
        const yT = tf.oneHot(tf.tensor2d(ys, [batchSize, seqLen], 'int32'), vocabSize);
        const t0 = performance.now();
        const loss = await model.trainOnBatch(xT, yT);
        const ms = (performance.now() - t0).toFixed(0);
        const ppl = Math.exp(loss);
        xT.dispose(); yT.dispose();

        log('train', 'step ' + step + '/' + steps + ' | loss ' + loss.toFixed(4) + ' | ppl ' + ppl.toFixed(1) + ' | ' + ms + 'ms');

        if (!milestones.half && loss < baseline * 0.7) { milestones.half = true; log('milestone', 'Learning real patterns!'); }
        if (!milestones.ppl15 && ppl < 15) { milestones.ppl15 = true; log('milestone', 'Perplexity < 15 — recognizable words emerging.'); }
        if (!milestones.ppl10 && ppl < 10) { milestones.ppl10 = true; log('milestone', 'Perplexity < 10 — plausible text.'); }
        if (!milestones.ppl5  && ppl < 5)  { milestones.ppl5  = true; log('milestone', 'Perplexity < 5 — strong fit (watch for overfitting).'); }

        if (step % 25 === 0 || step === 1) {
          const mem = tf.memory();
          log('memory', mem.numTensors + ' tensors | ' + (mem.numBytes / 1e6).toFixed(1) + ' MB');
          log('sample', '"' + sample(tf, seqLen, parseFloat(params.temp.value) || 0.8, 60) + '"');
          if (step === 1) log('learn', 'First sample is gibberish — the model hasn\'t learned yet.');
        }
        if (step % 2 === 0) await tf.nextFrame();
      }
      log('info', '═══ Done. Click Generate to produce new text. ═══');
      genBtn.disabled = false;
    } catch (err) {
      log('error', err.message);
    } finally {
      trainBtn.disabled = false; stopBtn.disabled = true;
    }
  }

  // ── Text generation ──────────────────────────────────────────
  function sample(tf, seqLen, temp, length) {
    const { chars, c2i, vocabSize } = tokenizer;
    const seed = chars.slice(0, Math.min(seqLen, 5));
    let input = seed.map(c => c2i[c]);
    let out = seed.join('');
    for (let i = 0; i < length; i++) {
      const seq = input.length >= seqLen ? input.slice(-seqLen) : input;
      const padded = seq.length < seqLen ? new Array(seqLen - seq.length).fill(0).concat(seq) : seq;
      const xs = tf.tensor2d([padded], [1, seqLen], 'int32');
      const preds = model.predict(xs);
      const lastProbs = preds.squeeze().slice([seqLen - 1], [1]).squeeze();
      const scaled = lastProbs.log().div(Math.max(temp, 0.01)).softmax();
      const idx = tf.multinomial(scaled, 1).dataSync()[0];
      out += chars[idx] || '?';
      input.push(idx);
      xs.dispose(); preds.dispose(); lastProbs.dispose(); scaled.dispose();
    }
    return out;
  }

  async function generate() {
    if (!model || !tokenizer) { log('error', 'Train a model first.'); return; }
    const tf = window.tf;
    const temp = parseFloat(params.temp.value) || 0.8;
    const seqLen = parseInt(params.seqLen.value) || 40;
    log('sample', '(temp=' + temp + ') "' + sample(tf, seqLen, temp, 120) + '"');
  }
})();

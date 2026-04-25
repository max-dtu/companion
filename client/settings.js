// Stamp dialog template into <body>
const _tpl = document.getElementById('tpl-model-selection');
if (_tpl) document.body.appendChild(_tpl.content.cloneNode(true));

const STORAGE_KEY = 'read.aiSettings';

const DEFAULT_MODEL = 'gpt-4o';

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Exposed globally so createChatThread.js, client.js, and onWordClick.js
// can read the current settings without importing this module.
window.getAISettings = function () {
  const s = loadSettings();
  return {
    model: s.model || DEFAULT_MODEL,
    baseURL: s.baseURL || '',
    apiKey: s.apiKey || '',
    temperature: typeof s.temperature === 'number' ? s.temperature : 1,
  };
};

// Returns headers to attach to every API request. The API key is sent as
// a Bearer token so it never appears in request bodies or server logs.
window.getAIHeaders = function () {
  const s = loadSettings();
  const headers = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers['Authorization'] = `Bearer ${s.apiKey}`;
  return headers;
};

(function initSettingsUI() {
  const btn = document.getElementById('settings-btn');
  const dialog = document.getElementById('settings-dialog');
  const form = document.getElementById('settings-form');
  const closeBtn = dialog.querySelector('.settings-close-btn');
  const remoteModelInput   = document.getElementById('remote-model');
  const ollamaModelInput   = document.getElementById('ollama-model');
  const ollamaBaseURLInput = document.getElementById('ollama-base-url');
  const webllmModelInput   = document.getElementById('webllm-model');
  const baseURLInput  = document.getElementById('settings-base-url');
  const apiKeyInput   = document.getElementById('settings-api-key');
  const revealBtn     = document.getElementById('settings-reveal-btn');
  const keyHint        = document.getElementById('settings-key-hint');
  const keyWarning     = document.getElementById('settings-key-warning');
  const keyWarningText = document.getElementById('settings-key-warning-text');
  let pendingSave = false;
  const tempInput  = document.getElementById('settings-temperature');
  const tempValue  = document.getElementById('settings-temperature-value');
  const testBtn    = document.getElementById('settings-test-btn');
  const testStatus = document.getElementById('settings-test-status');
  const ollamaTestBtn    = document.getElementById('ollama-test-btn');
  const ollamaTestStatus = document.getElementById('ollama-test-status');
  const modelIndicator = document.getElementById('active-model-indicator');
  const freeGroupsEl   = document.getElementById('free-model-groups');
  const remoteChipsEl  = document.getElementById('remote-chips');
  const ollamaChipsEl  = document.getElementById('ollama-chips');
  const webllmChipsEl  = document.getElementById('webllm-chips');

  const webllmStatus    = document.getElementById('webllm-status');
  const webllmStatusText = document.getElementById('webllm-status-text');
  const webllmDeleteBtn  = document.getElementById('webllm-delete-btn');

  let activeSection = 'remote';

  function setActiveSection(section) {
    activeSection = section;
    dialog.querySelectorAll('.model-section-group').forEach((g) => {
      g.classList.toggle('is-active', g.dataset.section === section);
    });
  }

  function getActiveSectionModelInput() {
    if (activeSection === 'ollama') return ollamaModelInput;
    if (activeSection === 'webllm') return webllmModelInput;
    return remoteModelInput;
  }

  const REMOTE_CHIPS = [
    { id: 'gpt-4o', meta: '~200B · flagship' },
    { id: 'gpt-4o-mini', meta: '~8B · budget' },
    { id: 'o1', meta: 'reasoning' },
    { id: 'o3-mini', meta: 'fast reasoning' },
    { id: 'deepseek-chat', meta: '671B MoE · DeepSeek V3', base: 'https://api.deepseek.com/v1' },
    { id: 'deepseek-reasoner', meta: '671B MoE · DeepSeek R1', base: 'https://api.deepseek.com/v1' },
  ];
  const OLLAMA_CHIPS = [
    { id: 'llama3.2:1b', meta: '1.3 GB · ultra-fast', base: 'http://localhost:11434/v1' },
    { id: 'llama3.2:3b', meta: '2.0 GB · balanced', base: 'http://localhost:11434/v1' },
    { id: 'qwen2.5:0.5b', meta: '394 MB · smallest', base: 'http://localhost:11434/v1' },
    { id: 'mistral', meta: '4.1 GB · all-rounder', base: 'http://localhost:11434/v1' },
    { id: 'phi4-mini', meta: '2.5 GB · STEM & code', base: 'http://localhost:11434/v1' },
    { id: 'deepseek-r1:1.5b', meta: '1.1 GB · reasoning', base: 'http://localhost:11434/v1' },
    { id: 'deepseek-r1:7b', meta: '4.7 GB · reasoning', base: 'http://localhost:11434/v1' },
    { id: 'aya-expanse:8b', meta: '4.9 GB · Arabic+23 langs', base: 'http://localhost:11434/v1' },
    { id: 'jwnder/jais-adaptive:7b', meta: '4.1 GB · Arabic-native', base: 'http://localhost:11434/v1' },
  ];
  const WEBLLM_CHIPS = [
    { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', size: '0.9 GB', meta: '~0.9 GB · tiny & fast' },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', size: '2.2 GB', meta: '~2.2 GB · STEM & code' },
    { id: 'gemma-2-2b-it-q4f16_1-MLC', size: '1.4 GB', meta: '~1.4 GB · balanced' },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', size: '1.0 GB', meta: '~1.0 GB · Arabic+29 langs' },
    { id: 'DeepSeek-R1-Distill-Qwen-1.5B-q4f16_1-MLC', size: '1.0 GB', meta: '~1.0 GB · reasoning' },
    { id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', size: '4.5 GB', meta: '~4.5 GB · reasoning' },
  ];
  const FREE_REMOTE_PRESETS = [
    { provider: 'Groq', baseURL: 'https://api.groq.com/openai/v1', note: 'Free tier · groq.com',
      models: [
        { id: 'llama-3.3-70b-versatile', meta: '70B · versatile' },
        { id: 'llama-3.1-8b-instant', meta: '8B · fast' },
        { id: 'gemma2-9b-it', meta: '9B · Google' },
        { id: 'mixtral-8x7b-32768', meta: '47B MoE · long ctx' },
      ] },
    { provider: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', note: 'Free models · openrouter.ai',
      models: [
        { id: 'meta-llama/llama-3.1-8b-instruct:free', meta: '8B · free' },
        { id: 'google/gemma-3-4b-it:free', meta: '4B · free' },
        { id: 'qwen/qwen3-8b:free', meta: '8B · free' },
        { id: 'deepseek/deepseek-r1:free', meta: '671B MoE · free' },
        { id: 'cohere/aya-expanse-32b:free', meta: '32B · Arabic+23 langs' },
      ] },
    { provider: 'GitHub Models', baseURL: 'https://models.inference.ai.azure.com', note: 'Free · GitHub token',
      models: [
        { id: 'gpt-4o-mini', meta: '~8B · budget' },
        { id: 'Phi-3.5-mini-instruct', meta: '~3.8B · STEM' },
        { id: 'mistral-small', meta: '24B · balanced' },
      ] },
  ];

  function renderChip(container, c, extra) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-chip' + (extra || '');
    btn.dataset.model = c.id;
    if (c.base) btn.dataset.base = c.base;
    const name = c.id.includes('/') ? c.id.split('/').pop().replace(/:.*$/, '') : c.id;
    btn.innerHTML = `<span class="chip-name">${name}</span><span class="chip-meta">${c.meta}</span>`;
    if (c.base) btn.title = `${c.id}\n${c.base}`;
    container.appendChild(btn);
  }

  if (remoteChipsEl) REMOTE_CHIPS.forEach(c => renderChip(remoteChipsEl, c));
  if (ollamaChipsEl) OLLAMA_CHIPS.forEach(c => renderChip(ollamaChipsEl, c));
  if (webllmChipsEl) WEBLLM_CHIPS.forEach(c => renderChip(webllmChipsEl, c));
  if (freeGroupsEl) {
    for (const g of FREE_REMOTE_PRESETS) {
      const el = document.createElement('div');
      el.className = 'free-model-group';
      el.innerHTML = `<div class="free-model-provider-row"><span class="free-model-provider">${g.provider}</span><span class="free-model-note">${g.note}</span></div>`;
      const row = document.createElement('div');
      row.className = 'free-model-chips';
      for (const m of g.models) renderChip(row, { ...m, base: g.baseURL }, ' free-model-chip');
      el.appendChild(row);
      freeGroupsEl.appendChild(el);
    }
  }

  const EYE_OPEN = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_CLOSED = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';

  function updateModelIndicator(loading = false) {
    if (!modelIndicator) return;
    const s = loadSettings();
    modelIndicator.textContent = s.model || DEFAULT_MODEL;
    modelIndicator.classList.toggle('is-loading', loading);
  }
  updateModelIndicator();

  function updateWebLLMStatus() {
    if (!webllmStatus) return;
    if (window.webllmModel) {
      const chip = WEBLLM_CHIPS.find(c => c.id === window.webllmModel);
      const size = chip ? ` (${chip.size})` : '';
      webllmStatusText.textContent = `✓ Loaded: ${window.webllmModel}${size}`;
      webllmStatus.hidden = false;
      webllmStatus.classList.remove('is-error');
      webllmDeleteBtn.hidden = false;
    } else {
      webllmStatus.hidden = true;
    }
  }

  webllmDeleteBtn?.addEventListener('click', async () => {
    webllmDeleteBtn.disabled = true;
    webllmStatusText.textContent = 'Deleting…';
    try {
      if (window.webllmEngine) {
        await window.webllmEngine.unload?.();
        window.webllmEngine = null;
      }
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (/webllm|mlc|wasm/i.test(name)) await caches.delete(name);
      }
      window.webllmModel = null;
      webllmModelInput.value = '';
      updateWebLLMStatus();
      updateModelIndicator();
    } catch (err) {
      webllmStatusText.textContent = `✗ ${err.message}`;
      webllmStatus.classList.add('is-error');
    } finally {
      webllmDeleteBtn.disabled = false;
    }
  });

  async function loadWebLLMModel(modelId) {
    const chip = WEBLLM_CHIPS.find(c => c.id === modelId);
    const sizeLabel = chip ? chip.size : '';
    try {
      if (!navigator.gpu) { updateModelIndicator(); return; }
      const webllm = await import('https://esm.run/@mlc-ai/web-llm');
      const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (r) => {
          if (modelIndicator) {
            const pct = Math.round((r.progress || 0) * 100);
            modelIndicator.textContent = sizeLabel ? `${sizeLabel} · ${pct}%` : `${pct}%`;
          }
        },
      });
      window.webllmEngine = engine;
      window.webllmModel  = modelId;
    } catch (err) {
      console.error('WebLLM load failed:', err);
    } finally {
      updateModelIndicator();
      updateWebLLMStatus();
    }
  }

  function updateChips(value) {
    dialog.querySelectorAll('.model-chip').forEach((chip) => {
      chip.classList.toggle('is-active', chip.dataset.model === value);
    });
  }

  [
    { input: remoteModelInput,  section: 'remote' },
    { input: ollamaModelInput,  section: 'ollama' },
    { input: webllmModelInput,  section: 'webllm' },
  ].forEach(({ input, section }) => {
    input?.addEventListener('input', () => { setActiveSection(section); updateChips(input.value.trim()); });
  });

  dialog.querySelectorAll('.model-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const section = chip.closest('[data-section]')?.dataset.section || 'remote';
      setActiveSection(section);
      const target = section === 'ollama' ? ollamaModelInput
                   : section === 'webllm' ? webllmModelInput : remoteModelInput;
      target.value = chip.dataset.model;
      if ('base' in chip.dataset) {
        if (section === 'ollama') ollamaBaseURLInput.value = chip.dataset.base;
        else baseURLInput.value = chip.dataset.base;
      }
      updateChips(chip.dataset.model);
    });
  });

  tempInput.addEventListener('input', () => {
    tempValue.textContent = parseFloat(tempInput.value).toFixed(1);
  });

  revealBtn.addEventListener('click', () => {
    const showing = apiKeyInput.type === 'text';
    apiKeyInput.type = showing ? 'password' : 'text';
    revealBtn.setAttribute('aria-label', showing ? 'Show API key' : 'Hide API key');
    revealBtn.querySelector('svg').innerHTML = showing ? EYE_OPEN : EYE_CLOSED;
  });

  ollamaTestBtn?.addEventListener('click', async () => {
    if (ollamaTestStatus) { ollamaTestStatus.textContent = 'Testing…'; ollamaTestStatus.className = 'settings-test-status'; }
    if (ollamaTestBtn) ollamaTestBtn.disabled = true;
    const model   = ollamaModelInput.value.trim() || 'llama3.2:1b';
    const baseURL = ollamaBaseURLInput.value.trim();
    try {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, baseURL }),
      });
      const data = await res.json();
      if (data.ok) {
        if (ollamaTestStatus) { ollamaTestStatus.textContent = `✓ Connected${data.model ? ` (${data.model})` : ''}`; ollamaTestStatus.className = 'settings-test-status is-ok'; }
      } else {
        if (ollamaTestStatus) { ollamaTestStatus.textContent = `✗ ${data.error || 'Failed'}`; ollamaTestStatus.className = 'settings-test-status is-error'; }
      }
    } catch (err) {
      if (ollamaTestStatus) { ollamaTestStatus.textContent = `✗ ${err.message}`; ollamaTestStatus.className = 'settings-test-status is-error'; }
    } finally {
      if (ollamaTestBtn) ollamaTestBtn.disabled = false;
    }
  });

  function clearTestStatus() {
    testStatus.textContent = '';
    testStatus.className = 'settings-test-status';
    if (ollamaTestStatus) { ollamaTestStatus.textContent = ''; ollamaTestStatus.className = 'settings-test-status'; }
  }

  function providerFromURL(baseURL) {
    if (!baseURL) return 'OpenAI';
    if (/groq\.com/i.test(baseURL))        return 'Groq';
    if (/openrouter\.ai/i.test(baseURL))   return 'OpenRouter';
    if (/inference\.ai/i.test(baseURL))    return 'GitHub Models';
    return null;
  }

  function clearKeyWarning() {
    if (keyWarning) keyWarning.hidden = true;
    pendingSave = false;
  }

  testBtn.addEventListener('click', async () => {
    clearTestStatus();
    testBtn.disabled = true;
    testStatus.textContent = 'Testing…';

    const model = remoteModelInput.value.trim() || DEFAULT_MODEL;
    const baseURL = baseURLInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const body = { model };
    if (baseURL) body.baseURL = baseURL;

    try {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        testStatus.textContent = `✓ Connected${data.model ? ` (${data.model})` : ''}`;
        testStatus.className = 'settings-test-status is-ok';
      } else {
        testStatus.textContent = `✗ ${data.error || 'Failed'}`;
        testStatus.className = 'settings-test-status is-error';
      }
    } catch (err) {
      testStatus.textContent = `✗ ${err.message}`;
      testStatus.className = 'settings-test-status is-error';
    } finally {
      testBtn.disabled = false;
    }
  });

  function openDialog() {
    const s = loadSettings();
    const isWebLLM = !!(window.webllmModel && s.model === window.webllmModel);
    const isOllama = !isWebLLM && /localhost|127\.0\.0\.1/i.test(s.baseURL || '');
    remoteModelInput.value = '';
    ollamaModelInput.value = '';
    webllmModelInput.value = '';
    if (isWebLLM) {
      setActiveSection('webllm');
      webllmModelInput.value = s.model || '';
    } else if (isOllama) {
      setActiveSection('ollama');
      ollamaModelInput.value   = s.model || '';
      ollamaBaseURLInput.value = s.baseURL || 'http://localhost:11434/v1';
    } else {
      setActiveSection('remote');
      remoteModelInput.value = s.model || '';
    }
    baseURLInput.value = s.baseURL || '';
    apiKeyInput.value  = s.apiKey || '';
    apiKeyInput.type   = 'password';
    revealBtn.querySelector('svg').innerHTML = EYE_OPEN;
    revealBtn.setAttribute('aria-label', 'Show API key');
    keyHint.textContent = s.apiKey ? `Saved: …${s.apiKey.slice(-4) || '(set)'}` : '';
    const temp = typeof s.temperature === 'number' ? s.temperature : 1;
    tempInput.value = temp;
    tempValue.textContent = temp.toFixed(1);
    updateChips(s.model || '');
    clearKeyWarning();
    clearTestStatus();
    updateWebLLMStatus();
    dialog.showModal();
    getActiveSectionModelInput().focus();
  }

  function closeDialog() {
    dialog.close();
  }

  btn.addEventListener('click', openDialog);
  closeBtn.addEventListener('click', closeDialog);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const model   = getActiveSectionModelInput().value.trim();
    const baseURL = activeSection === 'ollama' ? ollamaBaseURLInput.value.trim()
                  : activeSection === 'webllm'  ? ''
                  : baseURLInput.value.trim();
    const apiKey  = activeSection === 'webllm' ? '' : apiKeyInput.value.trim();
    const provider = activeSection !== 'remote' ? null : providerFromURL(baseURL);

    if (provider !== null && !apiKey && !pendingSave) {
      pendingSave = true;
      keyWarningText.textContent =
        `${provider} requires an API key. Add one in the field below, or click Save again to proceed anyway (if the server is already configured with a key).`;
      keyWarning.hidden = false;
      keyWarning.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    clearKeyWarning();
    saveSettings({ model, baseURL, apiKey, temperature: parseFloat(tempInput.value) });
    closeDialog();

    if (activeSection === 'webllm' && model && window.webllmModel !== model) {
      updateModelIndicator(true);
      loadWebLLMModel(model);
    } else {
      updateModelIndicator();
    }
  });
})();


// ============================================================
// PDF Viewer — fully self-contained.
// To remove this feature: delete this file and its <script> tag.
// ============================================================
(function initPdfViewer() {
  if (typeof pdfjsLib === 'undefined') return;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // ---- Inject CSS ----
  const style = document.createElement('style');
  style.textContent = `
    .pdf-wrap{flex:1;display:flex;min-height:0}
    .pdf-reader{width:55%;max-width:820px;min-width:320px;display:flex;flex-direction:column;border-right:1px solid #e5e5e5;background:#f7f7f8;height:100%}
    .pdf-reader[hidden]{display:none}
    .pdf-reader-header{display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-bottom:1px solid #e5e5e5;background:#fff;flex-shrink:0}
    .pdf-reader-filename{flex:1;min-width:0;font-size:.85rem;font-weight:600;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pdf-reader-page-info{font-size:.75rem;color:#888;white-space:nowrap}
    .pdf-reader-pages{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;align-items:center;gap:.75rem}
    .pdf-page{position:relative;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12);border-radius:2px;flex-shrink:0}
    .pdf-page canvas{display:block;width:100%;height:auto}
    .pdf-text-layer{position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;line-height:1;opacity:.3}
    .pdf-text-layer span{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}
    .pdf-text-layer ::selection{background:rgba(0,100,255,.35)}
    .pdf-text-layer span::selection{background:rgba(0,100,255,.35)}
    .pdf-page-number{position:absolute;bottom:6px;right:8px;font-size:.65rem;color:#aaa;pointer-events:none}
    @media(max-width:900px){
      .pdf-wrap{flex-direction:column}
      .pdf-reader{width:100%;max-width:none;min-width:0;border-right:none;border-bottom:1px solid #e5e5e5;max-height:50vh}
    }
  `;
  document.head.appendChild(style);

  // ---- Inject HTML: open button in header ----
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return;

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'icon-btn';
  openBtn.title = 'Open PDF';
  openBtn.setAttribute('aria-label', 'Open a PDF file');
  openBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
  headerRight.insertBefore(openBtn, headerRight.firstChild);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,application/pdf';
  fileInput.hidden = true;
  headerRight.appendChild(fileInput);

  // ---- Inject HTML: wrap threads-container + add reader panel ----
  const workspace = document.querySelector('.workspace');
  const threads   = document.querySelector('.threads-container');
  if (!workspace || !threads) return;

  const wrap = document.createElement('div');
  wrap.className = 'pdf-wrap';
  workspace.insertBefore(wrap, threads);
  wrap.appendChild(threads);

  const reader = document.createElement('div');
  reader.className = 'pdf-reader';
  reader.hidden = true;
  reader.innerHTML =
    '<div class="pdf-reader-header">' +
      '<span class="pdf-reader-filename"></span>' +
      '<span class="pdf-reader-page-info"></span>' +
      '<button type="button" class="pdf-reader-close icon-btn" title="Close PDF" aria-label="Close PDF">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="pdf-reader-pages"></div>';
  wrap.insertBefore(reader, threads);

  const pagesEl  = reader.querySelector('.pdf-reader-pages');
  const nameEl   = reader.querySelector('.pdf-reader-filename');
  const pageInfo = reader.querySelector('.pdf-reader-page-info');
  const closeBtn = reader.querySelector('.pdf-reader-close');

  // ---- State ----
  let currentPdf = null;
  let renderedPages = new Set();
  let pageObserver = null;
  const SCALE = 1.5;
  const BUFFER = 600;

  // ---- Events ----
  openBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    fileInput.value = '';
    if (file) loadFile(file);
  });
  closeBtn.addEventListener('click', closePdf);

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files || [])].find(
      (f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'),
    );
    if (file) { e.preventDefault(); loadFile(file); }
  });

  // ---- Core ----
  async function loadFile(file) {
    closePdf();
    nameEl.textContent = file.name;
    reader.hidden = false;

    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    currentPdf = pdf;
    pageInfo.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;

    for (let i = 1; i <= pdf.numPages; i++) {
      const holder = document.createElement('div');
      holder.className = 'pdf-page';
      holder.dataset.page = i;
      holder.style.minHeight = '400px';
      pagesEl.appendChild(holder);
    }
    observePages();
  }

  function closePdf() {
    reader.hidden = true;
    pagesEl.innerHTML = '';
    renderedPages = new Set();
    currentPdf = null;
    if (pageObserver) pageObserver.disconnect();
  }

  // ---- Lazy page rendering ----
  function observePages() {
    if (pageObserver) pageObserver.disconnect();
    pageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const num = parseInt(entry.target.dataset.page, 10);
          if (!renderedPages.has(num)) renderPage(num, entry.target);
        }
      },
      { root: pagesEl, rootMargin: `${BUFFER}px 0px ${BUFFER}px 0px`, threshold: 0 },
    );
    for (const el of pagesEl.children) pageObserver.observe(el);
  }

  async function renderPage(pageNum, holder) {
    if (!currentPdf || renderedPages.has(pageNum)) return;
    renderedPages.add(pageNum);

    const page = await currentPdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });
    holder.style.width = `${viewport.width}px`;
    holder.style.minHeight = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    holder.appendChild(canvas);

    const textContent = await page.getTextContent();
    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    try {
      if (typeof pdfjsLib.renderTextLayer === 'function') {
        pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport });
      }
    } catch {
      try { pdfjsLib.renderTextLayer({ textContent, container: textLayer, viewport, textDivs: [] }); } catch {}
    }
    holder.appendChild(textLayer);

    const label = document.createElement('div');
    label.className = 'pdf-page-number';
    label.textContent = pageNum;
    holder.appendChild(label);
  }
})();

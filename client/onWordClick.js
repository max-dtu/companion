function getContext(span, charsAround = 300) {
  let before = '';
  for (let n = span.previousSibling; n && before.length < charsAround; n = n.previousSibling) {
    before = (n.textContent || '') + before;
  }

  let after = '';
  for (let n = span.nextSibling; n && after.length < charsAround; n = n.nextSibling) {
    after += n.textContent || '';
  }

  return before.slice(-charsAround) + span.textContent + after.slice(0, charsAround);
}

function onWordClick(span, segment) {
  const existing = document.querySelector('.lookup-popup');
  if (existing) existing.remove();

  const template = document.getElementById('lookup-popup-template');
  const popup = document.createElement('div');
  popup.className = 'lookup-popup';
  popup.appendChild(template.content.cloneNode(true));
  popup.querySelector('.lookup-word').textContent = segment;

  document.body.appendChild(popup);

  const context = getContext(span);

  const settings = window.getAISettings?.() || {};
  const lookupBody = { word: segment, sentence: context };
  if (settings.baseURL) lookupBody.baseURL = settings.baseURL;
  fetch('/api/lookup', {
    method: 'POST',
    headers: window.getAIHeaders?.() || { 'Content-Type': 'application/json' },
    body: JSON.stringify(lookupBody),
  })
    .then(r => r.json())
    .then(data => {
      const meaningEl = popup.querySelector('.lookup-body');
      if (meaningEl) {
        meaningEl.classList.add('loaded');
        meaningEl.textContent = data.meaning || data.error || 'No definition found.';
      }

      const lang = data.lang || detectLangChars(segment);
      speakWord(segment, lang);
    })
    .catch(() => {
      const meaningEl = popup.querySelector('.lookup-body');
      if (meaningEl) meaningEl.textContent = 'Failed to load definition.';
    });

  const rect = span.getBoundingClientRect();

  requestAnimationFrame(() => {
    const popupWidth = popup.offsetWidth;
    const popupHeight = popup.offsetHeight;

    let top = rect.bottom + 10;
    let left = rect.left + rect.width / 2 - popupWidth / 2;

    if (top + popupHeight > window.innerHeight - 10) {
      top = Math.max(10, rect.top - popupHeight - 10);
      popup.style.transformOrigin = 'bottom center';
    } else {
      popup.style.transformOrigin = 'top center';
    }

    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) {
      left = 10;
    }

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.classList.add('visible');
  });

  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!popup.contains(ev.target)) {
        popup.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

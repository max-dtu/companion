const ttsBtn = document.createElement('button');
ttsBtn.type = 'button';
ttsBtn.className = 'tts-floating-btn';
ttsBtn.textContent = '🔊';
ttsBtn.setAttribute('aria-label', 'Speak selection');
ttsBtn.hidden = true;
document.body.appendChild(ttsBtn);

function hideTtsBtn() {
  ttsBtn.hidden = true;
}

ttsBtn.addEventListener('click', () => {
  const { text, lang } = ttsBtn.dataset;
  if (text) speakWord(text, lang);
  hideTtsBtn();
});

document.addEventListener('mousedown', (e) => {
  if (!ttsBtn.contains(e.target)) hideTtsBtn();
});

document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!text) {
    hideTtsBtn();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  ttsBtn.dataset.text = text;
  ttsBtn.dataset.lang = detectLangChars(text);
  ttsBtn.hidden = false;
  ttsBtn.style.top = `${rect.top + window.scrollY - 36}px`;
  ttsBtn.style.left = `${rect.left + window.scrollX + rect.width / 2 - ttsBtn.offsetWidth / 2}px`;
});

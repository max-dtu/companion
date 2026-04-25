// Voice lookup is cached per BCP-47 lang tag. Voices change very rarely
// (only when the OS installs/removes them), so we just clear the cache
// when `voiceschanged` fires and recompute on demand.
const voiceCache = new Map();

function getBestVoice(lang) {
  if (voiceCache.has(lang)) return voiceCache.get(lang);

  const matches = speechSynthesis.getVoices().filter(v => v.lang.startsWith(lang));
  // Prefer a high-quality engine voice; fall back to any locale match.
  // null means "let the browser pick its default for utterance.lang".
  const voice =
    matches.find(v => /Google|Microsoft|Apple/.test(v.name)) ||
    matches[0] ||
    null;

  voiceCache.set(lang, voice);
  return voice;
}

if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', () => voiceCache.clear());
}

function speakWord(word, lang = 'en-US') {
  if (!word || !('speechSynthesis' in window)) return;

  // cancel() is safe to call when idle and also clears any queued utterances.
  speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang;
  const voice = getBestVoice(lang);
  if (voice) u.voice = voice;
  u.rate = 0.95;

  // Chromium can drop an utterance if speak() runs in the same task as
  // cancel(); deferring to the next task avoids the lost-audio race.
  setTimeout(() => speechSynthesis.speak(u), 0);
}

// Script-range → BCP-47 tag. Order matters for ambiguous scripts:
// Japanese kana must be checked before Han so that words mixing kanji
// and kana (e.g. 食べる) aren't mis-classified as Chinese.
const SCRIPT_RULES = [
  [/[\u0600-\u06FF]/, 'ar-SA'], // Arabic
  [/[\u0590-\u05FF]/, 'he-IL'], // Hebrew
  [/[\u0400-\u04FF]/, 'ru-RU'], // Cyrillic
  [/[\u0370-\u03FF]/, 'el-GR'], // Greek
  [/[\u0900-\u097F]/, 'hi-IN'], // Devanagari
  [/[\u3040-\u30FF]/, 'ja-JP'], // Hiragana / Katakana
  [/[\u4E00-\u9FFF]/, 'zh-CN'], // Han (after kana check)
  [/[\uAC00-\uD7AF]/, 'ko-KR'], // Hangul
  [/[\u0E00-\u0E7F]/, 'th-TH'], // Thai
  [/[\u0980-\u09FF]/, 'bn-BD'], // Bengali
  [/[\u0B80-\u0BFF]/, 'ta-IN'], // Tamil
  [/[\u10A0-\u10FF]/, 'ka-GE'], // Georgian
  [/[\u1200-\u137F]/, 'am-ET'], // Ethiopic
  // Latin-script heuristics — quick wins from distinctive diacritics.
  [/[æøåÆØÅ]/, 'da-DK'],
  [/[äöüßÄÖÜ]/, 'de-DE'],
  [/[ăâđêôơưĂÂĐÊÔƠƯ]/, 'vi-VN'],
  [/[çğıöşüÇĞİÖŞÜ]/, 'tr-TR'],
  [/[éèêëàâîïôûùç]/i, 'fr-FR'],
  [/[ñáéíóúü¿¡]/i, 'es-ES'],
];

function detectLangChars(word) {
  for (const [re, tag] of SCRIPT_RULES) {
    if (re.test(word)) return tag;
  }
  return 'en-US';
}

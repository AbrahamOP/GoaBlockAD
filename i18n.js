// GoaBlockAD - Translations
// Fills the page from _locales/<lang>/messages.json; chrome.i18n follows the
// browser language and falls back to English (default_locale).
//   data-i18n="<key>"           → textContent
//   data-i18n-title="<key>"     → title (same for placeholder, aria-label)

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
// Read from the messages themselves, so <html lang> and number formats always
// match the language actually displayed.
const uiLang = t('langCode');

document.documentElement.lang = uiLang;
document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
});
for (const attr of ['title', 'placeholder', 'aria-label']) {
    document.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => {
        el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    });
}

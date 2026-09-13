// Translations check: every locale has exactly the keys of en, every key used
// by the extension exists, and no key is left unused.
const fs = require('fs');

const dir = '_locales';
const read = (f) => fs.readFileSync(f, 'utf8');
const keysOf = (lang) => Object.keys(JSON.parse(read(`${dir}/${lang}/messages.json`)));
const en = keysOf('en');
const errors = [];

for (const lang of fs.readdirSync(dir)) {
    const keys = keysOf(lang);
    const missing = en.filter(k => !keys.includes(k));
    const unknown = keys.filter(k => !en.includes(k));
    if (missing.length) errors.push(`${lang}: missing ${missing.join(', ')}`);
    if (unknown.length) errors.push(`${lang}: not in en ${unknown.join(', ')}`);
}

const src = ['manifest.json', 'popup.html', 'dashboard.html', 'i18n.js', 'popup.js', 'dashboard.js'].map(read).join('\n');
const used = new Set([...src.matchAll(/data-i18n(?:-[a-z-]+)?="(\w+)"|\bt\('(\w+)'|__MSG_(\w+)__/g)]
    .map(m => m[1] || m[2] || m[3]));
const undefinedKeys = [...used].filter(k => !en.includes(k));
const unused = en.filter(k => !used.has(k));
if (undefinedKeys.length) errors.push(`used but not in en: ${undefinedKeys.join(', ')}`);
if (unused.length) errors.push(`unused keys: ${unused.join(', ')}`);

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`Translations OK: ${fs.readdirSync(dir).length} locales, ${en.length} keys.`);

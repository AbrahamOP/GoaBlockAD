const fs = require('node:fs');
const assert = require('node:assert/strict');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert(/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(manifest.version), 'Invalid Chrome version');
assert(manifest.version.split('.').every(n => Number(n) <= 65535) && /[1-9]/.test(manifest.version));
const refs = [manifest.background.service_worker, manifest.options_page, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(s => [...s.js || [], ...s.css || []]),
    `_locales/${manifest.default_locale}/messages.json`, 'youtube-inject.js'];
for (const resource of manifest.declarative_net_request.rule_resources) {
    refs.push(resource.path);
    const rules = JSON.parse(fs.readFileSync(resource.path, 'utf8'));
    assert.equal(new Set(rules.map(r => r.id)).size, rules.length, 'Duplicate rule IDs');
    for (const rule of rules) {
        assert(Number.isInteger(rule.id) && rule.id > 0);
        assert.equal(rule.action.type, 'block');
        assert(rule.condition.urlFilter && rule.condition.resourceTypes.length);
    }
}
for (const path of refs) assert(fs.existsSync(path), `Missing manifest reference: ${path}`);
console.log('Manifest, version and bundled rules OK.');

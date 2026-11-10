const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function background(initial = {}) {
    const state = { enabled: true, pausedUntil: 0, whitelist: [], customFilters: '', filterStates: {}, ...initial };
    const handlers = {};
    let alarm, registered = [], dynamic = [], enabled = true, failNext = false;
    const event = key => ({ addListener(fn) { handlers[key] = fn; } });
    const chrome = {
        storage: { local: {
            get: async () => ({ ...state }),
            set: async values => Object.assign(state, values),
            remove: async () => {}
        }, onChanged: event('changed') },
        runtime: { onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
        alarms: { onAlarm: event('alarm'), get: async () => alarm,
            clear: async () => { alarm = undefined; },
            create: async (name, options) => { alarm = { name, scheduledTime: options.when }; } },
        action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
        declarativeNetRequest: {
            getDynamicRules: async () => dynamic,
            updateDynamicRules: async ({ removeRuleIds, addRules }) => {
                dynamic = dynamic.filter(r => !removeRuleIds.includes(r.id)).concat(addRules);
            },
            updateEnabledRulesets: async options => {
                if (failNext) { failNext = false; throw new Error('simulated API failure'); }
                enabled = !!options.enableRulesetIds;
            },
            setExtensionActionOptions: async () => {}
        },
        scripting: {
            getRegisteredContentScripts: async () => registered,
            unregisterContentScripts: async () => { registered = []; },
            registerContentScripts: async scripts => { registered = scripts; },
            updateContentScripts: async scripts => { registered = scripts; },
            executeScript: async () => []
        }
    };
    const context = vm.createContext({ chrome, URL, console: { error() {} } });
    vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
    await vm.runInContext('stateQueue', context);
    return { state, handlers, chrome,
        get alarm() { return alarm; }, get enabled() { return enabled; }, get dynamic() { return dynamic; },
        get registered() { return registered; }, fail() { failNext = true; },
        message: (msg, sender = {}) => new Promise(resolve => handlers.message(msg, sender, resolve))
    };
}

test('a worker wake recreates a missing pause alarm; expiry resumes protection', async () => {
    const until = Date.now() + 60000;
    const b = await background({ pausedUntil: until, customFilters: 'ads.example' });
    assert.equal(b.alarm.scheduledTime, until);
    assert.equal(b.enabled, false);
    assert.equal(b.dynamic.length, 0);
    b.state.pausedUntil = Date.now() - 1;
    await b.handlers.alarm({ name: 'goablockad-pause-resume' });
    assert.equal(b.state.pausedUntil, 0);
    assert.equal(b.enabled, true);
    assert.equal(b.dynamic.length, 1);
});

test('an old alarm cannot end a new pause early', async () => {
    const b = await background({ pausedUntil: Date.now() + 60000 });
    await b.handlers.alarm({ name: 'goablockad-pause-resume' });
    assert.equal(b.enabled, false);
    assert(b.alarm.scheduledTime > Date.now());
});

test('the real bundled-list switch controls DNR independently of custom filters', async () => {
    const b = await background({ customFilters: 'ads.example' });
    assert.equal((await b.message({ type: 'saveFilterStates', states: { 'builtin-network': false } })).ok, true);
    assert.equal(b.enabled, false);
    assert.equal(b.dynamic.length, 1);
    await b.message({ type: 'saveFilterStates', states: { 'builtin-network': true } });
    assert.equal(b.enabled, true);
});

test('rapid pause/resume commands finish with consistent rules and alarm', async () => {
    const b = await background({ customFilters: 'ads.example' });
    const responses = await Promise.all([
        b.message({ type: 'pauseProtection', minutes: 15 }), b.message({ type: 'resumeProtection' })
    ]);
    assert(responses.every(r => r.ok));
    assert.equal(b.enabled, true);
    assert.equal(b.alarm, undefined);
    assert.equal(b.dynamic.length, 1);
});

test('failed state updates respond with an error and do not poison the queue', async () => {
    const b = await background();
    b.fail();
    assert.equal((await b.message({ type: 'pauseProtection' })).ok, false);
    assert.equal((await b.message({ type: 'resumeProtection' })).ok, true);
    assert.equal(b.enabled, true);
});

test('allow-list response waits for rules and removes inherited subdomain exceptions', async () => {
    const b = await background({ whitelist: ['example.com'] });
    await b.message({ type: 'toggleWhitelist', domain: 'news.example.com' });
    assert.equal(b.state.whitelist.length, 0);
    assert.equal(b.dynamic.length, 0);
    await b.message({ type: 'toggleWhitelist', domain: 'example.com' });
    assert.equal(b.dynamic[0].action.type, 'allowAllRequests');
});

test('YouTube document requests respect parent-site exceptions and validate the sender', async () => {
    const b = await background({ whitelist: ['example.com'] });
    const sender = { url: 'https://www.youtube.com/embed/test', documentId: 'doc', tab: { id: 1, url: 'https://example.com/' } };
    assert.equal((await b.message({ type: 'youtubeState' }, sender)).active, false);
    assert.equal((await b.message({ type: 'youtubeState' }, { ...sender, url: 'https://evil.example/' })).ok, false);
});

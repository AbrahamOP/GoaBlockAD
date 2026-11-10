// GoaBlockAD - Background Service Worker

const DYNAMIC_CUSTOM_START = 10000;
const DYNAMIC_ALLOW_START = 20000;
const PAUSE_ALARM = 'goablockad-pause-resume';
const BADGE_COLOR = '#00bcd4';
// Product limit, kept below Chrome’s dynamic rule quota.
const MAX_CUSTOM_RULES = 5000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function parseCustomFilters(raw) {
    return (raw || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('!'));
}

// A bare domain or a URL becomes "||host^" (the domain and its subdomains);
// anything already using DNR syntax (|, ^, *, /) is kept as-is.
// Returns null for a line that can't be a valid filter.
function toUrlFilter(line) {
    const isUrl = /^[a-z]+:\/\//i.test(line);
    if (!isUrl && /[|^*\/]/.test(line)) return /^[\x21-\x7e]+$/.test(line) ? line : null;
    try {
        // URL() lowercases and punycodes the host, but percent-escapes spaces instead of failing.
        const host = new URL(isUrl ? line : 'http://' + line).hostname;
        return /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(host) ? '||' + host + '^' : null;
    } catch (_) {
        return null;
    }
}

function buildCustomBlockRules(lines) {
    const rules = [];
    const rejected = [];
    for (const line of lines.slice(0, MAX_CUSTOM_RULES)) {
        const urlFilter = toUrlFilter(line);
        if (!urlFilter) { rejected.push(line); continue; }
        rules.push({
            id: DYNAMIC_CUSTOM_START + rules.length,
            priority: 1,
            action: { type: 'block' },
            condition: {
                urlFilter,
                resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'stylesheet', 'font', 'media', 'other']
            }
        });
    }
    return { rules, rejected };
}

function buildAllowRules(domains) {
    return domains.map((domain, i) => ({
        id: DYNAMIC_ALLOW_START + i,
        priority: 100,
        action: { type: 'allowAllRequests' },
        // Matching the top-level navigation to the domain allows every request
        // of the page, sub-frames included.
        condition: {
            requestDomains: [domain],
            resourceTypes: ['main_frame']
        }
    }));
}

// updateDynamicRules is all-or-nothing: one invalid rule would drop the whole
// batch. Chrome names the faulty rule id, so drop it and retry.
async function replaceDynamicRulesInRange(newRules, idStart, idEnd) {
    let rules = newRules;
    const rejected = [];
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
        .filter(r => r.id >= idStart && r.id <= idEnd)
        .map(r => r.id);
    for (;;) {
        try {
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
            return { ok: true, count: rules.length, rejected };
        } catch (err) {
            const badId = Number(/\bid (\d+)/.exec(err.message)?.[1]);
            const bad = rules.find(r => r.id === badId);
            if (!bad) {
                console.error('GoaBlockAD: updateDynamicRules failed', err);
                return { ok: false, error: err.message, rejected };
            }
            rejected.push(bad.condition.urlFilter);
            rules = rules.filter(r => r !== bad);
        }
    }
}

// ─────────────────────────────────────────────
// Custom filters (user-provided domains)
// ─────────────────────────────────────────────
async function rebuildCustomRules() {
    const { customFilters = '' } = await chrome.storage.local.get('customFilters');
    const lines = parseCustomFilters(customFilters);
    const { rules, rejected } = buildCustomBlockRules(lines);
    const active = await isProtectionActive();
    const res = await replaceDynamicRulesInRange(active ? rules : [], DYNAMIC_CUSTOM_START, DYNAMIC_CUSTOM_START + 9999);
    res.rejected.unshift(...rejected);
    res.truncated = Math.max(0, lines.length - MAX_CUSTOM_RULES);
    return res;
}

// ─────────────────────────────────────────────
// Whitelist (domains where blocking is disabled)
// ─────────────────────────────────────────────
async function rebuildAllowRules(whitelist) {
    const rules = buildAllowRules(whitelist || []);
    return replaceDynamicRulesInRange(rules, DYNAMIC_ALLOW_START, DYNAMIC_ALLOW_START + 9999);
}

// ─────────────────────────────────────────────
// YouTube player data pruning (youtube-inject.js)
// Runs in the page's world, where it can't read storage: register it only while
// protection is active, excluding allow-listed domains, so pause/off/allow list
// apply from the very first script of the page.
// ─────────────────────────────────────────────
const YT_INJECT_ID = 'goablockad-youtube-inject';
let ytSyncQueue = Promise.resolve();

// Serialized: concurrent unregister/register pairs would collide on the script id.
function syncYouTubeInjection() {
    ytSyncQueue = ytSyncQueue.catch(() => {}).then(doSyncYouTubeInjection);
    return ytSyncQueue;
}

async function doSyncYouTubeInjection() {
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    const active = await isProtectionActive();
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [YT_INJECT_ID] });
    if (!active) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [YT_INJECT_ID] });
        return;
    }
    const script = {
        id: YT_INJECT_ID,
        js: ['youtube-inject.js'],
        matches: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'],
        excludeMatches: whitelist.flatMap(d => [`*://${d}/*`, `*://*.${d}/*`]),
        runAt: 'document_start', world: 'MAIN', allFrames: true
    };
    if (registered.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
}

// ─────────────────────────────────────────────
// Pause mode
// ─────────────────────────────────────────────
async function isProtectionActive() {
    const { enabled = true, pausedUntil = 0 } = await chrome.storage.local.get(['enabled', 'pausedUntil']);
    return enabled && !(pausedUntil && Date.now() < pausedUntil);
}

async function applyProtectionState() {
    const shouldEnable = await isProtectionActive();
    const { filterStates = {} } = await chrome.storage.local.get('filterStates');

    if (shouldEnable && filterStates['builtin-network'] !== false) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['ruleset_1'] });
    } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['ruleset_1'] });
    }
    // Custom rules are dynamic and ignore the ruleset toggle: add/remove them too.
    const custom = await rebuildCustomRules();
    if (!custom.ok) throw new Error(custom.error);
    await syncYouTubeInjection();
    updateBadgeStyle(shouldEnable);
}

function updateBadgeStyle(active) {
    if (active) {
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    } else {
        chrome.action.setBadgeBackgroundColor({ color: '#616161' });
    }
}

// While active, the badge shows Chrome's own per-tab count of blocked requests
// (displayActionCountAsBadgeText); the global text only signals OFF / pause.
async function refreshBadgeText() {
    const { enabled = true, pausedUntil = 0 } = await chrome.storage.local.get(['enabled', 'pausedUntil']);
    const isPaused = pausedUntil && Date.now() < pausedUntil;
    chrome.action.setBadgeText({ text: !enabled ? 'OFF' : isPaused ? '⏸' : '' });
}

// Serialize state changes so rapid toggles cannot leave stale rules installed.
let stateQueue = Promise.resolve();
function enqueue(task) {
    const result = stateQueue.then(task);
    stateQueue = result.catch(err => console.error('GoaBlockAD:', err));
    return result;
}

async function reconcilePause() {
    const { pausedUntil = 0 } = await chrome.storage.local.get('pausedUntil');
    if (pausedUntil > Date.now()) {
        const alarm = await chrome.alarms.get(PAUSE_ALARM);
        if (!alarm || alarm.scheduledTime !== pausedUntil) {
            await chrome.alarms.create(PAUSE_ALARM, { when: pausedUntil });
        }
    } else {
        await chrome.alarms.clear(PAUSE_ALARM);
        if (pausedUntil) await chrome.storage.local.set({ pausedUntil: 0 });
    }
}

async function synchronize() {
    await reconcilePause();
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    const allowed = await rebuildAllowRules(whitelist);
    if (!allowed.ok) throw new Error(allowed.error);
    await applyProtectionState();
    await refreshBadgeText();
}

function allowedHost(host, whitelist) {
    return whitelist.some(d => host === d || host.endsWith('.' + d));
}

// The isolated YouTube script requests this on load and on setting changes.
// Target the exact document: a tab/frame may have navigated while awaiting storage.
async function syncYouTubeDocument(sender) {
    const url = new URL(sender.url);
    if (!sender.tab || !sender.documentId || !/^https?:$/.test(url.protocol) ||
        !/(^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname)) {
        throw new Error('Not a YouTube document');
    }
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    const topHost = new URL(sender.tab.url || sender.url).hostname;
    const active = await isProtectionActive() &&
        !allowedHost(url.hostname, whitelist) && !allowedHost(topHost, whitelist);
    const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
    if (active) await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['youtube-inject.js'] });
    await chrome.scripting.executeScript({
        target, world: 'MAIN',
        func: enabled => window.__goablockadYt?.setEnabled(enabled),
        args: [active]
    });
    return { ok: true, active };
}

chrome.runtime.onInstalled.addListener(() => enqueue(async () => {
    const result = await chrome.storage.local.get(null);
    const defaults = { enabled: true, cosmetic: true, filterStates: {}, customFilters: '', whitelist: [], pausedUntil: 0 };
    for (const key of Object.keys(defaults)) if (result[key] !== undefined) delete defaults[key];
    if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
    await chrome.storage.local.remove(['count', 'domainStats']);
    await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
    await synchronize();
}));

chrome.runtime.onStartup.addListener(() => enqueue(synchronize));
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && ['whitelist', 'enabled', 'pausedUntil', 'filterStates', 'customFilters'].some(k => changes[k])) {
        return enqueue(synchronize);
    }
});
chrome.alarms.onAlarm.addListener(alarm => {
    // Re-read the deadline: an old alarm may arrive after a new pause was requested.
    if (alarm.name === PAUSE_ALARM) return enqueue(synchronize);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    enqueue(async () => {
        switch (msg?.type) {
            case 'youtubeState':
                return syncYouTubeDocument(sender);
            case 'pauseProtection': {
                const value = Number(msg.minutes);
                const minutes = Number.isFinite(value) ? Math.min(1440, Math.max(1, value || 15)) : 15;
                const until = Date.now() + minutes * 60 * 1000;
                await chrome.storage.local.set({ pausedUntil: until });
                await synchronize();
                return { ok: true, pausedUntil: until };
            }
            case 'resumeProtection':
                await chrome.storage.local.set({ pausedUntil: 0 });
                await synchronize();
                return { ok: true };
            case 'toggleWhitelist': {
                const domain = String(msg.domain || '').toLowerCase().replace(/^www\./, '');
                if (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(domain)) throw new Error('Invalid domain');
                const { whitelist = [] } = await chrome.storage.local.get('whitelist');
                // Removing an inherited exception must remove the parent entry too.
                const whitelisted = allowedHost(domain, whitelist);
                const next = whitelisted ? whitelist.filter(d => !(domain === d || domain.endsWith('.' + d))) : [...whitelist, domain];
                await chrome.storage.local.set({ whitelist: next });
                await synchronize();
                return { ok: true, whitelisted: !whitelisted, whitelist: next };
            }
            case 'saveFilterStates':
                await chrome.storage.local.set({ filterStates: { 'builtin-network': msg.states?.['builtin-network'] !== false } });
                await synchronize();
                return { ok: true };
            case 'saveCustomFilters':
                await chrome.storage.local.set({ customFilters: String(msg.raw || '') });
                return rebuildCustomRules();
            default:
                return { ok: false, error: 'unknown message' };
        }
    }).then(sendResponse, err => sendResponse({ ok: false, error: err.message }));
    return true;
});

// Alarms can disappear on extension updates or browser restarts. Also reconcile
// on a service-worker wake, not only on the browser's onStartup event.
enqueue(synchronize);

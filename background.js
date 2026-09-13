// GoaBlockAD - Background Service Worker

const DYNAMIC_CUSTOM_START = 10000;
const DYNAMIC_ALLOW_START = 20000;
const PAUSE_ALARM = 'goablockad-pause-resume';
const BADGE_COLOR = '#00bcd4';
// Chrome caps "unsafe" dynamic rules (block, redirect…) at 5000.
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
// Pause mode
// ─────────────────────────────────────────────
async function isProtectionActive() {
    const { enabled = true, pausedUntil = 0 } = await chrome.storage.local.get(['enabled', 'pausedUntil']);
    return enabled && !(pausedUntil && Date.now() < pausedUntil);
}

async function applyProtectionState() {
    const shouldEnable = await isProtectionActive();

    try {
        if (shouldEnable) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['ruleset_1'] });
        } else {
            await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['ruleset_1'] });
        }
    } catch (err) {
        console.warn('GoaBlockAD: ruleset toggle warning', err.message);
    }
    // Custom rules are dynamic and ignore the ruleset toggle: add/remove them too.
    await rebuildCustomRules();
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

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
    const result = await chrome.storage.local.get([
        'enabled', 'cosmetic', 'filterStates', 'customFilters', 'whitelist', 'pausedUntil'
    ]);
    const defaults = {};
    if (result.enabled === undefined) defaults.enabled = true;
    if (result.cosmetic === undefined) defaults.cosmetic = true;
    if (result.filterStates === undefined) defaults.filterStates = {};
    if (result.customFilters === undefined) defaults.customFilters = '';
    if (result.whitelist === undefined) defaults.whitelist = [];
    if (result.pausedUntil === undefined) defaults.pausedUntil = 0;
    if (Object.keys(defaults).length > 0) {
        await chrome.storage.local.set(defaults);
    }
    // Leftovers of the old counter (≤ 1.3.x), which only ever counted cosmetic hides.
    await chrome.storage.local.remove(['count', 'domainStats']);
    await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
    await rebuildAllowRules(result.whitelist || []);
    await applyProtectionState();
    await refreshBadgeText();
});

chrome.runtime.onStartup.addListener(async () => {
    // Ensure a stale pause from a previous session is cleared
    const { pausedUntil = 0 } = await chrome.storage.local.get('pausedUntil');
    if (pausedUntil && Date.now() >= pausedUntil) {
        await chrome.storage.local.set({ pausedUntil: 0 });
    }
    await applyProtectionState();
    await refreshBadgeText();
});

// ─────────────────────────────────────────────
// Storage-driven effects
// ─────────────────────────────────────────────
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.whitelist) await rebuildAllowRules(changes.whitelist.newValue || []);
    if (changes.enabled || changes.pausedUntil) {
        await applyProtectionState();
        await refreshBadgeText();
    }
});

// ─────────────────────────────────────────────
// Alarms (auto-resume from pause)
// ─────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === PAUSE_ALARM) {
        await chrome.storage.local.set({ pausedUntil: 0 });
    }
});

// ─────────────────────────────────────────────
// Message API (popup / dashboard)
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        if (!msg || !msg.type) return sendResponse({ ok: false });
        switch (msg.type) {
            case 'pauseProtection': {
                const minutes = Math.max(1, Number(msg.minutes) || 15);
                const until = Date.now() + minutes * 60 * 1000;
                await chrome.storage.local.set({ pausedUntil: until });
                await chrome.alarms.create(PAUSE_ALARM, { when: until });
                return sendResponse({ ok: true, pausedUntil: until });
            }
            case 'resumeProtection': {
                await chrome.alarms.clear(PAUSE_ALARM);
                await chrome.storage.local.set({ pausedUntil: 0 });
                return sendResponse({ ok: true });
            }
            case 'toggleWhitelist': {
                const domain = msg.domain;
                if (!domain) return sendResponse({ ok: false, error: 'no domain' });
                const { whitelist = [] } = await chrome.storage.local.get('whitelist');
                const idx = whitelist.indexOf(domain);
                const next = [...whitelist];
                if (idx >= 0) next.splice(idx, 1); else next.push(domain);
                await chrome.storage.local.set({ whitelist: next });
                return sendResponse({ ok: true, whitelisted: idx < 0, whitelist: next });
            }
            case 'saveCustomFilters': {
                await chrome.storage.local.set({ customFilters: String(msg.raw || '') });
                return sendResponse(await rebuildCustomRules());
            }
            default:
                return sendResponse({ ok: false, error: 'unknown message' });
        }
    })();
    return true;
});

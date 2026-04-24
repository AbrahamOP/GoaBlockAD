// GoaBlockAD - Background Service Worker

const DYNAMIC_CUSTOM_START = 10000;
const DYNAMIC_ALLOW_START = 20000;
const PAUSE_ALARM = 'goablockad-pause-resume';
const BADGE_COLOR = '#00bcd4';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function parseCustomFilters(raw) {
    return (raw || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));
}

function buildCustomBlockRules(lines) {
    return lines.map((domain, i) => ({
        id: DYNAMIC_CUSTOM_START + i,
        priority: 1,
        action: { type: 'block' },
        condition: {
            urlFilter: domain,
            resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'stylesheet', 'font', 'media', 'other']
        }
    }));
}

function buildAllowRules(domains) {
    return domains.map((domain, i) => ({
        id: DYNAMIC_ALLOW_START + i,
        priority: 100,
        action: { type: 'allowAllRequests' },
        condition: {
            initiatorDomains: [domain],
            resourceTypes: ['main_frame', 'sub_frame']
        }
    }));
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
        return null;
    }
}

function formatBadge(count) {
    if (count < 1000) return String(count);
    if (count < 10000) return (count / 1000).toFixed(1) + 'k';
    if (count < 1000000) return Math.floor(count / 1000) + 'k';
    return (count / 1000000).toFixed(1) + 'M';
}

async function replaceDynamicRulesInRange(newRules, idStart, idEnd) {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        const removeRuleIds = existing
            .filter(r => r.id >= idStart && r.id <= idEnd)
            .map(r => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds,
            addRules: newRules
        });
        return { ok: true, count: newRules.length };
    } catch (err) {
        console.error('GoaBlockAD: updateDynamicRules failed', err);
        return { ok: false, error: err.message };
    }
}

// ─────────────────────────────────────────────
// Custom filters (user-provided domains)
// ─────────────────────────────────────────────
async function rebuildCustomRules(raw) {
    const rules = buildCustomBlockRules(parseCustomFilters(raw));
    return replaceDynamicRulesInRange(rules, DYNAMIC_CUSTOM_START, DYNAMIC_CUSTOM_START + 9999);
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
async function applyProtectionState() {
    const { enabled = true, pausedUntil = 0 } = await chrome.storage.local.get(['enabled', 'pausedUntil']);
    const isPaused = pausedUntil && Date.now() < pausedUntil;
    const shouldEnable = enabled && !isPaused;

    try {
        if (shouldEnable) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['ruleset_1'] });
        } else {
            await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['ruleset_1'] });
        }
    } catch (err) {
        console.warn('GoaBlockAD: ruleset toggle warning', err.message);
    }
    updateBadgeStyle(shouldEnable);
}

function updateBadgeStyle(active) {
    if (active) {
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    } else {
        chrome.action.setBadgeBackgroundColor({ color: '#616161' });
    }
}

async function refreshBadgeText() {
    const { count = 0, enabled = true, pausedUntil = 0 } = await chrome.storage.local.get(['count', 'enabled', 'pausedUntil']);
    const isPaused = pausedUntil && Date.now() < pausedUntil;
    if (!enabled) {
        chrome.action.setBadgeText({ text: 'OFF' });
    } else if (isPaused) {
        chrome.action.setBadgeText({ text: '⏸' });
    } else {
        chrome.action.setBadgeText({ text: count > 0 ? formatBadge(count) : '' });
    }
}

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
    const result = await chrome.storage.local.get([
        'enabled', 'cosmetic', 'count', 'filterStates', 'customFilters',
        'whitelist', 'pausedUntil', 'domainStats'
    ]);
    const defaults = {};
    if (result.enabled === undefined) defaults.enabled = true;
    if (result.cosmetic === undefined) defaults.cosmetic = true;
    if (result.count === undefined) defaults.count = 0;
    if (result.filterStates === undefined) defaults.filterStates = {};
    if (result.customFilters === undefined) defaults.customFilters = '';
    if (result.whitelist === undefined) defaults.whitelist = [];
    if (result.pausedUntil === undefined) defaults.pausedUntil = 0;
    if (result.domainStats === undefined) defaults.domainStats = {};
    if (Object.keys(defaults).length > 0) {
        await chrome.storage.local.set(defaults);
    }
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
    if (changes.customFilters) await rebuildCustomRules(changes.customFilters.newValue);
    if (changes.whitelist) await rebuildAllowRules(changes.whitelist.newValue || []);
    if (changes.enabled || changes.pausedUntil) await applyProtectionState();
    if (changes.count || changes.enabled || changes.pausedUntil) await refreshBadgeText();
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
            case 'resetDomainStats': {
                await chrome.storage.local.set({ domainStats: {} });
                return sendResponse({ ok: true });
            }
            case 'rebuildCustomRules': {
                const res = await rebuildCustomRules(msg.raw);
                return sendResponse(res);
            }
            default:
                return sendResponse({ ok: false, error: 'unknown message' });
        }
    })();
    return true;
});

// ─────────────────────────────────────────────
// Live stats (requires declarativeNetRequestFeedback — unpacked builds)
// ─────────────────────────────────────────────
const statsBuffer = { count: 0, domains: {} };
let flushScheduled = false;

async function flushStats() {
    flushScheduled = false;
    if (statsBuffer.count === 0) return;
    const delta = statsBuffer.count;
    const domains = statsBuffer.domains;
    statsBuffer.count = 0;
    statsBuffer.domains = {};
    const { count = 0, domainStats = {} } = await chrome.storage.local.get(['count', 'domainStats']);
    for (const [d, n] of Object.entries(domains)) {
        domainStats[d] = (domainStats[d] || 0) + n;
    }
    await chrome.storage.local.set({ count: count + delta, domainStats });
}

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
        statsBuffer.count += 1;
        const d = extractDomain(info?.request?.url);
        if (d) statsBuffer.domains[d] = (statsBuffer.domains[d] || 0) + 1;
        if (!flushScheduled) {
            flushScheduled = true;
            setTimeout(flushStats, 1500);
        }
    });
}

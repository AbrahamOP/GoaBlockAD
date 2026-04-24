// GoaBlockAD - Background Service Worker

const DYNAMIC_RULE_START_ID = 10000;

function parseCustomFilters(raw) {
    return (raw || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));
}

function buildDynamicRules(lines) {
    return lines.map((domain, i) => ({
        id: DYNAMIC_RULE_START_ID + i,
        priority: 1,
        action: { type: 'block' },
        condition: {
            urlFilter: domain,
            resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'stylesheet', 'font', 'media', 'other']
        }
    }));
}

async function rebuildDynamicRules(raw) {
    const dynamicRules = buildDynamicRules(parseCustomFilters(raw));
    try {
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const removeIds = existingRules.map(r => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds,
            addRules: dynamicRules
        });
        return { ok: true, count: dynamicRules.length };
    } catch (err) {
        console.error('GoaBlockAD: failed to update dynamic rules', err);
        return { ok: false, error: err.message };
    }
}

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['enabled', 'cosmetic', 'count', 'filterStates', 'customFilters'], (result) => {
        const defaults = {};
        if (result.enabled === undefined) defaults.enabled = true;
        if (result.cosmetic === undefined) defaults.cosmetic = true;
        if (result.count === undefined) defaults.count = 0;
        if (result.filterStates === undefined) defaults.filterStates = {};
        if (result.customFilters === undefined) defaults.customFilters = '';
        if (Object.keys(defaults).length > 0) {
            chrome.storage.local.set(defaults);
        }
    });
});

// Single source of truth: rebuild dynamic rules whenever customFilters changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.customFilters) {
        rebuildDynamicRules(changes.customFilters.newValue);
    }
});

// Allow other views (dashboard/popup) to trigger a rebuild on demand
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'rebuildDynamicRules') {
        rebuildDynamicRules(msg.raw).then(sendResponse);
        return true;
    }
});

// Live blocking counter (requires 'declarativeNetRequestFeedback' — works in unpacked
// extensions; on the Chrome Web Store this listener is effectively a no-op)
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(() => {
        chrome.storage.local.get(['count'], (result) => {
            chrome.storage.local.set({ count: (result.count || 0) + 1 });
        });
    });
}

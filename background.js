// GoaBlockAD - Background Service Worker

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['count', 'filterStates', 'customFilters'], (result) => {
        const defaults = {};
        if (result.count === undefined) defaults.count = 0;
        if (result.filterStates === undefined) defaults.filterStates = {};
        if (result.customFilters === undefined) defaults.customFilters = '';
        if (Object.keys(defaults).length > 0) {
            chrome.storage.local.set(defaults);
        }
    });
});

// Rebuild dynamic rules when custom filters change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.customFilters) {
        const raw = changes.customFilters.newValue || '';
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
        const dynamicRules = lines.map((domain, i) => ({
            id: 10000 + i,
            priority: 1,
            action: { type: 'block' },
            condition: {
                urlFilter: domain,
                resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'stylesheet', 'font', 'media', 'other']
            }
        }));

        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const removeIds = existingRules.map(r => r.id);

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds,
            addRules: dynamicRules
        });
    }
});

// Listen for rule matches (network blocking)
// Note: This requires 'declarativeNetRequestFeedback' permission and only works for unpacked extensions or specific contexts.
// For a production store extension, you often can't count individual blocks this easily without the feedback permission warning.
// But for a dev/local extension, this is perfect.
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    chrome.storage.local.get(['count'], (result) => {
        const newCount = (result.count || 0) + 1;
        chrome.storage.local.set({ count: newCount });

        // Optional: Update badge text
        // chrome.action.setBadgeText({ text: newCount.toString() });
        // chrome.action.setBadgeBackgroundColor({ color: '#00bcd4' });
    });
});

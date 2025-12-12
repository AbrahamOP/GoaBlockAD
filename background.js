// GoaBlockAD - Background Service Worker

// Initialize counter on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['count'], (result) => {
        if (result.count === undefined) {
            chrome.storage.local.set({ count: 0 });
        }
    });
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

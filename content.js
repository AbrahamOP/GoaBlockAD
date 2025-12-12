// GoaBlockAD - Cosmetic Filtering
// This script hides elements that commonly contain ads but aren't blocked at the network level.

const adSelectors = [
    'iframe[src*="doubleclick"]',
    'iframe[src*="googleads"]',
    'iframe[src*="ad_container"]',
    'div[id^="google_ads"]',
    'div[class*="ad-banner"]',
    'div[class*="ad_wrapper"]',
    'ins.adsbygoogle',
    'a[href*="doubleclick.net"]',
    '.ad-container',
    '.adsbox',
    '#ad-sidebar',
    '.sponsored-content'
];

function applyCosmeticFiltering() {
    // Check if filtering is enabled in storage
    chrome.storage.local.get(['enabled', 'cosmetic'], (result) => {
        if (result.enabled === false || result.cosmetic === false) return;

        const style = document.createElement('style');
        style.id = 'goablockad-cosmetic-style';
        style.textContent = `
            ${adSelectors.join(',\n')} {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                width: 0 !important;
                overflow: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;

        if (!document.getElementById('goablockad-cosmetic-style')) {
            document.head.appendChild(style);
            // console.log('GoaBlockAD: Cosmetic filtering applied');

            // Increment counter for potential hides (simplified estimation)
            // In a real scenario, we'd check how many elements actually matched.
            const hiddenCount = document.querySelectorAll(adSelectors.join(',')).length;
            if (hiddenCount > 0) {
                chrome.storage.local.get(['count'], (result) => {
                    const newCount = (result.count || 0) + hiddenCount;
                    chrome.storage.local.set({ count: newCount });
                });
            }
        }
    });
}

// Apply on load
applyCosmeticFiltering();

// Re-apply if settings change
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.enabled || changes.cosmetic)) {
        const style = document.getElementById('goablockad-cosmetic-style');
        if (style) style.remove();
        applyCosmeticFiltering();
    }
});

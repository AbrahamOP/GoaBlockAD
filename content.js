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

const COSMETIC_STYLE_ID = 'goablockad-cosmetic-style';

// Same matching as the background allow rules (requestDomains): the domain and its subdomains.
function isWhitelisted(whitelist) {
    const host = location.hostname.replace(/^www\./, '');
    return (whitelist || []).some(d => host === d || host.endsWith('.' + d));
}

function applyCosmeticFiltering() {
    chrome.storage.local.get(['enabled', 'cosmetic', 'whitelist', 'pausedUntil'], (result) => {
        document.getElementById(COSMETIC_STYLE_ID)?.remove();
        const paused = result.pausedUntil && Date.now() < result.pausedUntil;
        if (result.enabled === false || result.cosmetic === false || paused || isWhitelisted(result.whitelist)) return;

        const style = document.createElement('style');
        style.id = COSMETIC_STYLE_ID;
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
        (document.head || document.documentElement).appendChild(style);
    });
}

// Apply on load
applyCosmeticFiltering();

// Re-apply if settings change
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.enabled || changes.cosmetic || changes.whitelist || changes.pausedUntil)) {
        applyCosmeticFiltering();
    }
});

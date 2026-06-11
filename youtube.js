// GoaBlockAD - YouTube Ad Blocking
// YouTube serves video ads from the same domains as regular videos (googlevideo.com),
// so network-level blocking can't be used without breaking playback. Instead, this
// script works at the player level: it fast-forwards video ads, clicks skip buttons,
// and hides static ad slots with injected CSS.

const YT_STYLE_ID = 'goablockad-youtube-style';
const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    'button[class*="ytp-ad-skip"]'
];
const YT_AD_CSS = `
    #masthead-ad,
    ytd-ad-slot-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-in-feed-ad-layout-renderer,
    ytd-display-ad-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-sparkles-text-search-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    #player-ads,
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-merch-shelf-renderer,
    ytm-companion-slot,
    .ytp-ad-overlay-container,
    .ytp-ad-text-overlay {
        display: none !important;
    }
`;

let ytActive = false;
let pollTimer = null;
let adInProgress = false;

function isWhitelisted(whitelist) {
    const host = location.hostname.replace(/^www\./, '');
    return (whitelist || []).some(d => host === d || host.endsWith('.' + d));
}

function injectStyle() {
    if (document.getElementById(YT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = YT_STYLE_ID;
    style.textContent = YT_AD_CSS;
    (document.head || document.documentElement).appendChild(style);
}

function removeStyle() {
    document.getElementById(YT_STYLE_ID)?.remove();
}

function incrementCount() {
    chrome.storage.local.get(['count'], (result) => {
        chrome.storage.local.set({ count: (result.count || 0) + 1 });
    });
}

function skipVideoAd() {
    const player = document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
    if (!player) {
        adInProgress = false;
        return;
    }

    // Fast-forward the ad to its end — the player then resumes the real video
    const video = player.querySelector('video');
    if (video && isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration) {
        video.muted = true;
        video.currentTime = video.duration;
    }

    // Click the skip button as soon as it exists (covers non-seekable ads)
    for (const sel of SKIP_SELECTORS) {
        const btn = player.querySelector(sel);
        if (btn) { btn.click(); break; }
    }

    // Count each ad once, not every poll tick
    if (!adInProgress) {
        adInProgress = true;
        incrementCount();
    }
}

function closeOverlays() {
    document.querySelector('.ytp-ad-overlay-close-button')?.click();
}

function startBlocking() {
    if (ytActive) return;
    ytActive = true;
    injectStyle();
    // YouTube is a SPA and rebuilds the player across navigations; a light poll
    // is more reliable here than scoping a MutationObserver to a transient node.
    pollTimer = setInterval(() => {
        skipVideoAd();
        closeOverlays();
    }, 300);
}

function stopBlocking() {
    if (!ytActive) return;
    ytActive = false;
    removeStyle();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    adInProgress = false;
}

function syncState() {
    chrome.storage.local.get(['enabled', 'cosmetic', 'whitelist', 'pausedUntil'], (result) => {
        const enabled = result.enabled !== false;
        const paused = result.pausedUntil && Date.now() < result.pausedUntil;
        if (enabled && !paused && !isWhitelisted(result.whitelist)) {
            startBlocking();
        } else {
            stopBlocking();
        }
    });
}

syncState();

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.enabled || changes.whitelist || changes.pausedUntil) syncState();
});

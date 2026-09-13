// GoaBlockAD - YouTube player fallback
// youtube-inject.js removes ads from the player data; this script catches what
// slips through. YouTube serves video ads from googlevideo.com, like the videos
// themselves, so they can't be blocked at the network level: instead the ad is
// hidden, muted and fast-forwarded, and the skip button clicked. Static ad slots
// (masthead, feed, banners) are hidden with CSS.
// Merges #11 and the player handling proposed by @PoPoGH in #10.

const YT_STYLE_ID = 'goablockad-youtube-style';
const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-container button',
    'button[class*="ytp-ad-skip"]',
    'button[class*="ytp-skip-ad"]'
];
// Hides the ad while it's still on screen, before the skip kicks in.
const PLAYER_AD_CSS = `
    .html5-video-player.ad-showing video,
    .html5-video-player.ad-interrupting video {
        opacity: 0 !important;
    }
    .ytp-ad-module,
    .ytp-ad-player-overlay,
    .ytp-ad-player-overlay-layout,
    .ytp-ad-image-overlay,
    .ytp-ad-overlay-container,
    .ytp-ad-text-overlay,
    .ytp-ad-action-interstitial,
    .ytp-flyout-cta,
    .ytp-ad-survey {
        display: none !important;
    }
`;
// Cosmetic part, follows the "cosmetic" setting like content.js.
const AD_SLOTS_CSS = `
    #masthead-ad,
    #player-ads,
    ytd-ad-slot-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-in-feed-ad-layout-renderer,
    ytd-display-ad-renderer,
    ytd-promoted-video-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-sparkles-text-search-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    ytd-companion-slot-renderer,
    ytd-action-companion-ad-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-merch-shelf-renderer,
    ytm-companion-slot,
    ytmusic-ad-slot-renderer,
    ytmusic-statement-banner-renderer {
        display: none !important;
    }
`;

let pollTimer = null;
// Per <video> element: the ad source already fast-forwarded, the grace period
// after a source change, and whether we muted it.
const videoState = new WeakMap();

function isWhitelisted(whitelist) {
    const host = location.hostname.replace(/^www\./, '');
    return (whitelist || []).some(d => host === d || host.endsWith('.' + d));
}

function setStyle(css) {
    let style = document.getElementById(YT_STYLE_ID);
    if (!css) return style?.remove();
    if (!style) {
        style = document.createElement('style');
        style.id = YT_STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
}

function stateOf(video) {
    let s = videoState.get(video);
    if (!s) {
        s = { skippedSrc: null, graceUntil: 0, mutedByUs: false };
        videoState.set(video, s);
        // On a source change the player may still carry `ad-showing` for a
        // moment: wait before fast-forwarding, or the real video gets sent to its end.
        video.addEventListener('loadstart', () => {
            s.skippedSrc = null;
            s.graceUntil = Date.now() + 150;
        });
    }
    return s;
}

function handlePlayer() {
    const player = document.querySelector('.html5-video-player');
    const video = player?.querySelector('video');
    if (!video) return;
    const s = stateOf(video);
    const adPlaying = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');

    if (!adPlaying) {
        if (s.mutedByUs) {
            video.muted = false;
            s.mutedByUs = false;
        }
        return;
    }

    if (!video.muted) {
        video.muted = true;
        s.mutedByUs = true;
    }
    if (Date.now() >= s.graceUntil && s.skippedSrc !== video.src &&
        isFinite(video.duration) && video.duration > 0) {
        s.skippedSrc = video.src;
        video.currentTime = video.duration;
    }
    // Covers ads that can't be seeked
    for (const sel of SKIP_SELECTORS) {
        const btn = player.querySelector(sel);
        if (btn) { btn.click(); break; }
    }
    document.querySelector('.ytp-ad-overlay-close-button')?.click();
}

function syncState() {
    chrome.storage.local.get(['enabled', 'cosmetic', 'whitelist', 'pausedUntil'], (result) => {
        const paused = result.pausedUntil && Date.now() < result.pausedUntil;
        const active = result.enabled !== false && !paused && !isWhitelisted(result.whitelist);
        if (!active) {
            setStyle('');
            clearInterval(pollTimer);
            pollTimer = null;
            return;
        }
        setStyle(PLAYER_AD_CSS + (result.cosmetic !== false ? AD_SLOTS_CSS : ''));
        // YouTube is a SPA and rebuilds the player across navigations; a light poll
        // is more reliable than an observer scoped to a transient node.
        pollTimer ??= setInterval(handlePlayer, 250);
    });
}

syncState();

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.enabled || changes.cosmetic || changes.whitelist || changes.pausedUntil) syncState();
});

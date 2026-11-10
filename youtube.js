(() => {
// GoaBlockAD - YouTube player fallback
// youtube-inject.js removes ads from the player data; this script catches what
// slips through. YouTube serves video ads from googlevideo.com, like the videos
// themselves, so they can't be blocked at the network level: instead the ad is
// muted and fast-forwarded, and the skip button clicked. Static ad slots
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
// Keep the player and skip controls visible if an ad cannot be skipped.
const PLAYER_AD_CSS = `
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
let syncGeneration = 0;
const videoState = new WeakMap();
const mutedVideos = new Set();

function restoreVideo(video) {
    if (!mutedVideos.delete(video)) return;
    video.muted = false;
}

function restoreAllVideos() {
    for (const video of mutedVideos) restoreVideo(video);
}

function isWhitelisted(whitelist) {
    const host = location.hostname;
    return (whitelist || []).some(d => host === d || host.endsWith('.' + d));
}

function setStyle(css) {
    let style = document.getElementById(YT_STYLE_ID);
    if (!css) return style?.remove();
    if (!style) {
        const root = document.head || document.documentElement;
        if (!root) return; // retried at DOMContentLoaded
        style = document.createElement('style');
        style.id = YT_STYLE_ID;
        root.appendChild(style);
    }
    style.textContent = css;
}

function stateOf(video) {
    let state = videoState.get(video);
    if (!state) {
        state = { skippedSrc: null, graceUntil: Date.now() + 500 };
        videoState.set(video, state);
        video.addEventListener('loadstart', () => {
            restoreVideo(video);
            state.skippedSrc = null;
            // The player can retain its old ad class during a source transition.
            state.graceUntil = Date.now() + 750;
        });
    }
    return state;
}

function handlePlayer() {
    for (const video of mutedVideos) if (!video.isConnected) restoreVideo(video);
    for (const player of document.querySelectorAll('.html5-video-player')) {
        const video = player.querySelector('video');
        if (!video) continue;
        const state = stateOf(video);
        // ad-interrupting alone can describe the transition with the real video.
        const adPlaying = player.classList.contains('ad-showing');
        if (!adPlaying) {
            restoreVideo(video);
            state.skippedSrc = null;
            continue;
        }
        if (!video.muted) {
            video.muted = true;
            mutedVideos.add(video);
        }
        const source = video.currentSrc || video.src;
        if (source && Date.now() >= state.graceUntil && state.skippedSrc !== source &&
            Number.isFinite(video.duration) && video.duration > 0) {
            try {
                video.currentTime = video.duration;
                state.skippedSrc = source;
            } catch (_) { /* A live/unseekable ad can still expose a skip button. */ }
        }
        for (const selector of SKIP_SELECTORS) {
            const button = player.querySelector(selector);
            if (button && !button.disabled && button.getClientRects().length) {
                button.click();
                break;
            }
        }
        player.querySelector('.ytp-ad-overlay-close-button')?.click();
    }
}

function applyState(active, cosmetic) {
    if (!active) {
        setStyle('');
        clearInterval(pollTimer);
        pollTimer = null;
        restoreAllVideos();
        return;
    }
    setStyle(PLAYER_AD_CSS + (cosmetic !== false ? AD_SLOTS_CSS : ''));
    pollTimer ??= setInterval(handlePlayer, 250);
}

async function syncState() {
    const generation = ++syncGeneration;
    try {
        const result = await chrome.storage.local.get(['enabled', 'cosmetic', 'whitelist', 'pausedUntil']);
        if (generation !== syncGeneration) return;
        const paused = result.pausedUntil && Date.now() < result.pausedUntil;
        const active = result.enabled !== false && !paused && !isWhitelisted(result.whitelist);
        // Stop immediately when disabled; the background updates MAIN-world hooks.
        if (!active) applyState(false, result.cosmetic);
        const response = await chrome.runtime.sendMessage({ type: 'youtubeState' });
        if (generation !== syncGeneration) return;
        applyState(response?.ok ? response.active : active, result.cosmetic);
    } catch (_) {
        // Extension updates can invalidate an existing page's isolated context.
        applyState(false, false);
    }
}

syncState();
document.addEventListener('DOMContentLoaded', syncState, { once: true });
document.addEventListener('yt-navigate-finish', () => { if (pollTimer !== null) handlePlayer(); });
window.addEventListener('pagehide', () => { ++syncGeneration; applyState(false, false); });
window.addEventListener('pageshow', syncState);
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.enabled || changes.cosmetic || changes.whitelist || changes.pausedUntil)) syncState();
});

})();

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
    '.sponsored-content',
    // YouTube
    'ytd-display-ad-renderer',
    'ytd-promoted-video-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-ad-slot-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-merch-shelf-renderer',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    '#masthead-ad',
    '#player-ads',
    '.ytp-ad-overlay-slot',
    '.ytp-ad-overlay-container',
    '.ytp-featured-product',
    '.ytp-suggested-action',
    'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
    'ytmusic-statement-banner-renderer'
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

// ─────────────────────────────────────────────
// YouTube video ad auto-skip
// Runs only on YouTube. Clicks the skip button when available, and fast-forwards
// non-skippable ads by jumping the player to the end of the ad clip.
// Independent of the cosmetic toggle — gated only by the master `enabled` flag.
// ─────────────────────────────────────────────
(() => {
    const host = location.hostname;
    if (!/(^|\.)youtube\.com$/.test(host) && !/(^|\.)youtube-nocookie\.com$/.test(host)) return;

    const LOG = '[GoaBlockAD/yt]';
    const SKIP_SELECTORS = [
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button-container button',
        '.ytp-skip-ad button',
        'button[class*="ytp-ad-skip"]',
        'button[class*="ytp-skip-ad"]'
    ];

    let enabled = true;
    chrome.storage.local.get(['enabled'], (r) => {
        enabled = r.enabled !== false;
        console.log(LOG, 'init, enabled =', enabled);
    });
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.enabled) {
            enabled = changes.enabled.newValue !== false;
        }
    });

    function isAdPlaying(player) {
        return !!player && (
            player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting')
        );
    }

    function clickSkipButtons() {
        for (const sel of SKIP_SELECTORS) {
            const btns = document.querySelectorAll(sel);
            for (const btn of btns) {
                try { btn.click(); } catch (_) { /* ignore */ }
            }
        }
    }

    // Per-video state. Reset whenever the underlying <video> swaps src.
    const videoState = new WeakMap();

    function getState(video) {
        let s = videoState.get(video);
        if (!s) {
            s = { skippedSrc: null, suspendUntil: 0 };
            videoState.set(video, s);
        }
        return s;
    }

    function fastForwardAd(video) {
        if (!video) return;
        const state = getState(video);
        // Guard: after a src swap (loadstart), YouTube may not have cleared
        // the `ad-showing` class yet — wait it out so we don't fast-forward
        // the real video by mistake.
        if (Date.now() < state.suspendUntil) return;
        // Only skip once per ad src to avoid bleeding into the real video.
        if (state.skippedSrc === video.src) return;
        if (!isFinite(video.duration) || video.duration <= 0) return;
        try {
            state.skippedSrc = video.src;
            video.muted = true;
            video.currentTime = video.duration;
            chrome.storage.local.get(['count'], (r) => {
                chrome.storage.local.set({ count: (r.count || 0) + 1 });
            });
        } catch (_) { /* ignore */ }
    }

    function muteIfAd(video) {
        if (video && !video.muted) {
            try { video.muted = true; } catch (_) { /* ignore */ }
        }
    }

    function tick() {
        if (!enabled) return;
        const player = document.querySelector('.html5-video-player, #movie_player');
        if (!player) return;
        if (isAdPlaying(player)) {
            const video = player.querySelector('video');
            muteIfAd(video);
            fastForwardAd(video);
            clickSkipButtons();
        }
    }

    // Hook the video element's own timeupdate event — fires while the ad is
    // playing, even when our MutationObserver misses the class transition.
    const videoListeners = new WeakSet();
    function attachVideoListener(video) {
        if (!video || videoListeners.has(video)) return;
        videoListeners.add(video);

        // When the underlying media changes (next ad or real video), restore
        // playback state so previous mutations don't bleed across, and arm a
        // short suspension window before allowing another skip.
        video.addEventListener('loadstart', () => {
            const s = getState(video);
            s.skippedSrc = null;
            s.suspendUntil = Date.now() + 150;
            try {
                video.playbackRate = 1;
                // Only unmute if we're transitioning OUT of an ad. While the
                // player is still in ad mode (chained ads), keep audio muted.
                const player = video.closest('.html5-video-player');
                if (!isAdPlaying(player)) {
                    video.muted = false;
                }
            } catch (_) { /* ignore */ }
        });

        video.addEventListener('timeupdate', () => {
            if (!enabled) return;
            const player = video.closest('.html5-video-player');
            if (isAdPlaying(player)) {
                muteIfAd(video);
                fastForwardAd(video);
                clickSkipButtons();
            }
        });
        console.log(LOG, 'attached timeupdate listener to <video>');
    }

    function findVideos() {
        document.querySelectorAll('video').forEach(attachVideoListener);
    }

    const observer = new MutationObserver(() => {
        findVideos();
        tick();
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'src']
    });

    // Initial pass + backup interval
    findVideos();
    tick();
    setInterval(() => { findVideos(); tick(); }, 500);
})();

// GoaBlockAD - YouTube player data pruning
// Runs in the page (MAIN world) at document_start, so it sees the player data
// before the player does: ad fields are removed from the initial player response
// embedded in the page and from the youtubei API responses fetched on SPA
// navigation. The player then never schedules an ad.
// Registered dynamically by background.js only while protection is active and
// YouTube isn't allow-listed — this script has no access to extension storage.
// Based on the approach proposed by @PoPoGH in #10.

(() => {
    if (window.__goablockadYt) return;
    window.__goablockadYt = true;

    const AD_KEYS = new Set(['playerAds', 'adPlacements', 'adSlots', 'adBreakHeartbeatParams']);
    const API_PATHS = ['/youtubei/v1/player', '/youtubei/v1/next', '/youtubei/v1/reel/reel_watch_sequence'];

    function prune(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        for (const key of Object.keys(obj)) {
            if (AD_KEYS.has(key)) delete obj[key];
            else prune(obj[key]);
        }
        return obj;
    }

    function pruneText(text) {
        try {
            return JSON.stringify(prune(JSON.parse(text)));
        } catch (_) {
            return text;
        }
    }

    function isApiUrl(url) {
        try {
            const { pathname } = new URL(String(url), location.href);
            return API_PATHS.some(p => pathname.startsWith(p));
        } catch (_) {
            return false;
        }
    }

    // ── Data embedded in the page (first load of /watch, /shorts) ──
    // YouTube assigns `var ytInitialPlayerResponse = {...}` in an inline script;
    // an accessor on window catches that assignment.
    let initialPlayerResponse;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get: () => initialPlayerResponse,
        set: (value) => { initialPlayerResponse = prune(value); }
    });

    // ── fetch ──
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
        const promise = origFetch.apply(this, arguments);
        const url = input instanceof Request ? input.url : input;
        if (!isApiUrl(url)) return promise;
        return promise.then(response => {
            if (!response.ok) return response;
            return response.clone().text().then(text => {
                const pruned = new Response(pruneText(text), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
                Object.defineProperty(pruned, 'url', { value: response.url });
                return pruned;
            }, () => response);
        });
    };

    // ── XMLHttpRequest ──
    const xhrProto = XMLHttpRequest.prototype;
    const origOpen = xhrProto.open;
    const responseText = Object.getOwnPropertyDescriptor(xhrProto, 'responseText').get;
    const response = Object.getOwnPropertyDescriptor(xhrProto, 'response').get;

    xhrProto.open = function (method, url) {
        if (isApiUrl(url)) {
            let raw, pruned;
            const cached = (value) => {
                if (value !== raw) { raw = value; pruned = pruneText(value); }
                return pruned;
            };
            Object.defineProperty(this, 'responseText', {
                configurable: true,
                get() { return cached(responseText.call(this)); }
            });
            Object.defineProperty(this, 'response', {
                configurable: true,
                get() {
                    const value = response.call(this);
                    if (typeof value === 'string') return cached(value);
                    return this.responseType === 'json' ? prune(value) : value;
                }
            });
        }
        return origOpen.apply(this, arguments);
    };
})();

// GoaBlockAD - YouTube player API interception
// Runs in the MAIN world (page context) so it can wrap window.fetch and
// XMLHttpRequest before YouTube's player code reads the response. Strips
// ad-placement fields from /youtubei/v1/player and /youtubei/v1/next so the
// player never tries to render an ad.

(() => {
    if (window.__goablockad_yt_inject) return;
    window.__goablockad_yt_inject = true;

    const AD_FIELDS = [
        'playerAds',
        'adPlacements',
        'adSlots',
        'adBreakHeartbeatParams'
    ];

    function shouldIntercept(url) {
        if (!url || typeof url !== 'string') return false;
        return url.includes('/youtubei/v1/player') ||
               url.includes('/youtubei/v1/next') ||
               url.includes('/youtubei/v1/reel/reel_watch_sequence');
    }

    function stripAds(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const key of AD_FIELDS) {
            if (key in obj) delete obj[key];
        }
        // Some ad placements live nested in playerOverlays / contents — walk
        // shallowly and strip any encountered.
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') stripAds(v);
        }
    }

    function patchResponseText(text) {
        try {
            const json = JSON.parse(text);
            stripAds(json);
            return JSON.stringify(json);
        } catch (_) {
            return text;
        }
    }

    // ── fetch ───────────────────────────────────────────────
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const promise = origFetch.apply(this, arguments);
        if (!shouldIntercept(url)) return promise;

        return promise.then((response) => {
            if (!response || !response.ok) return response;
            return response.clone().text().then((text) => {
                const cleaned = patchResponseText(text);
                return new Response(cleaned, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }).catch(() => response);
        });
    };

    // ── XMLHttpRequest ──────────────────────────────────────
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    const origResponseTextGetter = Object.getOwnPropertyDescriptor(XHR, 'responseText').get;
    const origResponseGetter = Object.getOwnPropertyDescriptor(XHR, 'response').get;

    XHR.open = function(method, url) {
        this.__goa_url = url;
        return origOpen.apply(this, arguments);
    };

    XHR.send = function() {
        const url = this.__goa_url || '';
        if (!shouldIntercept(url)) return origSend.apply(this, arguments);

        const xhr = this;
        let cachedOriginal = null;
        let cachedPatched = null;
        const patch = (raw) => {
            if (raw === cachedOriginal) return cachedPatched;
            cachedOriginal = raw;
            cachedPatched = patchResponseText(raw);
            return cachedPatched;
        };

        // Override on the instance so that whenever YouTube reads either of
        // these (regardless of when our readystatechange handler fires), it
        // gets the cleaned payload.
        Object.defineProperty(xhr, 'responseText', {
            configurable: true,
            get() { return patch(origResponseTextGetter.call(xhr)); }
        });
        Object.defineProperty(xhr, 'response', {
            configurable: true,
            get() {
                const raw = origResponseGetter.call(xhr);
                return typeof raw === 'string' ? patch(raw) : raw;
            }
        });

        return origSend.apply(this, arguments);
    };
})();

// Runs in YouTube's MAIN world before page scripts. No remote code or requests.
(() => {
    if (window.__goablockadYt) return;
    let enabled = true;
    window.__goablockadYt = { setEnabled(value) { enabled = value === true; } };

    const AD_KEYS = new Set(['playerAds', 'adPlacements', 'adSlots', 'adBreakHeartbeatParams']);
    const AD_RENDERERS = new Set(['adSlotRenderer', 'displayAdRenderer', 'inFeedAdLayoutRenderer',
        'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer', 'promotedVideoRenderer']);
    const API_PATHS = new Set(['/youtubei/v1/player', '/youtubei/v1/next', '/youtubei/v1/browse',
        '/youtubei/v1/reel/reel_watch_sequence']);

    function isAdItem(item) {
        if (!item || typeof item !== 'object') return false;
        return Object.keys(item).some(k => AD_RENDERERS.has(k)) ||
            !!(item.richItemRenderer && isAdItem(item.richItemRenderer.content));
    }

    function prune(obj) {
        if (!enabled || !obj || typeof obj !== 'object') return obj;
        // Page-assigned objects can contain cycles; JSON API payloads cannot.
        const seen = new WeakSet();
        const pending = [obj];
        while (pending.length) {
            const value = pending.pop();
            if (!value || typeof value !== 'object' || seen.has(value)) continue;
            seen.add(value);
            if (Array.isArray(value)) {
                for (let i = value.length - 1; i >= 0; i--) if (isAdItem(value[i])) value.splice(i, 1);
            }
            for (const key of Object.keys(value)) {
                if (AD_KEYS.has(key) || AD_RENDERERS.has(key)) delete value[key];
                else if (value[key] && typeof value[key] === 'object') pending.push(value[key]);
            }
        }
        return obj;
    }

    function pruneText(text) {
        if (!enabled || typeof text !== 'string') return text;
        try { return JSON.stringify(prune(JSON.parse(text))); }
        catch (_) { return text; }
    }

    function isApiUrl(input) {
        try {
            const url = new URL(String(input), location.href);
            return url.origin === location.origin && API_PATHS.has(url.pathname.replace(/\/$/, ''));
        } catch (_) { return false; }
    }

    // Preserve an existing response when enabling on an already open page.
    for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
        const descriptor = Object.getOwnPropertyDescriptor(window, name);
        if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set)) continue;
        let value = prune(window[name]);
        Object.defineProperty(window, name, {
            configurable: true, enumerable: descriptor?.enumerable ?? true,
            get: () => value,
            set: next => { value = prune(next); }
        });
    }

    const origFetch = window.fetch;
    window.fetch = function (input) {
        const promise = origFetch.apply(this, arguments);
        const url = input instanceof Request ? input.url : input;
        if (!enabled || !isApiUrl(url)) return promise;
        return promise.then(async response => {
            // Null-body responses (204/205) cannot be rebuilt with a string body.
            if (!enabled || !response.ok || !response.body) return response;
            const type = response.headers.get('content-type');
            if (type && !/json/i.test(type)) return response;
            try {
                const text = await response.clone().text();
                if (!enabled) return response;
                const headers = new Headers(response.headers);
                headers.delete('content-length');
                headers.delete('content-encoding');
                const result = new Response(pruneText(text), {
                    status: response.status, statusText: response.statusText, headers
                });
                // Preserve fetch metadata, including on clones used by the player.
                function decorate(copy) {
                    for (const key of ['url', 'type', 'redirected']) {
                        Object.defineProperty(copy, key, { value: response[key] });
                    }
                    const clone = copy.clone.bind(copy);
                    copy.clone = () => decorate(clone());
                    return copy;
                }
                return decorate(result);
            } catch (_) { return response; }
        });
    };

    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const getText = Object.getOwnPropertyDescriptor(proto, 'responseText').get;
    const getResponse = Object.getOwnPropertyDescriptor(proto, 'response').get;
    const hooked = new WeakSet();
    proto.open = function (method, url) {
        // An XHR can be reused for a different URL. Remove only our own hooks.
        if (hooked.has(this)) {
            delete this.responseText;
            delete this.response;
            hooked.delete(this);
        }
        if (isApiUrl(url)) {
            let raw, cached;
            const transform = value => {
                if (!enabled) return value;
                if (value !== raw) { raw = value; cached = pruneText(value); }
                return cached;
            };
            Object.defineProperty(this, 'responseText', {
                configurable: true, get() { return transform(getText.call(this)); }
            });
            Object.defineProperty(this, 'response', {
                configurable: true, get() {
                    const value = getResponse.call(this);
                    if (!enabled) return value;
                    if (typeof value === 'string') return transform(value);
                    return this.responseType === 'json' ? prune(value) : value;
                }
            });
            hooked.add(this);
        }
        return origOpen.apply(this, arguments);
    };
})();

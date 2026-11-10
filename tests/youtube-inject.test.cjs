const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const script = fs.readFileSync('youtube-inject.js', 'utf8');

function page(fetchImpl = async () => Response.json({ adPlacements: [1], videoDetails: { videoId: 'keep' } })) {
    class XHR {
        open(method, url) { this.url = url; }
        get responseText() { return this.text; }
        get response() { return this.responseType === 'json' ? this.json : this.text; }
    }
    const window = { fetch: fetchImpl, ytInitialPlayerResponse: { videoDetails: { videoId: 'initial' }, playerAds: [1] } };
    const context = vm.createContext({ window, location: { href: 'https://www.youtube.com/watch?v=test', origin: 'https://www.youtube.com' },
        Request, Response, Headers, URL, XMLHttpRequest: XHR });
    vm.runInContext(script, context);
    return { window, XHR, context };
}

test('prunes existing and assigned player data without losing videos or looping on cycles', () => {
    const { window } = page();
    assert.equal(window.ytInitialPlayerResponse.videoDetails.videoId, 'initial');
    assert.equal(window.ytInitialPlayerResponse.playerAds, undefined);
    const data = { playerAds: [1], videoDetails: { videoId: 'next' } }; data.self = data;
    window.ytInitialPlayerResponse = data;
    assert.equal(data.playerAds, undefined);
    assert.equal(data.self, data);
    assert.equal(data.videoDetails.videoId, 'next');
});

test('removes ad renderers while preserving organic feed items', () => {
    const { window } = page();
    window.ytInitialData = { contents: [{ adSlotRenderer: {} }, { richItemRenderer: { content: { adSlotRenderer: {} } } }, { videoRenderer: { videoId: 'keep' } }] };
    assert.equal(window.ytInitialData.contents.length, 1);
    assert.equal(window.ytInitialData.contents[0].videoRenderer.videoId, 'keep');
});

test('fetch pruning supports navigation, Shorts and clones; unrelated URLs pass through', async () => {
    const { window } = page();
    for (const path of ['player', 'next', 'browse', 'reel/reel_watch_sequence']) {
        const response = await window.fetch('/youtubei/v1/' + path);
        const data = await response.clone().json();
        assert.equal(data.adPlacements, undefined);
        assert.equal(data.videoDetails.videoId, 'keep');
    }
    for (const url of ['https://other.example/youtubei/v1/player', '/youtubei/v1/player_extra']) {
        assert((await (await window.fetch(url)).json()).adPlacements);
    }
});

test('null-body, invalid JSON and failed requests keep native behavior', async () => {
    const empty = page(async () => new Response(null, { status: 204 }));
    assert.equal((await empty.window.fetch('/youtubei/v1/player')).status, 204);
    const malformed = page(async () => new Response('not json'));
    assert.equal(await (await malformed.window.fetch('/youtubei/v1/player')).text(), 'not json');
    const failure = page(async () => { throw new Error('network'); });
    await assert.rejects(failure.window.fetch('/youtubei/v1/player'), /network/);
});

test('pause and resume affect fetch, initial data and in-flight responses', async () => {
    const p = page();
    p.window.__goablockadYt.setEnabled(false);
    assert((await (await p.window.fetch('/youtubei/v1/player')).json()).adPlacements);
    p.window.ytInitialPlayerResponse = { playerAds: [1] };
    assert(p.window.ytInitialPlayerResponse.playerAds);
    p.window.__goablockadYt.setEnabled(true);
    assert.equal((await (await p.window.fetch('/youtubei/v1/player')).json()).adPlacements, undefined);
    let resolve;
    const inflight = page(() => new Promise(r => { resolve = r; }));
    const promise = inflight.window.fetch('/youtubei/v1/player');
    inflight.window.__goablockadYt.setEnabled(false);
    resolve(Response.json({ playerAds: [1] }));
    assert((await (await promise).json()).playerAds);
});

test('XHR reuse and toggles do not transform unrelated responses', () => {
    const { window, XHR } = page();
    const xhr = new XHR();
    xhr.text = '{"playerAds":[1],"videoDetails":{"videoId":"keep"}}';
    xhr.open('GET', '/youtubei/v1/player');
    assert.equal(JSON.parse(xhr.responseText).playerAds, undefined);
    window.__goablockadYt.setEnabled(false);
    assert(JSON.parse(xhr.responseText).playerAds);
    window.__goablockadYt.setEnabled(true);
    xhr.open('GET', '/unrelated');
    assert(JSON.parse(xhr.responseText).playerAds);
    xhr.responseType = 'json'; xhr.json = { adSlots: [1], videoDetails: {} };
    xhr.open('GET', '/youtubei/v1/player');
    assert.equal(xhr.response.adSlots, undefined);
});

test('repeated injection does not wrap fetch twice', () => {
    const p = page();
    const fetch = p.window.fetch;
    vm.runInContext(script, p.context);
    assert.equal(p.window.fetch, fetch);
});

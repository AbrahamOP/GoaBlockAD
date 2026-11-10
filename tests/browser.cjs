// Optional integration suite: see README for Playwright installation.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'goablockad-browser-'));
// A real PCM media resource exercises native video properties across JS worlds.
const audio = Buffer.alloc(44 + 8000 * 8 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const fixture = `<!doctype html><html><head><script>
var ytInitialPlayerResponse = { playerAds: [{id:'ad'}], adPlacements: [1], videoDetails: {videoId:'ordinary'} };
var ytInitialData = {contents:[{adSlotRenderer:{}},{videoRenderer:{videoId:'ordinary'}}]};
window.skips = 0;
</script></head><body>
<div class="html5-video-player"><video src="/fixture.wav" preload="auto"></video><button class="ytp-ad-skip-button" onclick="window.skips++">Skip</button></div>
<ytd-ad-slot-renderer>Sponsored</ytd-ad-slot-renderer><div class="ordinary">Ordinary content</div>
</body></html>`;
const payload = { playerAds: [{ id: 'ad' }], adPlacements: [1], videoDetails: { videoId: 'ordinary' } };

(async () => {
    let context;
    const failures = [];
    try {
        context = await chromium.launchPersistentContext(profile, {
            executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()), headless: true,
            args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`, '--no-sandbox']
        });
        context.setDefaultTimeout(10000);
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const extensionId = new URL(worker.url()).hostname;
        await worker.evaluate(async () => { await stateQueue; });
        const dashboard = await context.newPage();
        dashboard.on('pageerror', e => failures.push(e.message));
        await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
        const send = msg => dashboard.evaluate(msg => chrome.runtime.sendMessage(msg), msg);
        const stored = () => worker.evaluate(() => chrome.storage.local.get(null));
        await dashboard.locator('[data-tab="filter-lists"]').click();
        assert.equal(await dashboard.locator('.filter-item').count(), 1);
        await dashboard.locator('[data-filter="builtin-network"]').uncheck();
        await dashboard.waitForFunction(async () => !(await chrome.declarativeNetRequest.getEnabledRulesets()).length);
        await dashboard.locator('[data-filter="builtin-network"]').check();
        await dashboard.waitForFunction(async () => (await chrome.declarativeNetRequest.getEnabledRulesets()).includes('ruleset_1'));
        console.log('PASS real dashboard controls the Chrome DNR ruleset');

        await context.route(/https:\/\/(www\.)?youtube(?:-nocookie)?\.com\//, route => {
            const url = new URL(route.request().url());
            if (url.pathname.endsWith('.wav')) {
                const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
                const start = Number(range?.[1] || 0);
                const end = range?.[2] ? Number(range[2]) : audio.length - 1;
                return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav',
                    headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) },
                    body: audio.subarray(start, end + 1) });
            }
            if (url.pathname.startsWith('/youtubei/')) return route.fulfill({ json: payload });
            return route.fulfill({ contentType: 'text/html', body: fixture });
        });
        const page = await context.newPage();
        page.on('pageerror', e => failures.push(e.message));
        await page.goto('https://www.youtube.com/watch?v=fixture');
        await page.waitForSelector('#goablockad-youtube-style', { state: 'attached' });
        const initial = await page.evaluate(() => ({ player: ytInitialPlayerResponse, feed: ytInitialData }));
        assert.equal(initial.player.playerAds, undefined);
        assert.equal(initial.player.videoDetails.videoId, 'ordinary');
        assert.equal(initial.feed.contents.length, 1);
        assert.equal(await page.locator('ytd-ad-slot-renderer').isVisible(), false);
        const fetchPlayer = () => page.evaluate(async () => (await fetch('/youtubei/v1/player')).json());
        assert.equal((await fetchPlayer()).playerAds, undefined);
        const xhr = await page.evaluate(() => new Promise(resolve => {
            const request = new XMLHttpRequest(); request.open('GET', '/youtubei/v1/next');
            request.onload = () => resolve(JSON.parse(request.responseText)); request.send();
        }));
        assert.equal(xhr.playerAds, undefined);
        console.log('PASS early MAIN injection, fetch/XHR pruning and sponsored slots');

        await page.evaluate(() => document.querySelector('.html5-video-player').classList.add('ad-showing'));
        await page.waitForFunction(() => document.querySelector('video').muted && document.querySelector('video').currentTime >= 7.9 && skips > 0).catch(async e => { console.log(await page.locator('video').evaluate(v => ({muted:v.muted, time:v.currentTime, duration:v.duration, src:v.currentSrc, ready:v.readyState, error:v.error?.message, skips:window.skips}))); console.log(failures); throw e; });
        assert.equal((await send({ type: 'pauseProtection', minutes: 15 })).ok, true);
        await page.waitForFunction(() => !document.querySelector('video').muted && !document.getElementById('goablockad-youtube-style'));
        await page.waitForFunction(async () => (await (await fetch('/youtubei/v1/player')).json()).playerAds);
        assert.equal(await page.locator('ytd-ad-slot-renderer').isVisible(), true);
        assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).length, 0);
        assert((await worker.evaluate(() => chrome.alarms.get('goablockad-pause-resume'))).scheduledTime > Date.now());
        await send({ type: 'resumeProtection' });
        await page.waitForSelector('#goablockad-youtube-style', { state: 'attached' });
        assert.equal((await fetchPlayer()).playerAds, undefined);
        console.log('PASS ad fallback, pause unmutes, MAIN hooks pause/resume without reload');

        await page.evaluate(() => {
            document.querySelector('.html5-video-player').classList.remove('ad-showing');
            document.querySelector('video').src = '/ordinary.wav';
            history.pushState({}, '', '/watch?v=second');
            document.dispatchEvent(new Event('yt-navigate-finish'));
        });
        await page.waitForFunction(() => !document.querySelector('video').muted && document.querySelector('video').readyState >= 1);
        await page.locator('video').evaluate(v => { v.currentTime = 5; });
        await new Promise(resolve => setTimeout(resolve, 900));
        assert.equal(await page.locator('video').evaluate(v => v.currentTime), 5);
        await page.evaluate(() => { document.querySelector('video').muted = true; document.querySelector('.html5-video-player').classList.add('ad-showing'); });
        await send({ type: 'pauseProtection' });
        await page.waitForSelector('#goablockad-youtube-style', { state: 'detached' });
        assert.equal(await page.locator('video').evaluate(v => v.muted), true);
        await page.evaluate(() => { document.querySelector('video').muted = false; document.querySelector('.html5-video-player').classList.remove('ad-showing'); });
        await send({ type: 'resumeProtection' });
        console.log('PASS SPA ordinary video is not seeked; pre-existing user mute survives pause');

        await send({ type: 'toggleWhitelist', domain: 'youtube.com' });
        await page.waitForSelector('#goablockad-youtube-style', { state: 'detached' });
        await page.waitForFunction(async () => (await (await fetch('/youtubei/v1/player')).json()).playerAds);
        await page.reload();
        assert((await page.evaluate(() => ytInitialPlayerResponse)).playerAds);
        await send({ type: 'toggleWhitelist', domain: 'youtube.com' });
        await page.waitForSelector('#goablockad-youtube-style', { state: 'attached' });
        assert.equal((await fetchPlayer()).playerAds, undefined);
        console.log('PASS allow list applies on existing and new documents, re-enables without reload');

        await dashboard.evaluate(() => chrome.storage.local.set({ cosmetic: false }));
        await page.waitForFunction(() => getComputedStyle(document.querySelector('ytd-ad-slot-renderer')).display !== 'none');
        assert.equal((await fetchPlayer()).playerAds, undefined);
        for (const url of ['https://www.youtube.com/shorts/fixture', 'https://www.youtube-nocookie.com/embed/fixture']) {
            await page.goto(url);
            await page.waitForSelector('#goablockad-youtube-style', { state: 'attached' });
            assert.equal((await page.evaluate(() => ytInitialPlayerResponse)).playerAds, undefined);
        }
        console.log('PASS cosmetic setting is independent; Shorts and nocookie embeds receive protection');

        await dashboard.evaluate(() => chrome.storage.local.set({ enabled: false }));
        await page.waitForSelector('#goablockad-youtube-style', { state: 'detached' });
        await page.waitForFunction(async () => (await (await fetch('/youtubei/v1/player')).json()).playerAds);
        await dashboard.evaluate(() => chrome.storage.local.set({ enabled: true }));
        await page.waitForSelector('#goablockad-youtube-style', { state: 'attached' });
        assert.equal((await fetchPlayer()).playerAds, undefined);
        console.log('PASS global protection switch disables and restores both YouTube layers');

        // Real DNR engine validation, available to unpacked extensions.
        const match = await worker.evaluate(() => chrome.declarativeNetRequest.testMatchOutcome({
            url: 'https://doubleclick.net/ad.js', type: 'script', initiator: 'https://example.com'
        }));
        assert(match.matchedRules.some(r => r.rulesetId === 'ruleset_1'));
        console.log('PASS Chrome DNR engine matches a bundled ad rule');
        assert.equal((await stored()).enabled, true);
        assert.deepEqual(failures, []);
        console.log('Browser integration suite passed, no page script errors.');
    } finally {
        if (context) await context.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

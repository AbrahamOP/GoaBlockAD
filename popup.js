document.addEventListener('DOMContentLoaded', async () => {
    const toggleProtection = document.getElementById('toggle-protection');
    const toggleCosmetic = document.getElementById('toggle-cosmetic');
    const statusState = document.getElementById('status-state');
    const blockedCount = document.getElementById('blocked-count');
    const currentDomainEl = document.getElementById('current-domain');
    const btnWhitelist = document.getElementById('btn-whitelist');
    const btnPause = document.getElementById('btn-pause');
    const btnResume = document.getElementById('btn-resume');
    const btnDashboard = document.getElementById('btn-open-dashboard');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentDomain = extractDomain(tab?.url);
    currentDomainEl.textContent = currentDomain || 'Page système';
    if (!currentDomain) btnWhitelist.disabled = true;

    const state = await chrome.storage.local.get(['enabled', 'cosmetic', 'count', 'whitelist', 'pausedUntil']);
    const enabled = state.enabled !== false;
    const cosmetic = state.cosmetic !== false;
    const whitelist = state.whitelist || [];
    const pausedUntil = state.pausedUntil || 0;

    toggleProtection.checked = enabled;
    toggleCosmetic.checked = cosmetic;
    blockedCount.textContent = (state.count || 0).toLocaleString('fr-FR');
    updateStatusText(enabled, pausedUntil);
    updateWhitelistButton(currentDomain, whitelist);
    updatePauseButtons(pausedUntil);

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.count) blockedCount.textContent = (changes.count.newValue || 0).toLocaleString('fr-FR');
        if (changes.whitelist) updateWhitelistButton(currentDomain, changes.whitelist.newValue || []);
        if (changes.pausedUntil || changes.enabled) {
            chrome.storage.local.get(['enabled', 'pausedUntil']).then(({ enabled: en = true, pausedUntil: pu = 0 }) => {
                updateStatusText(en, pu);
                updatePauseButtons(pu);
                toggleProtection.checked = en;
            });
        }
    });

    toggleProtection.addEventListener('change', async (e) => {
        await chrome.storage.local.set({ enabled: e.target.checked });
    });

    toggleCosmetic.addEventListener('change', async (e) => {
        await chrome.storage.local.set({ cosmetic: e.target.checked });
    });

    btnWhitelist.addEventListener('click', async () => {
        if (!currentDomain) return;
        await chrome.runtime.sendMessage({ type: 'toggleWhitelist', domain: currentDomain });
        if (tab?.id) chrome.tabs.reload(tab.id);
    });

    btnPause.addEventListener('click', async () => {
        const minutes = Number(btnPause.dataset.minutes) || 15;
        await chrome.runtime.sendMessage({ type: 'pauseProtection', minutes });
    });

    btnResume.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'resumeProtection' });
    });

    if (btnDashboard) {
        btnDashboard.addEventListener('click', () => chrome.runtime.openOptionsPage());
    }

    function updateStatusText(en, pu) {
        const hero = document.getElementById('hero-card');
        const isPaused = pu && Date.now() < pu;
        hero.classList.toggle('paused', !!isPaused);
        hero.classList.toggle('off', !en && !isPaused);
        if (isPaused) statusState.textContent = 'PAUSE';
        else if (en) statusState.textContent = 'ACTIVE';
        else statusState.textContent = 'INACTIVE';
    }

    function updateWhitelistButton(domain, list) {
        if (!domain) {
            btnWhitelist.textContent = 'Indisponible';
            return;
        }
        const allowed = list.includes(domain);
        btnWhitelist.textContent = allowed ? '✓ Autorisé ici' : 'Autoriser ici';
        btnWhitelist.classList.toggle('active', allowed);
    }

    function updatePauseButtons(pu) {
        const isPaused = pu && Date.now() < pu;
        btnPause.hidden = isPaused;
        btnResume.hidden = !isPaused;
        if (isPaused) {
            const mins = Math.ceil((pu - Date.now()) / 60000);
            btnResume.textContent = `Reprendre (${mins} min restantes)`;
        }
    }

    function extractDomain(url) {
        try {
            const host = new URL(url).hostname;
            return host.replace(/^www\./, '');
        } catch (_) {
            return null;
        }
    }
});

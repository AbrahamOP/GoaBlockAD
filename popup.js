document.addEventListener('DOMContentLoaded', () => {
    const toggleProtection = document.getElementById('toggle-protection');
    const toggleCosmetic = document.getElementById('toggle-cosmetic');
    const statusState = document.getElementById('status-state');
    const blockedCount = document.getElementById('blocked-count');
    const currentDomainEl = document.getElementById('current-domain');
    const btnWhitelist = document.getElementById('btn-whitelist');
    const btnPause = document.getElementById('btn-pause');
    const btnResume = document.getElementById('btn-resume');
    const btnDashboard = document.getElementById('btn-open-dashboard');
    const hero = document.getElementById('hero-card');

    let currentDomain = null;
    let currentTabId = null;

    // Attach listeners IMMEDIATELY so they survive async errors below.
    btnDashboard?.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        else window.open(chrome.runtime.getURL('dashboard.html'));
    });

    toggleProtection.addEventListener('change', (e) => {
        chrome.storage.local.set({ enabled: e.target.checked });
    });

    toggleCosmetic.addEventListener('change', (e) => {
        chrome.storage.local.set({ cosmetic: e.target.checked });
    });

    btnWhitelist.addEventListener('click', async () => {
        if (!currentDomain) return;
        await chrome.runtime.sendMessage({ type: 'toggleWhitelist', domain: currentDomain });
        if (currentTabId) chrome.tabs.reload(currentTabId);
    });

    btnPause.addEventListener('click', () => {
        const minutes = Number(btnPause.dataset.minutes) || 15;
        chrome.runtime.sendMessage({ type: 'pauseProtection', minutes });
    });

    btnResume.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'resumeProtection' });
    });

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

    // Initial population — safe to fail
    (async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            currentTabId = tab?.id ?? null;
            currentDomain = extractDomain(tab?.url);
        } catch (err) {
            console.warn('tabs.query failed', err);
        }
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
    })();

    function updateStatusText(en, pu) {
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
            btnResume.innerHTML = `<svg class="chip-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>Reprendre (${mins} min)`;
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

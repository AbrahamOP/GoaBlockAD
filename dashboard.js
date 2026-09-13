// GoaBlockAD – Dashboard Logic

document.addEventListener('DOMContentLoaded', async () => {

    // ──────────────────────────────────────────────
    // About — fill version dynamically from manifest
    // ──────────────────────────────────────────────
    const versionEl = document.getElementById('about-version');
    if (versionEl && chrome.runtime?.getManifest) {
        versionEl.textContent = `Version ${chrome.runtime.getManifest().version}`;
    }

    // ──────────────────────────────────────────────
    // Tab Navigation
    // ──────────────────────────────────────────────
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // ──────────────────────────────────────────────
    // Settings Tab
    // ──────────────────────────────────────────────
    const settingEnabled = document.getElementById('setting-enabled');
    const settingCosmetic = document.getElementById('setting-cosmetic');

    // Load current settings
    const { enabled = true, cosmetic = true } = await chrome.storage.local.get(['enabled', 'cosmetic']);
    settingEnabled.checked = enabled;
    settingCosmetic.checked = cosmetic;

    // Toggle network protection — background.js handles the ruleset toggle via storage.onChanged
    settingEnabled.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        await chrome.storage.local.set({ enabled: isEnabled });
        showToast(isEnabled ? 'Blocage réseau activé' : 'Blocage réseau désactivé');
    });

    // Toggle cosmetic filtering
    settingCosmetic.addEventListener('change', async (e) => {
        await chrome.storage.local.set({ cosmetic: e.target.checked });
        showToast(e.target.checked ? 'Nettoyage cosmétique activé' : 'Nettoyage cosmétique désactivé');
    });


    // ──────────────────────────────────────────────
    // Filter Lists Tab
    // ──────────────────────────────────────────────
    const filterCheckboxes = document.querySelectorAll('.filter-item input[type="checkbox"]');
    const filterSearch = document.getElementById('filter-search');

    // Load saved filter states
    const { filterStates = {} } = await chrome.storage.local.get('filterStates');

    filterCheckboxes.forEach(cb => {
        const key = cb.dataset.filter;
        if (filterStates[key] !== undefined) {
            cb.checked = filterStates[key];
        }
        // else: use the default checked state from HTML
    });

    updateCategoryCounts();
    updateRuleCount();

    // Save on change
    filterCheckboxes.forEach(cb => {
        cb.addEventListener('change', async () => {
            const states = {};
            filterCheckboxes.forEach(c => {
                states[c.dataset.filter] = c.checked;
            });
            await chrome.storage.local.set({ filterStates: states });
            updateCategoryCounts();
            updateRuleCount();
            showToast('Listes de filtres mises à jour');
        });
    });

    // Search
    filterSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.filter-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.classList.toggle('hidden', query && !text.includes(query));
        });
    });

    // Collapsible categories
    document.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
        });
    });

    function updateCategoryCounts() {
        const cats = ['default', 'ads', 'privacy', 'security', 'annoyances', 'misc', 'regions'];
        cats.forEach(cat => {
            const all = document.querySelectorAll(`input[data-cat="${cat}"]`);
            const checked = document.querySelectorAll(`input[data-cat="${cat}"]:checked`);
            const badge = document.querySelector(`[data-count-for="${cat}"]`);
            if (badge) badge.textContent = `${checked.length}/${all.length}`;
        });
    }

    function updateRuleCount() {
        const checked = document.querySelectorAll('.filter-item input:checked').length;
        document.getElementById('filter-rule-count').textContent = `${checked} liste(s) active(s)`;
    }

    // ──────────────────────────────────────────────
    // Custom Filters Tab
    // ──────────────────────────────────────────────
    const customTextarea = document.getElementById('custom-filters-textarea');
    const customCount = document.getElementById('custom-count');
    const btnCustomSave = document.getElementById('btn-custom-save');
    const btnCustomCancel = document.getElementById('btn-custom-cancel');

    // Load saved custom filters
    const { customFilters = '' } = await chrome.storage.local.get('customFilters');
    customTextarea.value = customFilters;
    updateCustomCount();

    customTextarea.addEventListener('input', updateCustomCount);

    function updateCustomCount() {
        const lines = customTextarea.value.split('\n').filter(l => l.trim().length > 0);
        customCount.textContent = `${lines.length} règle(s) personnalisée(s)`;
    }

    // Save custom filters — background.js stores them and rebuilds the dynamic rules
    btnCustomSave.addEventListener('click', async () => {
        const res = await chrome.runtime.sendMessage({ type: 'saveCustomFilters', raw: customTextarea.value });
        if (!res?.ok) return showToast(`Erreur : ${res?.error || 'règles non appliquées'}`);
        let msg = `${res.count} filtre(s) personnalisé(s) appliqué(s)`;
        if (res.rejected.length) msg += ` — ${res.rejected.length} invalide(s) ignoré(s) : ${res.rejected.slice(0, 3).join(', ')}`;
        if (res.truncated) msg += ` — ${res.truncated} au-delà de la limite de 5000`;
        showToast(msg);
    });

    // Cancel – reload saved filters
    btnCustomCancel.addEventListener('click', async () => {
        const { customFilters: saved = '' } = await chrome.storage.local.get('customFilters');
        customTextarea.value = saved;
        updateCustomCount();
        showToast('Modifications annulées');
    });

    // ──────────────────────────────────────────────
    // Sites Tab
    // ──────────────────────────────────────────────
    const whitelistEl = document.getElementById('whitelist-list');

    async function renderWhitelist() {
        const { whitelist = [] } = await chrome.storage.local.get('whitelist');
        whitelistEl.innerHTML = '';
        if (whitelist.length === 0) {
            const li = document.createElement('li');
            li.className = 'whitelist-empty';
            li.textContent = 'Aucun site autorisé.';
            whitelistEl.appendChild(li);
            return;
        }
        whitelist.forEach(domain => {
            const li = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = domain;
            const btn = document.createElement('button');
            btn.className = 'btn-remove';
            btn.textContent = 'Retirer';
            btn.addEventListener('click', async () => {
                await chrome.runtime.sendMessage({ type: 'toggleWhitelist', domain });
                showToast(`${domain} retiré de la whitelist`);
            });
            li.append(label, btn);
            whitelistEl.appendChild(li);
        });
    }


    renderWhitelist();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.whitelist) renderWhitelist();
    });

    // ──────────────────────────────────────────────
    // Toast Notification
    // ──────────────────────────────────────────────
    let toastEl = null;

    function showToast(message) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        toastEl.classList.add('show');
        clearTimeout(toastEl._timeout);
        toastEl._timeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, 2200);
    }
});

// GoaBlockAD – Dashboard Logic

document.addEventListener('DOMContentLoaded', async () => {

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
    const statsCount = document.getElementById('stats-count');
    const btnResetCount = document.getElementById('btn-reset-count');

    // Load current settings
    const { enabled = true, cosmetic = true, count = 0 } = await chrome.storage.local.get(['enabled', 'cosmetic', 'count']);
    settingEnabled.checked = enabled;
    settingCosmetic.checked = cosmetic;
    statsCount.textContent = count.toLocaleString('fr-FR');

    // Toggle network protection
    settingEnabled.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        await chrome.storage.local.set({ enabled: isEnabled });
        if (isEnabled) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['ruleset_1'] });
        } else {
            await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['ruleset_1'] });
        }
        showToast(isEnabled ? 'Blocage réseau activé' : 'Blocage réseau désactivé');
    });

    // Toggle cosmetic filtering
    settingCosmetic.addEventListener('change', async (e) => {
        await chrome.storage.local.set({ cosmetic: e.target.checked });
        showToast(e.target.checked ? 'Nettoyage cosmétique activé' : 'Nettoyage cosmétique désactivé');
    });

    // Reset counter
    btnResetCount.addEventListener('click', async () => {
        await chrome.storage.local.set({ count: 0 });
        statsCount.textContent = '0';
        showToast('Compteur réinitialisé');
    });

    // Live count update
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.count) {
            statsCount.textContent = (changes.count.newValue || 0).toLocaleString('fr-FR');
        }
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

    // Save custom filters — background.js rebuilds the dynamic rules via storage.onChanged
    btnCustomSave.addEventListener('click', async () => {
        const raw = customTextarea.value;
        await chrome.storage.local.set({ customFilters: raw });
        const lineCount = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).length;
        showToast(`${lineCount} filtre(s) personnalisé(s) appliqué(s)`);
    });

    // Cancel – reload saved filters
    btnCustomCancel.addEventListener('click', async () => {
        const { customFilters: saved = '' } = await chrome.storage.local.get('customFilters');
        customTextarea.value = saved;
        updateCustomCount();
        showToast('Modifications annulées');
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

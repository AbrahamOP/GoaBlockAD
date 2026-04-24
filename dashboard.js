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
    // Sites & Stats Tab
    // ──────────────────────────────────────────────
    const whitelistEl = document.getElementById('whitelist-list');
    const topDomainsEl = document.getElementById('top-domains');
    const domainStatsCount = document.getElementById('domain-stats-count');
    const btnResetDomainStats = document.getElementById('btn-reset-domain-stats');

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

    async function renderTopDomains() {
        const { domainStats = {} } = await chrome.storage.local.get('domainStats');
        const entries = Object.entries(domainStats).sort((a, b) => b[1] - a[1]).slice(0, 15);
        topDomainsEl.innerHTML = '';
        domainStatsCount.textContent = `${Object.keys(domainStats).length} domaine(s)`;
        if (entries.length === 0) {
            const li = document.createElement('li');
            li.className = 'top-domains-empty';
            li.textContent = 'Pas encore de données.';
            topDomainsEl.appendChild(li);
            return;
        }
        const max = entries[0][1];
        entries.forEach(([domain, n]) => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = domain;
            name.style.minWidth = '0';
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';
            name.style.whiteSpace = 'nowrap';
            name.style.flex = '0 0 40%';
            const bar = document.createElement('div');
            bar.className = 'dom-bar';
            const fill = document.createElement('span');
            fill.style.width = Math.round((n / max) * 100) + '%';
            bar.appendChild(fill);
            const count = document.createElement('span');
            count.className = 'dom-count';
            count.textContent = n.toLocaleString('fr-FR');
            li.append(name, bar, count);
            topDomainsEl.appendChild(li);
        });
    }

    renderWhitelist();
    renderTopDomains();

    btnResetDomainStats.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'resetDomainStats' });
        showToast('Stats par domaine réinitialisées');
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.whitelist) renderWhitelist();
        if (changes.domainStats) renderTopDomains();
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

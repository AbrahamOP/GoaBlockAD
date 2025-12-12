document.addEventListener('DOMContentLoaded', async () => {
    const toggleProtection = document.getElementById('toggle-protection');
    const toggleCosmetic = document.getElementById('toggle-cosmetic');
    const statusState = document.getElementById('status-state');
    const blockedCount = document.getElementById('blocked-count');

    // Load initial state
    const { enabled = true, cosmetic = true } = await chrome.storage.local.get(['enabled', 'cosmetic']);

    toggleProtection.checked = enabled;
    toggleCosmetic.checked = cosmetic;
    updateStatusText(enabled);

    // Initial blocked count
    const { count = 0 } = await chrome.storage.local.get('count');
    blockedCount.textContent = count;

    // Listen for updates (Real-time counter)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.count) {
            blockedCount.textContent = changes.count.newValue;
        }
    });

    // Protection Toggle
    toggleProtection.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        await chrome.storage.local.set({ enabled: isEnabled });
        updateStatusText(isEnabled);

        if (isEnabled) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                enableRulesetIds: ['ruleset_1']
            });
        } else {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                disableRulesetIds: ['ruleset_1']
            });
        }
    });

    // Cosmetic Toggle
    toggleCosmetic.addEventListener('change', async (e) => {
        const isCosmeticEnabled = e.target.checked;
        await chrome.storage.local.set({ cosmetic: isCosmeticEnabled });
        // content.js listens for these changes
    });

    function updateStatusText(enabled) {
        if (enabled) {
            statusState.textContent = 'ACTIVE';
            statusState.style.color = '#00bcd4';
        } else {
            statusState.textContent = 'INACTIVE';
            statusState.style.color = '#ff5252';
        }
    }
});

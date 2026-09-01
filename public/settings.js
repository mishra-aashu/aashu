/**
 * Aashu AI - Settings & Diagnostics Module
 * Handles API key management, Security password updates, Voice TTS pitch/rate, and System Diagnostics.
 */

(function () {
    const API_BASE = window.location.origin;

    function getAuthHeaders() {
        const token = localStorage.getItem('aashu_session_token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    // --- TTS Pitch & Rate Preferences ---
    let ttsRate = parseFloat(localStorage.getItem('aashu_tts_rate') || '1.0');
    let ttsPitch = parseFloat(localStorage.getItem('aashu_tts_pitch') || '1.0');

    // Expose global getters for main app speech synthesis
    window.getTTSRate = () => ttsRate;
    window.getTTSPitch = () => ttsPitch;

    document.addEventListener('DOMContentLoaded', () => {
        const settingsModal       = document.getElementById('settings-modal');
        const closeSettingsBtn    = document.getElementById('close-settings-btn');
        const openSettingsMenuItem = document.getElementById('open-settings-menu-item');
        const settingsTabBtns     = document.querySelectorAll('.settings-tab-btn');
        const settingsTabPanels   = document.querySelectorAll('.settings-tab-panel');

        // Form elements - API Key
        const groqApiKeyInput     = document.getElementById('groq-api-key-input');
        const groqKeyStatusBadge  = document.getElementById('groq-key-status-badge');
        const saveGroqKeyBtn      = document.getElementById('save-groq-key-btn');

        // Form elements - Security Password
        const currentPassInput    = document.getElementById('settings-current-pass');
        const newPassInput        = document.getElementById('settings-new-pass');
        const changePassBtn       = document.getElementById('change-pass-btn');

        // Form elements - TTS Sliders
        const ttsRateSlider       = document.getElementById('tts-rate-slider');
        const ttsRateVal          = document.getElementById('tts-rate-val');
        const ttsPitchSlider      = document.getElementById('tts-pitch-slider');
        const ttsPitchVal         = document.getElementById('tts-pitch-val');
        const testTtsBtn          = document.getElementById('test-tts-btn');

        // Diagnostics Elements
        const diagStatusText      = document.getElementById('diag-status-text');
        const diagMemoryCount     = document.getElementById('diag-memory-count');
        const diagEmbeddingModel  = document.getElementById('diag-embedding-model');
        const diagLlmModel        = document.getElementById('diag-llm-model');
        const diagDbLocation      = document.getElementById('diag-db-location');

        // Modal Open / Close
        window.openSettingsModal = function () {
            if (settingsModal) {
                settingsModal.style.display = 'flex';
                loadGroqKeyStatus();
                loadDiagnostics();
            }
        };

        window.closeSettingsModal = function () {
            if (settingsModal) settingsModal.style.display = 'none';
        };

        if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', window.closeSettingsModal);
        if (openSettingsMenuItem) {
            openSettingsMenuItem.addEventListener('click', () => {
                window.openSettingsModal();
                // Close top three-dots dropdown if open
                const topMenu = document.getElementById('top-menu-dropdown');
                if (topMenu) topMenu.style.display = 'none';
            });
        }

        // Tab Switching
        settingsTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                settingsTabBtns.forEach(b => b.classList.remove('active'));
                settingsTabPanels.forEach(p => p.classList.remove('active'));

                btn.classList.add('active');
                const targetPanelId = btn.dataset.tab;
                const targetPanel = document.getElementById(targetPanelId);
                if (targetPanel) targetPanel.classList.add('active');
            });
        });

        // 1. Groq API Key API integration
        async function loadGroqKeyStatus() {
            try {
                const res = await fetch(`${API_BASE}/api/settings/groq-key`, { headers: getAuthHeaders() });
                const data = await res.json();
                if (groqKeyStatusBadge) {
                    if (data.is_configured) {
                        groqKeyStatusBadge.className = 'status-badge-green';
                        groqKeyStatusBadge.textContent = `Key Active (${data.masked_key})`;
                    } else {
                        groqKeyStatusBadge.className = 'status-badge-orange';
                        groqKeyStatusBadge.textContent = 'Not Configured (Using Local Fallback)';
                    }
                }
            } catch (err) {
                console.warn('[Settings] Failed to fetch Groq Key status:', err);
            }
        }

        if (saveGroqKeyBtn) {
            saveGroqKeyBtn.addEventListener('click', async () => {
                const newKey = groqApiKeyInput ? groqApiKeyInput.value.trim() : '';
                if (!newKey) {
                    alert('Please enter a valid Groq API Key.');
                    return;
                }

                try {
                    saveGroqKeyBtn.disabled = true;
                    saveGroqKeyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

                    const res = await fetch(`${API_BASE}/api/settings/groq-key`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                        body: JSON.stringify({ api_key: newKey })
                    });

                    const data = await res.json();
                    if (res.ok) {
                        alert('Groq API Key updated successfully!');
                        if (groqApiKeyInput) groqApiKeyInput.value = '';
                        await loadGroqKeyStatus();
                        await loadDiagnostics();
                    } else {
                        alert(`Error: ${data.message}`);
                    }
                } catch (err) {
                    alert(`Failed to save Groq Key: ${err.message}`);
                } finally {
                    saveGroqKeyBtn.disabled = false;
                    saveGroqKeyBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Key`;
                }
            });
        }

        // 2. Change Security Password
        if (changePassBtn) {
            changePassBtn.addEventListener('click', async () => {
                const currentPass = currentPassInput ? currentPassInput.value.trim() : '';
                const newPass = newPassInput ? newPassInput.value.trim() : '';

                if (!newPass) {
                    alert('Please enter a new password / PIN.');
                    return;
                }

                try {
                    changePassBtn.disabled = true;
                    changePassBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`;

                    const res = await fetch(`${API_BASE}/api/set-password`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                        body: JSON.stringify({ password: newPass })
                    });

                    const data = await res.json();
                    if (res.ok) {
                        alert('Security password / PIN updated successfully!');
                        if (currentPassInput) currentPassInput.value = '';
                        if (newPassInput) newPassInput.value = '';
                    } else {
                        alert(`Error updating password: ${data.message}`);
                    }
                } catch (err) {
                    alert(`Failed to update password: ${err.message}`);
                } finally {
                    changePassBtn.disabled = false;
                    changePassBtn.innerHTML = `<i class="fa-solid fa-key"></i> Update Security Lock`;
                }
            });
        }

        // 3. TTS Sliders Handler
        if (ttsRateSlider) {
            ttsRateSlider.value = ttsRate;
            if (ttsRateVal) ttsRateVal.textContent = `${ttsRate.toFixed(1)}x`;

            ttsRateSlider.addEventListener('input', (e) => {
                ttsRate = parseFloat(e.target.value);
                localStorage.setItem('aashu_tts_rate', ttsRate.toString());
                if (ttsRateVal) ttsRateVal.textContent = `${ttsRate.toFixed(1)}x`;
            });
        }

        if (ttsPitchSlider) {
            ttsPitchSlider.value = ttsPitch;
            if (ttsPitchVal) ttsPitchVal.textContent = `${ttsPitch.toFixed(1)}x`;

            ttsPitchSlider.addEventListener('input', (e) => {
                ttsPitch = parseFloat(e.target.value);
                localStorage.setItem('aashu_tts_pitch', ttsPitch.toString());
                if (ttsPitchVal) ttsPitchVal.textContent = `${ttsPitch.toFixed(1)}x`;
            });
        }

        if (testTtsBtn) {
            testTtsBtn.addEventListener('click', () => {
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const utt = new SpeechSynthesisUtterance("Namaste! Voice speech output test completed successfully.");
                    utt.rate = ttsRate;
                    utt.pitch = ttsPitch;
                    window.speechSynthesis.speak(utt);
                }
            });
        }

        // 4. Load System Diagnostics
        async function loadDiagnostics() {
            try {
                const res = await fetch(`${API_BASE}/api/status`);
                const data = await res.json();

                if (diagStatusText) diagStatusText.textContent = data.status.toUpperCase();
                if (diagMemoryCount) diagMemoryCount.textContent = `${data.memory_count} Facts Stored`;
                if (diagEmbeddingModel) diagEmbeddingModel.textContent = data.embedding_model;
                if (diagLlmModel) diagLlmModel.textContent = data.llm_model;
                if (diagDbLocation) diagDbLocation.textContent = data.db_location;
            } catch (err) {
                console.warn('[Settings] Failed to load diagnostics:', err);
            }
        }
    });
})();

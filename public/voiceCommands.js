/**
 * Aashu AI - Smart Voice Actions & Quick Commands Engine
 * Direct voice triggers for system actions (Clear Screen, Export Memories, Summarize Persona, Lock App, Settings, etc.)
 */

(function () {
    const API_BASE = typeof window.getApiBase === 'function' ? window.getApiBase() : (window.location.protocol === 'file:' ? 'http://localhost:3000' : '');

    function getAuthHeaders() {
        if (typeof window.getAuthHeaders === 'function') {
            return window.getAuthHeaders();
        }
        const pwd = sessionStorage.getItem('aashu_session_password') ||
                    localStorage.getItem('aashu_session_token') ||
                    localStorage.getItem('aashu_session_password') ||
                    sessionStorage.getItem('aashu_session_token') || '';
        if (!pwd) return {};
        return {
            'x-app-password': pwd,
            'Authorization': `Bearer ${pwd}`
        };
    }

    // Helper speech response function
    function speakFeedback(text) {
        if ('speechSynthesis' in window && window.isVoiceResponseEnabled !== false) {
            window.speechSynthesis.cancel();
            const rate = window.getTTSRate ? window.getTTSRate() : 1.0;
            const pitch = window.getTTSPitch ? window.getTTSPitch() : 1.0;
            const utt = new SpeechSynthesisUtterance(text);
            utt.rate = rate;
            utt.pitch = pitch;
            window.speechSynthesis.speak(utt);
        }
    }

    // Dynamic Command Registry Array
    const commandRegistry = [];

    window.VoiceCommands = {
        /**
         * Register a dynamic custom voice command
         * @param {string} id Unique command ID
         * @param {string[]} triggers Array of phrase triggers (lowercase)
         * @param {function} handler Function to execute when matched
         */
        registerCommand: function (id, triggers, handler) {
            commandRegistry.push({ id, triggers, handler });
        },

        /**
         * Process user input text or voice phrase to check for matching voice actions
         * @param {string} rawInput 
         * @returns {boolean} True if a voice command was intercepted and handled, false otherwise.
         */
        processCommand: async function (rawInput) {
            if (!rawInput || typeof rawInput !== 'string') return false;

            const input = rawInput.trim().toLowerCase();

            // 1. Check built-in commands first

            // --- COMMAND 1: Clear Screen / Chat ---
            if (
                input.includes('clear my screen') ||
                input.includes('clear screen') ||
                input.includes('clear chat') ||
                input.includes('screen saaf') ||
                input.includes('chat saaf') ||
                input === 'clear'
            ) {
                this.executeClearScreen();
                return true;
            }

            // --- COMMAND 2: Export Memories ---
            if (
                input.includes('export memories') ||
                input.includes('download memories') ||
                input.includes('export memory') ||
                input.includes('download facts') ||
                input.includes('export my data') ||
                input.includes('memory download')
            ) {
                await this.executeExportMemories();
                return true;
            }

            // --- COMMAND 3: Summarize Persona / Knowledge ---
            if (
                input.includes('summarize what you know about me') ||
                input.includes('summarize my memories') ||
                input.includes('summarize memories') ||
                input.includes('tell me about myself') ||
                input.includes('mere baare me kya jaante ho') ||
                input.includes('what do you know about me') ||
                input.includes('my summary')
            ) {
                await this.executeSummarizeMemories();
                return true;
            }

            // --- COMMAND 4: Lock Screen / Security Vault ---
            if (
                input.includes('lock screen') ||
                input.includes('lock app') ||
                input.includes('screen lock') ||
                input.includes('lock vault')
            ) {
                this.executeLockScreen();
                return true;
            }

            // --- COMMAND 5: Open Settings ---
            if (
                input.includes('open settings') ||
                input.includes('show settings') ||
                input.includes('settings kholo')
            ) {
                if (window.openSettingsModal) window.openSettingsModal();
                speakFeedback("Opening settings and diagnostics modal.");
                return true;
            }

            // --- COMMAND 6: Copy Last Response ---
            if (
                input.includes('copy response') ||
                input.includes('copy last answer') ||
                input.includes('answer copy')
            ) {
                this.executeCopyLastResponse();
                return true;
            }

            // 2. Check dynamic custom registered commands
            for (const cmd of commandRegistry) {
                for (const trigger of cmd.triggers) {
                    if (input.includes(trigger.toLowerCase())) {
                        cmd.handler(rawInput);
                        return true;
                    }
                }
            }

            return false; // Not a voice command -> proceed to normal LLM / ask flow
        },

        // --- Action Handlers ---

        executeClearScreen: function () {
            const chatTranscript = document.getElementById('chat-transcript');
            if (chatTranscript) {
                chatTranscript.innerHTML = '';
            }

            // Also reset response card if in single mode
            const responseCard = document.getElementById('response-card');
            const responseText = document.getElementById('response-text');
            if (responseCard) responseCard.style.display = 'none';
            if (responseText) responseText.innerHTML = '';

            speakFeedback("Screen and conversation transcript cleared!");
        },

        executeExportMemories: async function () {
            try {
                speakFeedback("Exporting your persistent memories...");
                const res = await fetch(`${API_BASE}/api/facts`, { headers: getAuthHeaders() });
                const data = await res.json();
                const facts = data.facts || [];

                const exportObj = {
                    app: "Aashu AI Voice Assistant",
                    export_date: new Date().toISOString(),
                    total_memories: facts.len || facts.length,
                    memories: facts
                };

                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                downloadAnchor.setAttribute("download", `aashu_memories_export_${Date.now()}.json`);
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();

                speakFeedback("Your memories have been exported successfully as a JSON file.");
            } catch (err) {
                console.error("[VoiceCommands] Export error:", err);
                speakFeedback("Failed to export memories.");
            }
        },

        executeSummarizeMemories: async function () {
            try {
                speakFeedback("Summarizing what I know about you...");
                const res = await fetch(`${API_BASE}/api/facts/summary`, { headers: getAuthHeaders() });
                const data = await res.json();
                const summaryText = data.summary || "No memories available to summarize.";

                // Inject summary into chat transcript if multi-turn UI exists, or single card
                if (window.appendChatMessage) {
                    window.appendChatMessage('user', 'Summarize what you know about me');
                    window.appendChatMessage('assistant', summaryText);
                } else {
                    const responseCard = document.getElementById('response-card');
                    const responseText = document.getElementById('response-text');
                    if (responseCard) responseCard.style.display = 'block';
                    if (responseText) responseText.innerHTML = summaryText;
                }

                speakFeedback(summaryText.replace(/[#*`•]/g, ''));
            } catch (err) {
                console.error("[VoiceCommands] Summarize error:", err);
                speakFeedback("Failed to summarize memories.");
            }
        },

        executeLockScreen: function () {
            const lockOverlay = document.getElementById('lock-screen-overlay');
            if (lockOverlay) {
                lockOverlay.style.display = 'flex';
                speakFeedback("App vault locked.");
            }
        },

        executeCopyLastResponse: function () {
            const assistantBubbles = document.querySelectorAll('.chat-bubble.assistant');
            if (assistantBubbles.length > 0) {
                const lastText = assistantBubbles[assistantBubbles.length - 1].innerText;
                navigator.clipboard.writeText(lastText).then(() => {
                    speakFeedback("Last response copied to clipboard.");
                });
            } else {
                speakFeedback("No AI response available to copy.");
            }
        }
    };
})();

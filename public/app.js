document.addEventListener('DOMContentLoaded', () => {
    // Dynamic API Base URL fallback if opened via file:// protocol directly
    const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

    function getAuthHeaders() {
        const pwd = sessionStorage.getItem('aashu_session_password') || '';
        return pwd ? { 'x-app-password': pwd } : {};
    }

    // Check Onboarding
    const isOnboarded = localStorage.getItem('aashu_user_onboarded');
    const userName = localStorage.getItem('aashu_user_name');
    const urlParamsCheck = new URLSearchParams(window.location.search);
    
    // Reset parameter check
    if (urlParamsCheck.has('reset')) {
        fetch(`${API_BASE}/api/reset-data`, { method: 'POST', headers: { ...getAuthHeaders() } }).finally(() => {
            localStorage.clear();
            window.location.href = 'onboarding.html';
        });
        return;
    }

    if (!isOnboarded && !urlParamsCheck.has('skip_onboarding')) {
        window.location.href = 'onboarding.html';
        return;
    }

    // Check App Lock Security Password
    async function checkAppLock() {
        try {
            const res = await fetch(`${API_BASE}/api/has-password`);
            const data = await res.json();
            if (data && data.has_password) {
                const overlay = document.getElementById('lock-screen-overlay');
                const lockInput = document.getElementById('lock-password-input');
                const unlockBtn = document.getElementById('unlock-btn');
                const errorMsg = document.getElementById('lock-error-msg');

                if (overlay) overlay.style.display = 'flex';
                if (lockInput) lockInput.focus();

                async function attemptUnlock() {
                    const pwd = lockInput.value.trim();
                    if (!pwd) return;

                    try {
                        const verifyRes = await fetch(`${API_BASE}/api/verify-password`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ password: pwd })
                        });
                        const verifyData = await verifyRes.json();
                        if (verifyData && verifyData.success) {
                            sessionStorage.setItem('aashu_session_password', pwd);
                            if (overlay) overlay.style.display = 'none';
                            loadFacts();
                            checkStatus();
                        } else {
                            if (errorMsg) {
                                errorMsg.style.display = 'block';
                                errorMsg.textContent = '❌ Incorrect password. Access denied.';
                            }
                            if (lockInput) {
                                lockInput.value = '';
                                lockInput.focus();
                            }
                        }
                    } catch (e) {
                        console.error("Unlock error:", e);
                    }
                }

                if (unlockBtn) unlockBtn.addEventListener('click', attemptUnlock);
                if (lockInput) {
                    lockInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') attemptUnlock();
                    });
                }
            }
        } catch (err) {
            console.warn("Failed to check app password status:", err);
        }
    }

    checkAppLock();

    // State Variables
    let currentMode = 'ask'; // 'ask' or 'remember'
    let isVoiceOutputEnabled = true;
    let isRecording = false;
    let recognition = null;
    let allFacts = [];
    let animationId = null;

    // Wake Word State
    let isWakeWordEnabled = true;
    let customWakeWord = (localStorage.getItem('aashu_wake_word') || 'hey aashu').toLowerCase();
    let isWakeAwake = false;

    // DOM Elements
    const micBtn    = document.getElementById('mic-btn');      // hero mic (welcome state)
    const micBtnInline = document.getElementById('mic-btn-2'); // inline mic in bar
    const micIcon   = document.getElementById('mic-icon');
    const micIcon2  = document.getElementById('mic-icon-2');
    const micStatusLabel = document.getElementById('mic-status-label');
    const transcriptBox  = document.getElementById('transcript-box');
    const canvas    = document.getElementById('audio-wave-canvas');
    const ctx       = canvas.getContext('2d');

    const toggleWakewordBtn = document.getElementById('toggle-wakeword-btn');
    const resetAppBtn       = document.getElementById('reset-app-btn');
    const wakewordStatusPill = document.getElementById('wakeword-status-pill');
    const wakewordLabel = document.getElementById('wakeword-label');
    const wakewordBtnIcon = document.getElementById('wakeword-btn-icon');
    const wakewordPillIcon = document.getElementById('wakeword-pill-icon');

    if (resetAppBtn) {
        resetAppBtn.addEventListener('click', async () => {
            if (confirm("Reset all user preferences, memory database, and security password? This will restart the full onboarding experience.")) {
                try {
                    await fetch(`${API_BASE}/api/reset-data`, { method: 'POST' });
                } catch(e) {}
                localStorage.clear();
                window.location.href = 'onboarding.html';
            }
        });
    }

    const manualTextInput  = document.getElementById('manual-text-input');
    const sendBtn          = document.getElementById('send-btn');
    const transcriptPlaceholder = document.getElementById('transcript-placeholder');
    const transcriptText   = document.getElementById('transcript-text');
    const interimText      = document.getElementById('interim-text');

    const modeAskBtn      = document.getElementById('mode-ask-btn');
    const modeRememberBtn = document.getElementById('mode-remember-btn');

    const responseCard    = document.getElementById('response-card');
    const responseHeading = document.getElementById('response-heading');
    const responseBodyText = document.getElementById('response-body-text');
    const speakResponseBtn = document.getElementById('speak-response-btn');
    const contextFactsContainer = document.getElementById('context-facts-container');
    const contextFactsGrid      = document.getElementById('context-facts-grid');
    const welcomeState    = document.getElementById('welcome-state');

    const memoryList       = document.getElementById('memory-list');
    const memorySearchInput = document.getElementById('memory-search-input');
    const factsCountBadge  = document.getElementById('facts-count-badge');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const sidebar          = document.getElementById('sidebar');
    const toggleVoiceBtn   = document.getElementById('toggle-voice-btn');
    const voiceIcon        = document.getElementById('voice-icon');

    const groqModelName    = document.getElementById('groq-model-name');
    const systemStatusText = document.getElementById('status-text');

    const welcomeUserTitle = document.getElementById('welcome-user-title');
    const welcomeWakeHint  = document.getElementById('welcome-wake-hint');
    if (welcomeUserTitle) {
        welcomeUserTitle.textContent = userName ? `Welcome back, ${userName}!` : 'Welcome to Aashu AI';
    }
    if (welcomeWakeHint) {
        welcomeWakeHint.textContent = `"${customWakeWord}"`;
    }

    // Auto-grow textarea
    manualTextInput.addEventListener('input', () => {
        manualTextInput.style.height = 'auto';
        manualTextInput.style.height = Math.min(manualTextInput.scrollHeight, 130) + 'px';
    });


    // Initialize Canvas Dimensions
    function resizeCanvas() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // --- Audio Wave Visualizer Animation (Multi-Layer Gradient & Particle Wave) ---
    let waveStep = 0;
    const particles = Array.from({ length: 18 }, () => ({
        x: Math.random() * (canvas.width || 400),
        speed: 1 + Math.random() * 2,
        radius: 1.5 + Math.random() * 2,
        alpha: 0.2 + Math.random() * 0.8
    }));

    function drawWave() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const isAISpeaking = window.speechSynthesis && window.speechSynthesis.speaking;
        if (!isRecording && !isAISpeaking) {
            waveStep = 0;
            animationId = null;
            return;
        }

        const height = canvas.height;
        const width = canvas.width;
        const centerY = height / 2;

        // Wave settings based on state
        const isRec = isRecording;
        const baseAmp = isRec ? 30 : 20;
        const speed = isRec ? 0.18 : 0.12;

        // --- Layer 1: Background Pink Glow Wave ---
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isRec ? 'rgba(247, 37, 133, 0.4)' : 'rgba(157, 78, 221, 0.4)';
        for (let x = 0; x <= width; x += 6) {
            const envelope = Math.sin((x / width) * Math.PI);
            const y = centerY + Math.sin(x * 0.025 - waveStep * 1.2) * (baseAmp * 0.8) * envelope;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // --- Layer 2: Middle Purple Glow Wave ---
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isRec ? 'rgba(114, 9, 183, 0.65)' : 'rgba(79, 172, 254, 0.65)';
        for (let x = 0; x <= width; x += 5) {
            const envelope = Math.sin((x / width) * Math.PI);
            const y = centerY + Math.cos(x * 0.03 + waveStep * 1.5) * (baseAmp * 1.1) * envelope;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // --- Layer 3: Foreground Neon Main Gradient Wave ---
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.shadowBlur = 18;
        ctx.shadowColor = isRec ? '#f72585' : '#00f2fe';

        const grad = ctx.createLinearGradient(0, 0, width, 0);
        if (isRec) {
            grad.addColorStop(0, '#7209b7');
            grad.addColorStop(0.5, '#f72585');
            grad.addColorStop(1, '#ff4757');
        } else {
            grad.addColorStop(0, '#00f2fe');
            grad.addColorStop(0.5, '#4facfe');
            grad.addColorStop(1, '#9d4edd');
        }
        ctx.strokeStyle = grad;

        for (let x = 0; x <= width; x += 4) {
            const envelope = Math.sin((x / width) * Math.PI);
            const y = centerY + Math.sin(x * 0.035 + waveStep * 2) * baseAmp * envelope;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // --- Layer 4: Floating Audio Particles ---
        ctx.save();
        particles.forEach(p => {
            p.x += p.speed;
            if (p.x > width) p.x = 0;

            const envelope = Math.sin((p.x / width) * Math.PI);
            const py = centerY + Math.sin(p.x * 0.035 + waveStep * 2) * baseAmp * envelope;

            ctx.beginPath();
            ctx.arc(p.x, py, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = isRec ? `rgba(247, 37, 133, ${p.alpha})` : `rgba(0, 242, 254, ${p.alpha})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = isRec ? '#f72585' : '#00f2fe';
            ctx.fill();
        });
        ctx.restore();

        waveStep += speed;
        animationId = requestAnimationFrame(drawWave);
    }

    function startWaveAnimation() {
        if (!animationId) {
            drawWave();
        }
    }

    // --- Web Speech Recognition Setup with Smart Silence Auto-Submit ---
    let silenceTimer = null;
    const SILENCE_THRESHOLD_MS = 1700; // 1.7 seconds gap auto-submits

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'hi-IN';

        recognition.onstart = () => {
            isRecording = true;
            // Both mic buttons go red
            micBtn.classList.add('recording');
            micBtnInline.classList.add('recording');
            micIcon.className = 'fa-solid fa-stop';
            micIcon2.className = 'fa-solid fa-stop';
            // Show transcript strip, show status
            transcriptBox.style.display = 'flex';
            micStatusLabel.style.display = 'block';
            micStatusLabel.innerHTML = `<span style="color:var(--accent-pink);"><i class="fa-solid fa-circle"></i> Listening... pause to auto-send.</span>`;
            startWaveAnimation();
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
                else interimTranscript += event.results[i][0].transcript;
            }

            let rawSpeech = (finalTranscript + ' ' + interimTranscript).trim();

            // Wake Word Detection ("Hey Aashu", "Aashu", "Ok Aashu", or custom phrase)
            if (isWakeWordEnabled && !isWakeAwake) {
                const lowerText = rawSpeech.toLowerCase();
                const wakeKeywords = [customWakeWord, 'hey aashu', 'aashu', 'ok aashu', 'hello aashu', 'hey ashu'];
                const matchedKeyword = wakeKeywords.find(kw => lowerText.includes(kw));

                if (matchedKeyword) {
                    isWakeAwake = true;
                    if (wakewordStatusPill) wakewordStatusPill.classList.add('listening-active');
                    micStatusLabel.style.display = 'block';
                    micStatusLabel.innerHTML = `<span style="color:var(--accent-pink); font-weight: 600;"><i class="fa-solid fa-bolt"></i> Woke Up! Listening to your prompt...</span>`;

                    // Remove wake phrase from text buffer
                    const regex = new RegExp(matchedKeyword, 'gi');
                    rawSpeech = rawSpeech.replace(regex, '').trim();
                    transcriptText.textContent = '';
                }
            }

            if (finalTranscript) transcriptText.textContent += ' ' + finalTranscript;
            interimText.textContent = interimTranscript;
            manualTextInput.value = (transcriptText.textContent + ' ' + interimTranscript).trim();
            // Auto-grow textarea
            manualTextInput.style.height = 'auto';
            manualTextInput.style.height = Math.min(manualTextInput.scrollHeight, 130) + 'px';

            // Smart silence auto-submit
            if (silenceTimer) clearTimeout(silenceTimer);
            if (isRecording && manualTextInput.value.trim().length > 0) {
                silenceTimer = setTimeout(() => {
                    if (isRecording && manualTextInput.value.trim().length > 0) {
                        micStatusLabel.innerHTML = `<span style="color:var(--accent-cyan);"><i class="fa-solid fa-paper-plane"></i> Auto-submitting prompt...</span>`;
                        recognition.stop();
                        stopRecording();
                        submitRequest();
                    }
                }, SILENCE_THRESHOLD_MS);
            }
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            stopRecording();
            micStatusLabel.innerHTML = `<span style="color:var(--accent-pink);">Mic error: ${event.error}. Tap mic to retry.</span>`;
            micStatusLabel.style.display = 'block';
        };

        recognition.onend = () => { if (!silenceTimer) stopRecording(); };

    } else {
        micStatusLabel.textContent = 'Speech not supported. Use Chrome or Edge.';
        micStatusLabel.style.display = 'block';
        if (micBtn) { micBtn.disabled = true; micBtn.style.opacity = '0.4'; }
        if (micBtnInline) { micBtnInline.disabled = true; micBtnInline.style.opacity = '0.4'; }
    }

    function toggleRecording() {
        if (!recognition) return;
        if (isRecording) {
            recognition.stop();
            stopRecording();
        } else {
            if (silenceTimer) clearTimeout(silenceTimer);
            transcriptText.textContent = '';
            interimText.textContent = '';
            manualTextInput.value = '';
            manualTextInput.style.height = 'auto';
            recognition.start();
        }
    }

    function stopRecording() {
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        isRecording = false;
        isWakeAwake = false;
        if (wakewordStatusPill) wakewordStatusPill.classList.remove('listening-active');
        micBtn.classList.remove('recording');
        micBtnInline.classList.remove('recording');
        micIcon.className = 'fa-solid fa-microphone';
        micIcon2.className = 'fa-solid fa-microphone';
        transcriptBox.style.display = 'none';
        micStatusLabel.style.display = 'none';
    }

    if (micBtn) micBtn.addEventListener('click', toggleRecording);
    if (micBtnInline) micBtnInline.addEventListener('click', toggleRecording);

    // Wake Word Toggle & Customization Handlers
    function updateWakeWordUI() {
        if (isWakeWordEnabled) {
            if (wakewordLabel) wakewordLabel.textContent = `Wake: "${customWakeWord}"`;
            if (toggleWakewordBtn) toggleWakewordBtn.classList.add('active-wake');
            if (wakewordBtnIcon) wakewordBtnIcon.style.color = 'var(--accent-pink)';
            if (wakewordPillIcon) wakewordPillIcon.style.color = 'var(--accent-pink)';
        } else {
            if (wakewordLabel) wakewordLabel.textContent = `Wake: Off`;
            if (toggleWakewordBtn) toggleWakewordBtn.classList.remove('active-wake');
            if (wakewordBtnIcon) wakewordBtnIcon.style.color = 'var(--text-muted)';
            if (wakewordPillIcon) wakewordPillIcon.style.color = 'var(--text-muted)';
        }
    }
    updateWakeWordUI();

    if (toggleWakewordBtn) {
        toggleWakewordBtn.addEventListener('click', () => {
            isWakeWordEnabled = !isWakeWordEnabled;
            updateWakeWordUI();
        });
    }

    // Custom Wake Word Modal Wiring
    const wakewordModal = document.getElementById('wakeword-modal');
    const modalWakewordInput = document.getElementById('modal-wakeword-input');
    const saveWakewordBtn = document.getElementById('save-wakeword-btn');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');

    function openWakeWordModal() {
        if (!wakewordModal) return;
        if (modalWakewordInput) modalWakewordInput.value = customWakeWord;
        wakewordModal.style.display = 'flex';
        if (modalWakewordInput) {
            modalWakewordInput.focus();
            modalWakewordInput.select();
        }
    }

    function closeWakeWordModal() {
        if (!wakewordModal) return;
        wakewordModal.style.display = 'none';
    }

    if (wakewordStatusPill) {
        wakewordStatusPill.addEventListener('click', openWakeWordModal);
    }

    if (saveWakewordBtn) {
        saveWakewordBtn.addEventListener('click', () => {
            const val = modalWakewordInput ? modalWakewordInput.value.trim() : '';
            if (val.length > 0) {
                customWakeWord = val.toLowerCase();
                localStorage.setItem('aashu_wake_word', customWakeWord);
                isWakeWordEnabled = true;
                updateWakeWordUI();
            }
            closeWakeWordModal();
        });
    }

    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeWakeWordModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeWakeWordModal);

    // Preset Chips
    document.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (modalWakewordInput) modalWakewordInput.value = chip.dataset.phrase;
        });
    });

    if (modalWakewordInput) {
        modalWakewordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (saveWakewordBtn) saveWakewordBtn.click();
            }
        });
    }

    // Spacebar shortcut
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement !== manualTextInput && document.activeElement !== memorySearchInput) {
            e.preventDefault();
            toggleRecording();
        }
    });

    // Language Mode Toggle State ('auto', 'hi-IN', 'en-US')
    let currentLangMode = localStorage.getItem('aashu_lang_mode') || 'auto';
    const langPill = document.getElementById('lang-pill');
    const langLabel = document.getElementById('lang-label');

    function updateLangUI() {
        if (!langLabel) return;
        if (currentLangMode === 'auto') {
            langLabel.textContent = 'Auto (HI / EN)';
        } else if (currentLangMode === 'hi-IN') {
            langLabel.textContent = 'Hindi (हिंदी)';
        } else {
            langLabel.textContent = 'English (US)';
        }
        if (recognition) {
            recognition.lang = (currentLangMode === 'en-US') ? 'en-US' : 'hi-IN';
        }
    }
    updateLangUI();

    if (langPill) {
        langPill.addEventListener('click', () => {
            if (currentLangMode === 'auto') currentLangMode = 'hi-IN';
            else if (currentLangMode === 'hi-IN') currentLangMode = 'en-US';
            else currentLangMode = 'auto';
            localStorage.setItem('aashu_lang_mode', currentLangMode);
            updateLangUI();
        });
    }

    // --- Dual Language Text-to-Speech ---
    function speakText(text) {
        if (!isVoiceOutputEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();

        // Clean markdown formatting symbols
        const cleanText = text.replace(/[*#`_~]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);

        // Check for Devanagari Hindi characters
        const containsHindiScript = /[\u0900-\u097F]/.test(cleanText);
        const isHindiMode = (currentLangMode === 'hi-IN') || (currentLangMode === 'auto' && containsHindiScript);

        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            if (isHindiMode) {
                const hiVoice = voices.find(v => v.lang.toLowerCase().includes('hi') || v.name.toLowerCase().includes('hindi'));
                if (hiVoice) utterance.voice = hiVoice;
                utterance.lang = 'hi-IN';
            } else {
                const enVoice = voices.find(v => v.lang.toLowerCase().includes('en-in') || v.lang.toLowerCase().includes('en-us') || v.name.toLowerCase().includes('english'));
                if (enVoice) utterance.voice = enVoice;
                utterance.lang = 'en-US';
            }
        } else {
            utterance.lang = isHindiMode ? 'hi-IN' : 'en-US';
        }

        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onstart = () => startWaveAnimation();
        window.speechSynthesis.speak(utterance);
    }

    toggleVoiceBtn.addEventListener('click', () => {
        isVoiceOutputEnabled = !isVoiceOutputEnabled;
        if (isVoiceOutputEnabled) {
            voiceIcon.className = 'fa-solid fa-volume-high';
            toggleVoiceBtn.style.color = 'var(--accent-cyan)';
        } else {
            voiceIcon.className = 'fa-solid fa-volume-xmark';
            toggleVoiceBtn.style.color = 'var(--text-muted)';
            window.speechSynthesis.cancel();
        }
    });

    speakResponseBtn.addEventListener('click', () => speakText(responseBodyText.textContent));

    // --- Mode Pills ---
    modeAskBtn.addEventListener('click', () => setMode('ask'));
    modeRememberBtn.addEventListener('click', () => setMode('remember'));

    function setMode(mode) {
        currentMode = mode;
        if (mode === 'ask') {
            modeAskBtn.classList.add('active');
            modeRememberBtn.classList.remove('active');
            manualTextInput.placeholder = "Ask anything based on your stored memory...";
        } else {
            modeRememberBtn.classList.add('active');
            modeAskBtn.classList.remove('active');
            manualTextInput.placeholder = "Tell me a fact to store... (e.g. 'I moved to Berlin in 2024')";
        }
    }

    // --- Sidebar Toggle ---
    toggleSidebarBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    // --- Multi-Turn Conversation Thread State ---
    let chatHistory = [];
    try {
        const storedHist = sessionStorage.getItem('aashu_chat_history');
        if (storedHist) chatHistory = JSON.parse(storedHist);
    } catch (e) { chatHistory = []; }

    const chatStreamContainer = document.getElementById('chat-stream-container');
    const chatThreadBody      = document.getElementById('chat-thread-body');
    const chatTurnBadge       = document.getElementById('chat-turn-badge');
    const clearChatBtn        = document.getElementById('clear-chat-btn');

    function updateChatHeaderUI() {
        if (chatTurnBadge) {
            chatTurnBadge.textContent = `${chatHistory.length} Turn${chatHistory.length === 1 ? '' : 's'}`;
        }
    }

    function saveChatHistory() {
        try {
            sessionStorage.setItem('aashu_chat_history', JSON.stringify(chatHistory));
        } catch (e) {}
        updateChatHeaderUI();
    }

    function scrollToBottom() {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            setTimeout(() => {
                mainContent.scrollTo({ top: mainContent.scrollHeight, behavior: 'smooth' });
            }, 50);
        }
    }

    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Markdown & Code Block Formatter ---
    function formatMarkdown(text) {
        if (!text) return '';

        // Escape initial HTML tags for security
        let formatted = escapeHTML(text);

        // Fenced Code Blocks: ```lang \n code \n ```
        formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const cleanLang = lang.trim() || 'code';
            return `
                <div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span><i class="fa-solid fa-code text-cyan"></i> ${cleanLang}</span>
                        <button class="copy-code-btn" onclick="copyCodeSnippet(this)">
                            <i class="fa-solid fa-copy"></i> <span>Copy Code</span>
                        </button>
                    </div>
                    <pre><code>${code.trim()}</code></pre>
                </div>
            `;
        });

        // Inline Formatting
        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
            .replace(/^\s*[-•]\s+(.*)$/gm, '<li class="response-li">$1</li>')
            .replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

        return formatted;
    }

    window.copyCodeSnippet = function(btn) {
        const wrapper = btn.closest('.code-block-wrapper');
        if (!wrapper) return;
        const codeText = wrapper.querySelector('pre code').textContent;
        navigator.clipboard.writeText(codeText).then(() => {
            const span = btn.querySelector('span');
            const icon = btn.querySelector('i');
            if (span) span.textContent = 'Copied!';
            if (icon) icon.className = 'fa-solid fa-check text-cyan';
            setTimeout(() => {
                if (span) span.textContent = 'Copy Code';
                if (icon) icon.className = 'fa-solid fa-copy';
            }, 2000);
        });
    };

    function renderMessageThread() {
        if (!chatThreadBody) return;
        if (chatHistory.length === 0) {
            if (chatStreamContainer) chatStreamContainer.style.display = 'none';
            if (welcomeState) welcomeState.style.display = 'flex';
            return;
        }

        if (welcomeState) welcomeState.style.display = 'none';
        if (chatStreamContainer) chatStreamContainer.style.display = 'flex';

        chatThreadBody.innerHTML = '';
        chatHistory.forEach((msg, idx) => {
            if (msg.role === 'user') {
                renderUserBubble(msg.content);
            } else if (msg.role === 'assistant') {
                renderAIBubble(msg.content, msg.retrievedFacts, msg.modelUsed, idx);
            }
        });
        updateChatHeaderUI();
        scrollToBottom();
    }

    function renderUserBubble(text) {
        const row = document.createElement('div');
        row.className = 'message-bubble-row user-bubble-row';
        row.innerHTML = `
            <div class="message-bubble user-bubble">
                <div class="bubble-header">
                    <span class="bubble-author">${userName || 'You'}</span>
                    <span class="bubble-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div class="bubble-body">${escapeHTML(text).replace(/\n/g, '<br>')}</div>
            </div>
            <div class="bubble-avatar user-avatar"><i class="fa-solid fa-user"></i></div>
        `;
        chatThreadBody.appendChild(row);
        scrollToBottom();
    }

    window.appendChatMessage = function(role, text, facts, model) {
        if (welcomeState) welcomeState.style.display = 'none';
        if (chatStreamContainer) chatStreamContainer.style.display = 'flex';
        if (role === 'user') {
            renderUserBubble(text);
        } else {
            renderAIBubble(text, facts, model);
        }
    };

    function renderAIBubble(text, retrievedFacts, modelUsed) {
        const row = document.createElement('div');
        row.className = 'message-bubble-row ai-bubble-row';
        
        let factsHTML = '';
        if (retrievedFacts && retrievedFacts.length > 0) {
            factsHTML = `
                <div class="context-facts-container">
                    <h4><i class="fa-solid fa-database text-cyan"></i> ${retrievedFacts.length} Vector Memory Facts Used:</h4>
                    <div class="context-facts-grid">
                        ${retrievedFacts.map(f => `
                            <div class="context-fact-pill">
                                <div class="context-fact-header">
                                    <span class="category-badge"><i class="fa-solid fa-tag"></i> ${f.category || 'General'}</span>
                                    ${f.score ? `<span class="score-badge">${Math.round(f.score * 100)}% Match</span>` : ''}
                                </div>
                                <div class="fact-body-text">${escapeHTML(f.fact)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        const formattedBody = formatMarkdown(text);

        row.innerHTML = `
            <div class="bubble-avatar ai-avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="message-bubble ai-bubble">
                <div class="bubble-header">
                    <span class="bubble-author"><i class="fa-solid fa-sparkles text-cyan"></i> Aashu AI ${modelUsed ? `<span style="font-weight:normal; opacity:0.75; font-size:11px;">(${modelUsed})</span>` : ''}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="icon-btn-sm speak-bubble-btn" title="Replay Speech">
                            <i class="fa-solid fa-volume-high"></i>
                        </button>
                        <span class="bubble-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </div>
                <div class="bubble-body">${formattedBody}</div>
                ${factsHTML}
            </div>
        `;
        chatThreadBody.appendChild(row);

        const speakBtn = row.querySelector('.speak-bubble-btn');
        if (speakBtn) {
            speakBtn.addEventListener('click', () => speakText(text));
        }

        scrollToBottom();
    }

    function showTypingIndicator() {
        removeTypingIndicator();
        const row = document.createElement('div');
        row.className = 'message-bubble-row ai-bubble-row typing-row';
        row.id = 'typing-indicator-row';
        row.innerHTML = `
            <div class="bubble-avatar ai-avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="message-bubble ai-bubble typing-bubble">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        chatThreadBody.appendChild(row);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const existing = document.getElementById('typing-indicator-row');
        if (existing) existing.remove();
    }

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            if (confirm('Clear current conversational chat thread?')) {
                chatHistory = [];
                sessionStorage.removeItem('aashu_chat_history');
                chatThreadBody.innerHTML = '';
                if (chatStreamContainer) chatStreamContainer.style.display = 'none';
                if (welcomeState) welcomeState.style.display = 'flex';
                updateChatHeaderUI();
            }
        });
    }

    // Render any restored session messages on load
    if (chatHistory.length > 0) {
        renderMessageThread();
    }

    // --- Three-Dots Top Menu Dropdown ---
    const topMenuBtn = document.getElementById('top-menu-btn');
    const topMenuDropdown = document.getElementById('top-menu-dropdown');
    const activeModelName = document.getElementById('active-model-name');

    if (topMenuBtn && topMenuDropdown) {
        topMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = topMenuDropdown.style.display === 'flex';
            topMenuDropdown.style.display = isOpen ? 'none' : 'flex';
            topMenuBtn.classList.toggle('active', !isOpen);
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#menu-container')) {
                topMenuDropdown.style.display = 'none';
                topMenuBtn.classList.remove('active');
            }
        });
    }

    function syncActiveModelLabel() {
        if (modelSelector && activeModelName) {
            const selectedOpt = modelSelector.options[modelSelector.selectedIndex];
            if (selectedOpt) {
                const labelText = selectedOpt.textContent.includes(':') 
                    ? selectedOpt.textContent.split(':')[1].trim() 
                    : selectedOpt.textContent;
                activeModelName.textContent = labelText;
            }
        }
    }

    // --- Model Selector ---
    const modelSelector = document.getElementById('model-selector');
    const savedModel = localStorage.getItem('aashu_selected_model');
    if (savedModel && modelSelector) modelSelector.value = savedModel;
    if (modelSelector) {
        syncActiveModelLabel();
        modelSelector.addEventListener('change', (e) => {
            localStorage.setItem('aashu_selected_model', e.target.value);
            syncActiveModelLabel();
        });
    }

    // --- API Send ---
    sendBtn.addEventListener('click', submitRequest);
    manualTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitRequest(); }
    });

    async function submitRequest() {
        const text = manualTextInput.value.trim();
        if (!text) return;

        const selectedModel = modelSelector ? modelSelector.value : null;
        if (isRecording) { recognition.stop(); stopRecording(); }

        // Switch from Welcome state to Chat Stream
        welcomeState.style.display = 'none';
        chatStreamContainer.style.display = 'flex';

        // Check for Smart Voice Commands & Quick Intent Triggers
        if (window.VoiceCommands && await window.VoiceCommands.processCommand(text)) {
            manualTextInput.value = '';
            manualTextInput.style.height = 'auto';
            return;
        }

        manualTextInput.value = '';
        manualTextInput.style.height = 'auto';

        if (currentMode === 'remember') {
            renderUserBubble(`[Remember Fact] ${text}`);
            showTypingIndicator();
            try {
                const res = await fetch(`${API_BASE}/api/remember`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ text, model: selectedModel })
                });
                const data = await res.json();
                removeTypingIndicator();

                let responseMsg = '';
                if (data.status === 'success') {
                    responseMsg = `Stored ${data.saved_count} Fact(s) Successfully into vector memory!\n\n` +
                        data.facts_extracted.map(f => `• **${f.fact}** *(Category: ${f.category || 'General'})*`).join('\n');
                    speakText(`Stored ${data.saved_count} memory facts.`);
                    loadFacts();
                } else {
                    responseMsg = `Failed to store fact: ${data.message}`;
                }
                renderAIBubble(responseMsg, [], selectedModel);
            } catch (err) {
                removeTypingIndicator();
                renderAIBubble(`Server Error: ${err.message}`, [], selectedModel);
            }
        } else {
            // Ask Mode — Multi-turn conversation
            renderUserBubble(text);
            showTypingIndicator();

            // Prepare history payload (excluding current prompt)
            const historyPayload = chatHistory.map(m => ({ role: m.role, content: m.content }));

            // Store user turn in local history
            chatHistory.push({ role: 'user', content: text });
            saveChatHistory();

            try {
                const res = await fetch(`${API_BASE}/api/ask`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ question: text, model: selectedModel, history: historyPayload })
                });
                const data = await res.json();
                removeTypingIndicator();

                const answerText = data.answer || 'No response generated.';
                renderAIBubble(answerText, data.retrieved_facts, data.model_used);

                // Store AI turn in local history
                chatHistory.push({
                    role: 'assistant',
                    content: answerText,
                    retrievedFacts: data.retrieved_facts,
                    modelUsed: data.model_used
                });
                saveChatHistory();

                speakText(answerText);
            } catch (err) {
                removeTypingIndicator();
                renderAIBubble(`Server Error: ${err.message}`, [], selectedModel);
            }
        }
    }

    // --- Category Filters State & Handlers ---
    let activeCategoryFilter = 'all';
    const categoryFilterBtns = document.querySelectorAll('.cat-filter-btn');

    categoryFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryFilterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCategoryFilter = btn.dataset.category;
            applyMemoryFilters();
        });
    });

    function applyMemoryFilters() {
        const query = memorySearchInput ? memorySearchInput.value.toLowerCase().trim() : '';
        let filtered = allFacts;

        if (activeCategoryFilter === 'pinned') {
            filtered = filtered.filter(f => f.is_pinned === true);
        } else if (activeCategoryFilter !== 'all') {
            filtered = filtered.filter(f => f.category && f.category.toLowerCase() === activeCategoryFilter.toLowerCase());
        }

        if (query) {
            filtered = filtered.filter(f => 
                f.fact.toLowerCase().includes(query) || 
                (f.category && f.category.toLowerCase().includes(query))
            );
        }

        renderFactsList(filtered);
    }

    // --- Load Memory Facts Sidebar ---
    async function loadFacts() {
        try {
            const res = await fetch(`${API_BASE}/api/facts`, { headers: { ...getAuthHeaders() } });
            const data = await res.json();
            allFacts = data.facts || [];
            factsCountBadge.textContent = `${allFacts.length} Facts`;
            applyMemoryFilters();
        } catch (err) {
            memoryList.innerHTML = `<div style="color: var(--accent-pink); font-size: 12px;">Failed to load facts</div>`;
        }
    }

    function renderFactsList(facts) {
        if (!memoryList) return;
        if (facts.length === 0) {
            memoryList.innerHTML = `
                <div class="empty-memory-state">
                    <i class="fa-solid fa-box-archive"></i>
                    <p>No stored memory facts found.</p>
                    <span>Try changing category filter or store new memories.</span>
                </div>
            `;
            return;
        }

        memoryList.innerHTML = facts.map(f => {
            const hasValidDate = f.date && f.date !== 'N/A' && f.date.trim() !== '';
            const categoryLabel = f.category || 'General';
            const isPinned = f.is_pinned === true;

            return `
                <div class="fact-card ${isPinned ? 'pinned' : ''}" data-id="${f.id}">
                    <div class="fact-actions">
                        <button class="fact-action-btn pin-btn ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unstar Fact' : 'Star & Pin Fact'}" onclick="togglePinFact(${f.id})">
                            <i class="fa-solid fa-star"></i>
                        </button>
                        <button class="fact-action-btn edit-btn" title="Edit Fact" onclick="openEditFactModal(${f.id})">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="fact-action-btn delete-btn" title="Delete Fact" onclick="deleteFact(${f.id})">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                    <div class="fact-meta">
                        <span class="fact-category"><i class="fa-solid fa-tag"></i> ${categoryLabel}</span>
                        ${isPinned ? '<span class="fact-category text-gold"><i class="fa-solid fa-star"></i> Starred</span>' : ''}
                        ${hasValidDate ? `<span class="fact-date">${f.date}</span>` : ''}
                    </div>
                    <div class="fact-text">${f.fact}</div>
                </div>
            `;
        }).join('');
    }

    // --- Edit Fact Modal Handling ---
    const editFactModal     = document.getElementById('edit-fact-modal');
    const editFactIdInput   = document.getElementById('edit-fact-id');
    const editFactTextInput = document.getElementById('edit-fact-text');
    const editFactCatInput  = document.getElementById('edit-fact-category');
    const editFactDateInput = document.getElementById('edit-fact-date');
    const editFactPinnedChk = document.getElementById('edit-fact-pinned');
    const closeEditFactBtn  = document.getElementById('close-edit-fact-btn');
    const cancelEditFactBtn = document.getElementById('cancel-edit-fact-btn');
    const saveEditFactBtn   = document.getElementById('save-edit-fact-btn');

    window.openEditFactModal = function(id) {
        const factObj = allFacts.find(f => f.id === id);
        if (!factObj) return;

        editFactIdInput.value = factObj.id;
        editFactTextInput.value = factObj.fact;
        editFactCatInput.value = factObj.category || 'General';
        editFactDateInput.value = factObj.date || 'N/A';
        editFactPinnedChk.checked = factObj.is_pinned === true;

        if (editFactModal) editFactModal.style.display = 'flex';
    };

    function closeEditModal() {
        if (editFactModal) editFactModal.style.display = 'none';
    }

    if (closeEditFactBtn) closeEditFactBtn.addEventListener('click', closeEditModal);
    if (cancelEditFactBtn) cancelEditFactBtn.addEventListener('click', closeEditModal);

    if (saveEditFactBtn) {
        saveEditFactBtn.addEventListener('click', async () => {
            const id = editFactIdInput.value;
            const updatedFact = editFactTextInput.value.trim();
            const category = editFactCatInput.value.trim() || 'General';
            const date = editFactDateInput.value.trim() || 'N/A';
            const is_pinned = editFactPinnedChk.checked;

            if (!updatedFact) {
                alert('Fact text cannot be empty');
                return;
            }

            try {
                saveEditFactBtn.disabled = true;
                saveEditFactBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

                const res = await fetch(`${API_BASE}/api/facts/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ fact: updatedFact, category, date, is_pinned })
                });

                if (!res.ok) throw new Error('Failed to update fact');

                closeEditModal();
                await loadFacts();
            } catch (err) {
                alert('Error updating memory fact: ' + err.message);
            } finally {
                saveEditFactBtn.disabled = false;
                saveEditFactBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Changes`;
            }
        });
    }

    window.togglePinFact = async function(id) {
        try {
            await fetch(`${API_BASE}/api/facts/${id}/pin`, {
                method: 'PATCH',
                headers: { ...getAuthHeaders() }
            });
            await loadFacts();
        } catch (err) {
            console.error('Failed to toggle pin state:', err);
        }
    };

    window.deleteFact = async function(id) {
        if (!confirm('Delete this memory fact from local vector store?')) return;
        try {
            await fetch(`${API_BASE}/api/facts/${id}`, { method: 'DELETE', headers: { ...getAuthHeaders() } });
            await loadFacts();
        } catch (err) {
            alert('Failed to delete fact');
        }
    };

    memorySearchInput.addEventListener('input', () => {
        applyMemoryFilters();
    });

    // --- System Status Check ---
    const installAppBtn = document.getElementById('install-app-btn');
    const offlineBanner = document.getElementById('offline-banner');
    const statusDot = document.getElementById('status-dot');

    async function checkStatus() {
        try {
            const res = await fetch(`${API_BASE}/api/status`);
            const data = await res.json();
            systemStatusText.textContent = `Backend: ${data.status}`;
            if (statusDot) statusDot.className = 'dot green';
            if (groqModelName) groqModelName.textContent = data.llm_model;
            if (offlineBanner) offlineBanner.style.display = 'none';
        } catch (e) {
            systemStatusText.textContent = 'Backend: Disconnected';
            if (statusDot) statusDot.className = 'dot red';
            if (offlineBanner) offlineBanner.style.display = 'flex';
        }
    }

    // --- PWA Installation & Service Worker ---
    let deferredPrompt = null;

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('[App] Service Worker registered with scope:', reg.scope))
                .catch(err => console.warn('[App] Service Worker registration skipped:', err));
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installAppBtn) installAppBtn.style.display = 'flex';
    });

    if (installAppBtn) {
        installAppBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`[App] PWA install choice: ${outcome}`);
            deferredPrompt = null;
            installAppBtn.style.display = 'none';
        });
    }

    window.addEventListener('appinstalled', () => {
        console.log('[App] Voice Memory PWA was installed successfully!');
        if (installAppBtn) installAppBtn.style.display = 'none';
    });

    // Network Online/Offline Event Listeners
    function updateNetworkStatus() {
        if (!navigator.onLine) {
            if (offlineBanner) offlineBanner.style.display = 'flex';
            if (systemStatusText) systemStatusText.textContent = 'Backend: Offline';
            if (statusDot) statusDot.className = 'dot red';
        } else {
            if (offlineBanner) offlineBanner.style.display = 'none';
            checkStatus();
        }
    }

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Keyboard Shortcuts (Ctrl+/ for Search, Esc for Sidebar)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
            }
            memorySearchInput.focus();
        } else if (e.key === 'Escape') {
            if (!sidebar.classList.contains('collapsed')) {
                sidebar.classList.add('collapsed');
            }
        }
    });

    // URL Shortcut Parameters (?mode=ask or ?mode=remember)
    const urlParams = new URLSearchParams(window.location.search);
    const initialMode = urlParams.get('mode');
    if (initialMode === 'ask' || initialMode === 'remember') {
        setMode(initialMode);
    }

    // Initial Calls
    loadFacts();
    checkStatus();
    setInterval(checkStatus, 10000);
});


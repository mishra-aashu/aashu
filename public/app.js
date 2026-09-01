document.addEventListener('DOMContentLoaded', () => {
    // Dynamic API Base URL fallback if opened via file:// protocol directly
    const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

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
    const wakewordStatusPill = document.getElementById('wakeword-status-pill');
    const wakewordLabel = document.getElementById('wakeword-label');
    const wakewordBtnIcon = document.getElementById('wakeword-btn-icon');
    const wakewordPillIcon = document.getElementById('wakeword-pill-icon');

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
        recognition.lang = 'en-US';

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

    if (wakewordStatusPill) {
        wakewordStatusPill.addEventListener('click', () => {
            const input = prompt("Enter your custom Wake Word phrase (e.g. 'Hey Aashu' or 'Aashu'):", customWakeWord);
            if (input && input.trim().length > 0) {
                customWakeWord = input.trim().toLowerCase();
                localStorage.setItem('aashu_wake_word', customWakeWord);
                isWakeWordEnabled = true;
                updateWakeWordUI();
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

    // --- Text-to-Speech ---
    function speakText(text) {
        if (!isVoiceOutputEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
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

    // --- Markdown formatter ---
    function formatMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
            .replace(/^\s*[-•]\s+(.*)$/gm, '<li class="response-li">$1</li>')
            .replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    }

    // --- Model Selector ---
    const modelSelector = document.getElementById('model-selector');
    const savedModel = localStorage.getItem('aashu_selected_model');
    if (savedModel && modelSelector) modelSelector.value = savedModel;
    if (modelSelector) modelSelector.addEventListener('change', (e) => localStorage.setItem('aashu_selected_model', e.target.value));

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

        // Show response card, hide welcome
        welcomeState.style.display = 'none';
        responseCard.style.display = 'block';
        responseHeading.textContent = currentMode === 'ask' ? 'AI Answer' : 'Storing Memory...';
        responseBodyText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${currentMode === 'ask' ? 'Searching vector DB & generating response...' : 'Extracting facts & embedding vector...'}`;
        contextFactsContainer.style.display = 'none';
        manualTextInput.value = '';
        manualTextInput.style.height = 'auto';

        try {
            if (currentMode === 'remember') {
                const res = await fetch(`${API_BASE}/api/remember`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, model: selectedModel })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    responseBodyText.innerHTML = `<i class="fa-solid fa-circle-check text-cyan"></i> <strong>Stored ${data.saved_count} Fact(s) Successfully!</strong><br><br>` +
                        data.facts_extracted.map(f => `• <strong>${f.fact}</strong> <em>(${f.category || 'General'})</em>`).join('<br>');
                    speakText(`Stored ${data.saved_count} memory facts.`);
                    loadFacts();
                } else {
                    responseBodyText.textContent = `Error: ${data.message}`;
                }
            } else {
                // Ask Mode
                const res = await fetch(`${API_BASE}/api/ask`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: text, model: selectedModel })
                });
                const data = await res.json();

                responseBodyText.innerHTML = formatMarkdown(data.answer);
                speakText(data.answer);
                if (contextFactsContainer) contextFactsContainer.style.display = 'none';
            }
        } catch (err) {
            responseBodyText.textContent = `Server Error: ${err.message}`;
        }
    }

    // --- Load Memory Facts Sidebar ---
    async function loadFacts() {
        try {
            const res = await fetch(`${API_BASE}/api/facts`);
            const data = await res.json();
            allFacts = data.facts || [];
            factsCountBadge.textContent = `${allFacts.length} Facts`;
            renderFactsList(allFacts);
        } catch (err) {
            memoryList.innerHTML = `<div style="color: var(--accent-pink); font-size: 12px;">Failed to load facts</div>`;
        }
    }

    function renderFactsList(facts) {
        if (facts.length === 0) {
            memoryList.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; margin-top: 20px;">No stored memory facts yet.<br>Use /remember mode or speak to add some!</div>`;
            return;
        }

        memoryList.innerHTML = facts.map(f => `
            <div class="fact-card" data-id="${f.id}">
                <button class="delete-fact-btn" title="Delete Fact" onclick="deleteFact(${f.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
                <div class="fact-meta">
                    <span class="fact-category">${f.category || 'General'}</span>
                    <span class="fact-date">${f.date || ''}</span>
                </div>
                <div class="fact-text">${f.fact}</div>
            </div>
        `).join('');
    }

    window.deleteFact = async function(id) {
        if (!confirm('Delete this memory fact from local vector store?')) return;
        try {
            await fetch(`${API_BASE}/api/facts/${id}`, { method: 'DELETE' });
            loadFacts();
        } catch (err) {
            alert('Failed to delete fact');
        }
    };

    memorySearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allFacts.filter(f => f.fact.toLowerCase().includes(query) || (f.category && f.category.toLowerCase().includes(query)));
        renderFactsList(filtered);
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


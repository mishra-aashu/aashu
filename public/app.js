document.addEventListener('DOMContentLoaded', () => {
    // State Variables
    let currentMode = 'ask'; // 'ask' or 'remember'
    let isVoiceOutputEnabled = true;
    let isRecording = false;
    let recognition = null;
    let allFacts = [];
    let animationId = null;

    // DOM Elements
    const micBtn = document.getElementById('mic-btn');
    const micIcon = document.getElementById('mic-icon');
    const micStatusLabel = document.getElementById('mic-status-label');
    const canvas = document.getElementById('audio-wave-canvas');
    const ctx = canvas.getContext('2d');
    
    const manualTextInput = document.getElementById('manual-text-input');
    const sendBtn = document.getElementById('send-btn');
    const transcriptPlaceholder = document.getElementById('transcript-placeholder');
    const transcriptText = document.getElementById('transcript-text');
    const interimText = document.getElementById('interim-text');

    const modeAskBtn = document.getElementById('mode-ask-btn');
    const modeRememberBtn = document.getElementById('mode-remember-btn');

    const responseCard = document.getElementById('response-card');
    const responseHeading = document.getElementById('response-heading');
    const responseBodyText = document.getElementById('response-body-text');
    const speakResponseBtn = document.getElementById('speak-response-btn');
    const contextFactsContainer = document.getElementById('context-facts-container');
    const contextFactsGrid = document.getElementById('context-facts-grid');

    const memoryList = document.getElementById('memory-list');
    const memorySearchInput = document.getElementById('memory-search-input');
    const factsCountBadge = document.getElementById('facts-count-badge');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const sidebar = document.getElementById('sidebar');
    const toggleVoiceBtn = document.getElementById('toggle-voice-btn');
    const voiceIcon = document.getElementById('voice-icon');

    const groqModelName = document.getElementById('groq-model-name');
    const systemStatusText = document.getElementById('status-text');

    // Initialize Canvas Dimensions
    function resizeCanvas() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // --- Audio Wave Visualizer Animation ---
    let waveStep = 0;
    function drawWave() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!isRecording && !speechSynthesis.speaking) {
            waveStep = 0;
            return;
        }

        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isRecording ? '#f72585' : '#00f2fe';

        const height = canvas.height;
        const width = canvas.width;
        ctx.moveTo(0, height / 2);

        for (let x = 0; x < width; x += 5) {
            const freq = isRecording ? 0.03 : 0.02;
            const amp = isRecording ? 25 : 15;
            const y = height / 2 + Math.sin(x * freq + waveStep) * amp * Math.sin(x / width * Math.PI);
            ctx.lineTo(x, y);
        }

        ctx.stroke();
        waveStep += 0.15;
        animationId = requestAnimationFrame(drawWave);
    }

    function startWaveAnimation() {
        if (!animationId) {
            drawWave();
        }
    }

    // --- Web Speech Recognition Setup ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            micBtn.classList.add('recording');
            micIcon.className = 'fa-solid fa-stop';
            micStatusLabel.innerHTML = `<span style="color: var(--accent-pink);">🔴 Listening... Speak clearly now! Click to Stop.</span>`;
            transcriptPlaceholder.style.display = 'none';
            startWaveAnimation();
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript) {
                transcriptText.textContent += ' ' + finalTranscript;
                manualTextInput.value = (transcriptText.textContent + ' ' + interimTranscript).trim();
            }
            interimText.textContent = interimTranscript;
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            stopRecording();
            micStatusLabel.textContent = `Mic Error: ${event.error}. Click mic to retry.`;
        };

        recognition.onend = () => {
            stopRecording();
        };
    } else {
        micStatusLabel.textContent = 'Web Speech API is not supported in this browser (Use Chrome, Edge, or Safari).';
        micBtn.disabled = true;
        micBtn.style.opacity = '0.5';
    }

    function toggleRecording() {
        if (!recognition) return;
        if (isRecording) {
            recognition.stop();
            stopRecording();
        } else {
            transcriptText.textContent = '';
            interimText.textContent = '';
            manualTextInput.value = '';
            recognition.start();
        }
    }

    function stopRecording() {
        isRecording = false;
        micBtn.classList.remove('recording');
        micIcon.className = 'fa-solid fa-microphone';
        micStatusLabel.innerHTML = `Click microphone or press <kbd>Space</kbd> to speak...`;
    }

    micBtn.addEventListener('click', toggleRecording);

    // Keyboard Spacebar Shortcut for Mic
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement !== manualTextInput && document.activeElement !== memorySearchInput) {
            e.preventDefault();
            toggleRecording();
        }
    });

    // --- Text-to-Speech (Voice Output) ---
    function speakText(text) {
        if (!isVoiceOutputEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel(); // Stop any active speech

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onstart = () => startWaveAnimation();
        utterance.onend = () => {};

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

    speakResponseBtn.addEventListener('click', () => {
        speakText(responseBodyText.textContent);
    });

    // --- Mode Selection ---
    modeAskBtn.addEventListener('click', () => setMode('ask'));
    modeRememberBtn.addEventListener('click', () => setMode('remember'));

    function setMode(mode) {
        currentMode = mode;
        if (mode === 'ask') {
            modeAskBtn.classList.add('active');
            modeRememberBtn.classList.remove('active');
            manualTextInput.placeholder = "Ask anything based on your stored memory... (e.g. 'Where do I live and what are my hobbies?')";
        } else {
            modeRememberBtn.classList.add('active');
            modeAskBtn.classList.remove('active');
            manualTextInput.placeholder = "Tell me a fact to store in memory... (e.g. 'I moved to Berlin in 2024 and I love drinking espresso.')";
        }
    }

    // --- Toggle Sidebar ---
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // --- API Handlers ---
    sendBtn.addEventListener('click', submitRequest);
    manualTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitRequest();
        }
    });

    async function submitRequest() {
        const text = manualTextInput.value.trim();
        if (!text) return;

        if (isRecording) {
            recognition.stop();
            stopRecording();
        }

        responseCard.style.display = 'block';
        responseHeading.textContent = currentMode === 'ask' ? 'AI Answer' : 'Storing Memory Fact...';
        responseBodyText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${currentMode === 'ask' ? 'Searching vector DB & generating response...' : 'Extracting facts & embedding vector...'}`;
        contextFactsContainer.style.display = 'none';

        try {
            if (currentMode === 'remember') {
                const res = await fetch('/api/remember', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text })
                });
                const data = await res.json();

                if (data.status === 'success') {
                    responseBodyText.innerHTML = `✅ <strong>Stored ${data.saved_count} Memory Fact(s) Successfully!</strong><br><br>` +
                        data.facts_extracted.map(f => `• <strong>${f.fact}</strong> <em>(${f.category || 'General'})</em>`).join('<br>');
                    speakText(`Successfully stored ${data.saved_count} memory facts into your local vector database.`);
                    loadFacts(); // Refresh sidebar facts
                } else {
                    responseBodyText.textContent = `Error: ${data.message}`;
                }
            } else {
                // Ask Mode
                const res = await fetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: text })
                });
                const data = await res.json();

                responseBodyText.textContent = data.answer;
                speakText(data.answer);

                // Render retrieved context facts
                if (data.retrieved_facts && data.retrieved_facts.length > 0) {
                    contextFactsContainer.style.display = 'block';
                    contextFactsGrid.innerHTML = data.retrieved_facts.map(f => `
                        <div class="context-fact-pill">
                            <span class="score">${(f.score ? (f.score * 100).toFixed(0) + '%' : '')} match</span>
                            <strong>${f.fact}</strong>
                            <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">Category: ${f.category || 'General'}</div>
                        </div>
                    `).join('');
                }
            }
        } catch (err) {
            responseBodyText.textContent = `Server Error: ${err.message}`;
        }
    }

    // --- Load Memory Facts Sidebar ---
    async function loadFacts() {
        try {
            const res = await fetch('/api/facts');
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
            await fetch(`/api/facts/${id}`, { method: 'DELETE' });
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
            const res = await fetch('/api/status');
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

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('[App] Service Worker registered with scope:', reg.scope))
                .catch(err => console.error('[App] Service Worker registration failed:', err));
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


class PresentationNotesApp {
    constructor() {
        this.mediaRecorder = null;
        this.audioStream = null;
        this.sessionId = null;
        this.isRecording = false;
        this.startTime = null;
        this.timerInterval = null;
        this.recordingChunks = [];
        this.mimeType = null;
        this.chunkInterval = null;
        
        // Translation related properties
        this.lastTranscriptionText = 
        this.translationHistory = 
        this.lastTranslationSegments = []; // Store last N segments for context

        // TTS related properties
        this.ttsEnabled = false;
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.ttsQueue = [];
        this.isProcessingTTS = false;

        this.initializeElements();
        this.bindEvents();
        this.checkMicrophonePermission();
        this.detectSupportedMimeType();
        this.initializeTTS();
    }

    detectSupportedMimeType() {
        // Check for supported MIME types in order of preference
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/wav',
            'audio/ogg;codecs=opus'
        ];

        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                this.mimeType = mimeType;
                console.log('[MIME TYPE] Using:', mimeType);
                break;
            }
        }

        if (!this.mimeType) {
            console.warn('[MIME TYPE] No supported MIME type found, using default');
            this.mimeType = 'audio/webm'; // Fallback
        }
    }

    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.clearTranscriptionBtn = document.getElementById('clearTranscriptionBtn');
        this.generateSummaryBtn = document.getElementById('generateSummaryBtn');
        this.exportTxtBtn = document.getElementById('exportTxtBtn');
        this.exportJsonBtn = document.getElementById('exportJsonBtn');
        this.summaryTypeSelect = document.getElementById('summaryTypeSelect');
        this.summaryLanguageSelect = document.getElementById('summaryLanguageSelect');

        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.timer = document.getElementById('timer');
        this.transcriptionText = document.getElementById('transcriptionText');
        this.summarySection = document.getElementById('summarySection');
        this.summaryText = document.getElementById('summaryText');
        
        // Translation elements
        this.translationText = document.getElementById('translationText');
        this.translationLanguageSelect = document.getElementById('translationLanguageSelect');
        this.clearTranslationBtn = document.getElementById('clearTranslationBtn');
        
        // TTS elements
        this.ttsToggleBtn = document.getElementById('ttsToggle');
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.clearTranscriptionBtn.addEventListener('click', () => this.clearTranscription());
        this.generateSummaryBtn.addEventListener('click', () => this.generateSummary());
        this.exportTxtBtn.addEventListener('click', () => this.exportTxt());
        this.exportJsonBtn.addEventListener('click', () => this.exportJson());
        
        // Translation events
        this.clearTranslationBtn.addEventListener('click', () => this.clearTranslation());
        
        // TTS events
        this.ttsToggleBtn.addEventListener('click', () => this.toggleTTS());
    }

    async checkMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            this.updateStatus('Ready to record', 'ready');
        } catch (error) {
            console.error('Microphone permission denied:', error);
            this.updateStatus('Microphone access denied. Please allow microphone access to use this app.', 'error');
        }
    }

    async startRecording() {
        try {
            console.log('[RECORDING] Starting...');
            
            // Start session
            const sessionResponse = await fetch('/api/start-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!sessionResponse.ok) {
                throw new Error('Failed to start session');
            }
            
            const sessionData = await sessionResponse.json();
            this.sessionId = sessionData.session_id;
            console.log('[SESSION] Started:', this.sessionId);
            
            // Get audio stream with specific settings
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            // Create MediaRecorder with detected MIME type
            const mediaRecorderOptions = {};
            if (this.mimeType && MediaRecorder.isTypeSupported(this.mimeType)) {
                mediaRecorderOptions.mimeType = this.mimeType;
            }
            
            this.mediaRecorder = new MediaRecorder(this.audioStream, mediaRecorderOptions);
            
            this.recordingChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordingChunks.push(event.data);
                    console.log('[CHUNK] Collected:', event.data.size, 'bytes');
                }
            };
            
            this.mediaRecorder.onstop = () => {
                console.log('[RECORDER] Stopped');
                this.processRecordedAudio();
            };
            
            // Start recording
            this.mediaRecorder.start();
            this.isRecording = true;
            this.startTime = Date.now();
            
            // Update UI
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.updateStatus('Recording... Speak now', 'recording');
            this.startTimer();
            this.clearPlaceholder();
            
            // Process chunks every 10 seconds (not 30)
            this.chunkInterval = setInterval(() => {
                if (this.isRecording && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                    this.mediaRecorder.start();
                }
            }, 10000);
            
        } catch (error) {
            console.error('[ERROR] Start recording:', error);
            this.updateStatus('Error starting recording: ' + error.message, 'error');
        }
    }

    async processRecordedAudio() {
        if (this.recordingChunks.length === 0) {
            console.log('[PROCESS] No chunks to process');
            return;
        }
        
        try {
            const audioBlob = new Blob(this.recordingChunks, { type: this.mimeType });
            console.log('[PROCESS] Processing audio blob:', audioBlob.size, 'bytes');
            
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('session_id', this.sessionId);
            
            const response = await fetch('/api/upload-chunk', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('[RESPONSE] Success:', result);
                
                if (result.complete_text) {
                    this.updateTranscription(result.complete_text);
                    this.checkSummaryButton();
                }
            } else {
                console.error('[RESPONSE] Error:', response.status, response.statusText);
            }
            
            // Clear chunks for next batch
            this.recordingChunks = [];
            
        } catch (error) {
            console.error('[ERROR] Process audio:', error);
        }
    }

    async stopRecording() {
        try {
            console.log('[RECORDING] Stopping...');
            
            this.isRecording = false;
            
            // Clear chunk processing interval
            if (this.chunkInterval) {
                clearInterval(this.chunkInterval);
                this.chunkInterval = null;
            }
            
            // Stop media recorder
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            
            // Stop audio stream
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
                this.audioStream = null;
            }
            
            // Stop timer
            this.stopTimer();
            
            // Update UI
            this.startBtn.disabled = false;
            this.stopBtn.disabled = true;
            
            // Stop session
            await this.stopSession();
            
            console.log('[STATUS] SUCCESS: Recording stopped');
            
        } catch (error) {
            console.error('[ERROR] Stop recording:', error);
            this.updateStatus('Error stopping recording: ' + error.message, 'error');
        }
    }

    async stopSession() {
        if (!this.sessionId) return;
        
        try {
            const response = await fetch('/api/stop-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: this.sessionId })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('[SESSION] Stopped:', result);
                this.updateStatus('Recording completed', 'ready');
            }
        } catch (error) {
            console.error('[ERROR] Stop session:', error);
        }
    }

    updateTranscription(text) {
        this.transcriptionText.textContent = text;
        this.transcriptionText.scrollTop = this.transcriptionText.scrollHeight;
        
        // Check for new text to translate
        this.handleNewTranscriptionText(text);
    }
    
    async handleNewTranscriptionText(currentText) {
        // Check if there's new text to translate
        if (currentText.length > this.lastTranscriptionText.length) {
            const newText = currentText.substring(this.lastTranscriptionText.length).trim();
            if (newText) {
                console.log('[TRANSLATION] New text detected:', newText);
                await this.translateNewText(newText);
            }
        }
        this.lastTranscriptionText = currentText;
    }
    
    async translateNewText(newText) {
        try {
            const targetLanguage = this.translationLanguageSelect.value;
            
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: newText,
                    target_language: targetLanguage,
                    previous_translations: this.lastTranslationSegments // Changed to send array
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('[TRANSLATION] Success:', result.translation);
                
                // Update translation display
                this.appendTranslation(result.translation);
                this.lastTranslationSegment = result.translation;
            } else {
                console.error('[TRANSLATION] Error:', response.status);
            }
        } catch (error) {
            console.error('[TRANSLATION] Error:', error);
        }
    }
    
    appendTranslation(translation) {
        // Clear placeholder if it exists
        const placeholder = document.querySelector(".translation-placeholder");
        if (placeholder) {
            placeholder.style.display = "none";
        }
        
        // Add translation to history
        if (this.translationHistory) {
            this.translationHistory += " " + translation;
        } else {
            this.translationHistory = translation;
        }
        
        // Update display
        this.translationText.textContent = this.translationHistory;
        this.translationText.scrollTop = this.translationText.scrollHeight;
        
        // Maintain last 3 translation segments for context
        this.lastTranslationSegments.push(translation);
        if (this.lastTranslationSegments.length > 3) {
            this.lastTranslationSegments.shift(); // Remove the oldest segment
        }
        
        // Speak the new translation if TTS is enabled
        if (this.ttsEnabled && translation.trim()) {
            const targetLanguage = this.translationLanguageSelect.value;
            this.speakText(translation, targetLanguage);
        }
    }
    
    clearTranslation() {
        this.translationHistory = "";
        this.lastTranslationSegments = [];
        this.translationText.textContent = "";
        
        // Stop any current TTS
        this.stopCurrentSpeech();
        
        const placeholder = document.querySelector(".translation-placeholder");
        if (placeholder) {
            placeholder.style.display = "flex";
        }
    }

    clearPlaceholder() {
        const placeholder = document.querySelector('.transcription-placeholder');
        if (placeholder) {
            placeholder.style.display = 'none';
        }
    }

    updateStatus(message, type) {
        console.log(`[STATUS] ${type.toUpperCase()}: ${message}`);
        this.statusText.textContent = message;
        if (this.statusDot) {
            this.statusDot.className = `status-dot ${type}`;
        }
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            if (this.startTime) {
                const elapsed = Date.now() - this.startTime;
                const minutes = Math.floor(elapsed / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                this.timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    clearAll() {
        this.clearTranscription();
        this.clearTranslation();
        if (this.summarySection) {
            this.summarySection.style.display = 'none';
        }
        this.timer.textContent = '00:00';
        this.sessionId = null;
        this.updateStatus('Ready to record', 'ready');
    }

    clearTranscription() {
        this.transcriptionText.textContent = '';
        this.lastTranscriptionText = '';
        const placeholder = document.querySelector('.transcription-placeholder');
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
        this.checkSummaryButton();
    }

    checkSummaryButton() {
        const hasText = this.transcriptionText.textContent.trim().length > 0;
        if (this.generateSummaryBtn) {
            this.generateSummaryBtn.disabled = !hasText;
        }
    }

    async generateSummary() {
        if (!this.sessionId) {
            alert('No active session for summary generation');
            return;
        }
        
        try {
            const summaryType = this.summaryTypeSelect ? this.summaryTypeSelect.value : 'medium';
            const summaryLanguage = this.summaryLanguageSelect ? this.summaryLanguageSelect.value : 'en';
            console.log('[SUMMARY] Generating', summaryType, 'summary in', summaryLanguage);
            
            this.generateSummaryBtn.disabled = true;
            this.generateSummaryBtn.innerHTML = '<span class="loading"></span> Generating...';
            
            const response = await fetch('/api/generate-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    session_id: this.sessionId,
                    summary_type: summaryType,
                    summary_language: summaryLanguage
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('[SUMMARY] Generated:', result);
                
                this.summaryText.innerHTML = this.formatSummary(result.summary, result.summary_type);
                if (this.summarySection) {
                    this.summarySection.style.display = 'block';
                    
                    // Update section header to show summary type
                    const summaryHeader = this.summarySection.querySelector('.section-header h2');
                    if (summaryHeader) {
                        summaryHeader.innerHTML = `
                            <span class="section-icon">📋</span>
                            AI Summary (${result.summary_type})
                        `;
                    }
                    
                    // Scroll to summary
                    this.summarySection.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                const error = await response.json();
                alert('Failed to generate summary: ' + (error.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('[ERROR] Generate summary:', error);
            alert('Error generating summary: ' + error.message);
        } finally {
            this.generateSummaryBtn.disabled = false;
            this.generateSummaryBtn.innerHTML = '<span class="btn-icon">✨</span> Generate Summary';
        }
    }

    formatSummary(summary, type) {
        if (type === 'detailed') {
            // For detailed summaries, convert markdown to HTML properly
            let formattedSummary = summary
                // Convert ## headers to h2
                .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                // Convert ### headers to h3
                .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                // Convert **bold** to <strong>
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // Convert line breaks to <br>
                .replace(/\n/g, '<br>')
                // Convert multiple <br> to paragraph breaks
                .replace(/(<br>\s*){2,}/g, '</p><p>')
                // Wrap in paragraphs
                .replace(/^(.)/gm, '<p>$1')
                .replace(/(.)<br>$/gm, '$1</p>');
            
            // Clean up any malformed paragraphs
            formattedSummary = formattedSummary
                .replace(/<p><h([1-6])>/g, '<h$1>')
                .replace(/<\/h([1-6])><\/p>/g, '</h$1>')
                .replace(/<p><\/p>/g, '');
            
            return formattedSummary;
        } else {
            // For short and medium summaries, simple paragraph formatting
            return `<p>${summary.replace(/\n/g, '</p><p>')}</p>`;
        }
    }

    generateFileTitle(text) {
        // Generate a meaningful filename from the first few words of the content
        const words = text.replace(/[^\w\s]/g, '').split(/\s+/).slice(0, 6);
        const title = words.join('-').toLowerCase();
        return title || 'presentation-summary';
    }

    exportTxt() {
        const summary = this.summaryText ? this.summaryText.textContent || this.summaryText.innerHTML.replace(/<[^>]*>/g, '') : '';
        
        if (!summary.trim()) {
            alert('No summary to export. Please generate a summary first.');
            return;
        }
        
        // Generate filename from summary content
        const fileTitle = this.generateFileTitle(summary);
        
        // Clean up the text for better readability
        let cleanText = summary
            // Remove HTML tags if any
            .replace(/<[^>]*>/g, '')
            // Convert HTML entities
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            // Normalize line breaks
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Add proper spacing after headers
            .replace(/^(#{1,6}\s*.+)$/gm, '$1\n')
            // Add proper spacing between sections
            .replace(/\n{3,}/g, '\n\n')
            // Ensure proper line breaks after periods in long paragraphs
            .replace(/\. ([A-Z])/g, '.\n$1')
            // Clean up extra spaces
            .replace(/[ \t]+/g, ' ')
            .replace(/^\s+|\s+$/gm, '')
            // Ensure the text ends with a newline
            .trim() + '\n';
        
        const blob = new Blob([cleanText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileTitle}-summary.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    exportJson() {
        const transcription = this.transcriptionText.textContent;
        const summary = this.summaryText ? this.summaryText.textContent || this.summaryText.innerHTML.replace(/<[^>]*>/g, '') : '';
        
        if (!summary.trim()) {
            alert('No summary to export. Please generate a summary first.');
            return;
        }
        
        // Generate filename from summary content
        const fileTitle = this.generateFileTitle(summary);
        
        const data = {
            timestamp: new Date().toISOString(),
            summary: summary,
            original_transcription: transcription,
            metadata: {
                session_id: this.sessionId,
                mime_type: this.mimeType,
                export_type: 'summary'
            }
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileTitle}-summary.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // TTS Methods
    initializeTTS() {
        console.log('[TTS] Initializing Text-to-Speech...');
        
        // Check if Speech Synthesis is supported
        if (!this.speechSynthesis) {
            console.warn('[TTS] Speech Synthesis not supported in this browser');
            this.ttsToggleBtn.disabled = true;
            this.ttsToggleBtn.title = 'Text-to-Speech not supported in this browser';
            return;
        }

        // Safari-specific initialization
        if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')) {
            console.log('[TTS] Safari detected, applying initialization fix');
            // Force Safari to load voices by creating a dummy utterance
            const dummyUtterance = new SpeechSynthesisUtterance('');
            this.speechSynthesis.speak(dummyUtterance);
            this.speechSynthesis.cancel();
        }

        // Wait for voices to be loaded
        if (this.speechSynthesis.getVoices().length === 0) {
            this.speechSynthesis.addEventListener('voiceschanged', () => {
                this.loadAvailableVoices();
            });
            
            // Safari fallback: Try loading voices after a delay
            setTimeout(() => {
                if (this.speechSynthesis.getVoices().length > 0) {
                    this.loadAvailableVoices();
                }
            }, 1000);
        } else {
            this.loadAvailableVoices();
        }
    }

    loadAvailableVoices() {
        const voices = this.speechSynthesis.getVoices();
        console.log('[TTS] Available voices:', voices.length);
        
        // Create language to voice mapping
        this.voiceMap = {
            'ja': voices.find(v => v.lang.startsWith('ja')) || voices.find(v => v.lang.includes('ja')),
            'es': voices.find(v => v.lang.startsWith('es')) || voices.find(v => v.lang.includes('es')),
            'zh': voices.find(v => v.lang.startsWith('zh')) || voices.find(v => v.lang.includes('zh')),
            'fr': voices.find(v => v.lang.startsWith('fr')) || voices.find(v => v.lang.includes('fr')),
            'it': voices.find(v => v.lang.startsWith('it')) || voices.find(v => v.lang.includes('it')),
            'ko': voices.find(v => v.lang.startsWith('ko')) || voices.find(v => v.lang.includes('ko')),
            'ar': voices.find(v => v.lang.startsWith('ar')) || voices.find(v => v.lang.includes('ar')),
            'hi': voices.find(v => v.lang.startsWith('hi')) || voices.find(v => v.lang.includes('hi')),
            'ru': voices.find(v => v.lang.startsWith('ru')) || voices.find(v => v.lang.includes('ru')),
            'id': voices.find(v => v.lang.startsWith('id')) || voices.find(v => v.lang.includes('id'))
        };

        console.log('[TTS] Voice mapping:', this.voiceMap);
    }

    toggleTTS() {
        this.ttsEnabled = !this.ttsEnabled;
        
        if (this.ttsEnabled) {
            this.ttsToggleBtn.classList.add('active');
            this.ttsToggleBtn.innerHTML = '<i class="fas fa-volume-up"></i> Speech ON';
            console.log('[TTS] Text-to-Speech enabled');
        } else {
            this.ttsToggleBtn.classList.remove('active');
            this.ttsToggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i> Speech OFF';
            this.stopCurrentSpeech();
            console.log('[TTS] Text-to-Speech disabled');
        }
    }

    stopCurrentSpeech() {
        if (this.speechSynthesis.speaking) {
            this.speechSynthesis.cancel();
        }
        this.ttsQueue = [];
        this.isProcessingTTS = false;
        this.currentUtterance = null;
    }

    async speakText(text, languageCode) {
        if (!this.ttsEnabled || !text.trim()) {
            return;
        }

        console.log('[TTS] Speaking text:', text.substring(0, 50) + '...');
        console.log('[TTS] Language:', languageCode);

        // Add to queue for processing
        this.ttsQueue.push({ text, languageCode });
        
        if (!this.isProcessingTTS) {
            this.processTTSQueue();
        }
    }

    async processTTSQueue() {
        if (this.ttsQueue.length === 0) {
            this.isProcessingTTS = false;
            return;
        }

        this.isProcessingTTS = true;
        const { text, languageCode } = this.ttsQueue.shift();

        try {
            await this.speakTextImmediate(text, languageCode);
        } catch (error) {
            console.error('[TTS] Error speaking text:', error);
        }

        // Process next item in queue
        setTimeout(() => {
            this.processTTSQueue();
        }, 100);
    }

    speakTextImmediate(text, languageCode) {
        return new Promise((resolve, reject) => {
            if (!this.speechSynthesis) {
                reject(new Error('Speech synthesis not available'));
                return;
            }

            // Stop any current speech
            if (this.speechSynthesis.speaking) {
                this.speechSynthesis.cancel();
            }

            const utterance = new SpeechSynthesisUtterance(text);
            
            // Set voice based on language
            const voice = this.voiceMap[languageCode];
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            } else {
                // Fallback to language code
                utterance.lang = this.getLanguageCode(languageCode);
            }

            // Set speech parameters for faster speech
            utterance.rate = 1.2; // Slightly faster than normal
            utterance.pitch = 1.0;
            utterance.volume = 0.8;

            utterance.onend = () => {
                console.log('[TTS] Finished speaking');
                this.currentUtterance = null;
                resolve();
            };

            utterance.onerror = (event) => {
                console.error('[TTS] Speech error:', event.error);
                this.currentUtterance = null;
                reject(new Error(event.error));
            };

            this.currentUtterance = utterance;
            
            // Safari-specific fix: Add a small delay before speaking
            if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')) {
                console.log('[TTS] Safari detected, applying compatibility fix');
                setTimeout(() => {
                    this.speechSynthesis.speak(utterance);
                }, 100);
            } else {
                this.speechSynthesis.speak(utterance);
            }
        });
    }

    getLanguageCode(languageCode) {
        const languageMap = {
            'ja': 'ja-JP',
            'es': 'es-ES',
            'zh': 'zh-CN',
            'fr': 'fr-FR',
            'it': 'it-IT',
            'ko': 'ko-KR',
            'ar': 'ar-SA',
            'hi': 'hi-IN',
            'ru': 'ru-RU',
            'id': 'id-ID'
        };
        return languageMap[languageCode] || 'en-US';
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PresentationNotesApp();
});


class PresentationNotesApp {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.sessionId = null;
        this.chunkNumber = 0;
        this.recordingStartTime = null;
        this.timerInterval = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.checkMicrophonePermission();
    }
    
    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.transcriptionText = document.getElementById('transcriptionText');
        this.summaryText = document.getElementById('summaryText');
        this.generateSummaryBtn = document.getElementById('generateSummaryBtn');
        this.summaryTypeSelect = document.getElementById('summaryTypeSelect');
        this.summaryTypeContainer = document.getElementById('summaryTypeContainer');
        this.exportTxtBtn = document.getElementById('exportTxtBtn');
        this.exportJsonBtn = document.getElementById('exportJsonBtn');
        this.clearSummaryBtn = document.getElementById('clearTranscriptionBtn'); // Fixed ID
        this.statusDiv = document.getElementById('statusText'); // Fixed ID
        this.timer = document.getElementById('timer');
        
        // Check for missing elements and log errors
        const requiredElements = {
            'startBtn': this.startBtn,
            'stopBtn': this.stopBtn,
            'clearBtn': this.clearBtn,
            'transcriptionText': this.transcriptionText,
            'summaryText': this.summaryText,
            'generateSummaryBtn': this.generateSummaryBtn,
            'summaryTypeSelect': this.summaryTypeSelect,
            'summaryTypeContainer': this.summaryTypeContainer,
            'exportTxtBtn': this.exportTxtBtn,
            'exportJsonBtn': this.exportJsonBtn,
            'clearSummaryBtn': this.clearSummaryBtn,
            'statusText': this.statusDiv,
            'timer': this.timer
        };
        
        for (const [elementName, element] of Object.entries(requiredElements)) {
            if (!element) {
                console.error(`Required element not found: ${elementName}`);
            }
        }
    }
    
    setupEventListeners() {
        if (this.startBtn) this.startBtn.addEventListener('click', () => this.startRecording());
        if (this.stopBtn) this.stopBtn.addEventListener('click', () => this.stopRecording());
        if (this.clearBtn) this.clearBtn.addEventListener('click', () => this.clearTranscription());
        if (this.generateSummaryBtn) this.generateSummaryBtn.addEventListener('click', () => this.generateSummary());
        if (this.exportTxtBtn) this.exportTxtBtn.addEventListener('click', () => this.exportTxt());
        if (this.exportJsonBtn) this.exportJsonBtn.addEventListener('click', () => this.exportJson());
        if (this.clearSummaryBtn) this.clearSummaryBtn.addEventListener('click', () => this.clearSummary());
    }
    
    async checkMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            this.updateStatus('Ready to record', 'ready');
        } catch (error) {
            this.updateStatus('Microphone access denied. Please allow microphone access to use this app.', 'error');
        }
    }
    
    detectSupportedMimeType() {
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
                console.log(`Using MIME type: ${mimeType}`);
                return mimeType;
            }
        }
        
        console.warn('No supported MIME type found, using default');
        return 'audio/webm';
    }
    
    async startRecording() {
        try {
            // Start session
            const sessionResponse = await fetch('/api/start-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const sessionData = await sessionResponse.json();
            if (!sessionData.success) {
                throw new Error(sessionData.error);
            }
            
            this.sessionId = sessionData.session_id;
            this.chunkNumber = 0;
            
            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Detect supported MIME type
            const mimeType = this.detectSupportedMimeType();
            
            // Create MediaRecorder with detected MIME type
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType
            });
            
            this.audioChunks = [];
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            // Start timer
            this.startTimer();
            
            // Handle data available (every 30 seconds or when stopped)
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    console.log(`Chunk ${this.chunkNumber}: ${event.data.size} bytes`);
                    await this.uploadChunk(event.data);
                    this.chunkNumber++;
                }
            };
            
            // Start recording with 30-second chunks
            this.mediaRecorder.start(30000);
            
            // Update UI
            if (this.startBtn) this.startBtn.disabled = true;
            if (this.stopBtn) this.stopBtn.disabled = false;
            this.updateStatus('Recording... Speak now', 'recording');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            this.updateStatus(`Error starting recording: ${error.message}`, 'error');
        }
    }
    
    async uploadChunk(audioBlob) {
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'chunk.webm');
            formData.append('session_id', this.sessionId);
            formData.append('chunk_number', this.chunkNumber.toString());
            
            const response = await fetch('/api/upload-chunk', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            if (result.success) {
                // Update transcription in real-time
                if (result.complete_text && this.transcriptionText) {
                    this.transcriptionText.textContent = result.complete_text;
                    this.checkSummaryButton();
                }
                
                console.log(`Chunk ${this.chunkNumber} processed. Total calls: ${result.deepgram_calls}`);
            } else {
                console.error('Chunk upload failed:', result.error);
            }
            
        } catch (error) {
            console.error('Error uploading chunk:', error);
        }
    }
    
    async stopRecording() {
        try {
            if (this.mediaRecorder && this.isRecording) {
                this.mediaRecorder.stop();
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                this.isRecording = false;
                
                // Stop timer
                this.stopTimer();
                
                // Stop session
                const response = await fetch('/api/stop-session', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        session_id: this.sessionId
                    })
                });
                
                const result = await response.json();
                if (result.success) {
                    if (this.transcriptionText) {
                        this.transcriptionText.textContent = result.complete_text;
                    }
                    this.checkSummaryButton();
                    this.updateStatus(`Recording stopped. Total: ${result.total_chunks} chunks, ${result.deepgram_calls} API calls`, 'success');
                } else {
                    this.updateStatus(`Error stopping session: ${result.error}`, 'error');
                }
            }
            
            // Update UI
            if (this.startBtn) this.startBtn.disabled = false;
            if (this.stopBtn) this.stopBtn.disabled = true;
            
        } catch (error) {
            console.error('Error stopping recording:', error);
            this.updateStatus(`Error stopping recording: ${error.message}`, 'error');
        }
    }
    
    async generateSummary() {
        if (!this.sessionId) {
            this.updateStatus('No active session. Please record first.', 'error');
            return;
        }
        
        const summaryType = this.summaryTypeSelect ? this.summaryTypeSelect.value : 'medium';
        
        try {
            if (this.generateSummaryBtn) {
                this.generateSummaryBtn.disabled = true;
                this.generateSummaryBtn.textContent = 'Generating...';
            }
            this.updateStatus('Generating summary...', 'processing');
            
            const response = await fetch('/api/generate-summary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    summary_type: summaryType
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                const formattedSummary = this.formatSummary(result.summary, summaryType);
                if (this.summaryText) {
                    this.summaryText.innerHTML = formattedSummary;
                }
                this.updateStatus(`${summaryType.charAt(0).toUpperCase() + summaryType.slice(1)} summary generated successfully`, 'success');
            } else {
                this.updateStatus(`Error generating summary: ${result.error}`, 'error');
            }
            
        } catch (error) {
            console.error('Error generating summary:', error);
            this.updateStatus(`Error generating summary: ${error.message}`, 'error');
        } finally {
            if (this.generateSummaryBtn) {
                this.generateSummaryBtn.disabled = false;
                this.generateSummaryBtn.textContent = '✨ Generate Summary';
            }
        }
    }
    
    clearTranscription() {
        if (this.transcriptionText) {
            this.transcriptionText.textContent = 'Click "Start Recording" to begin transcription...';
        }
        if (this.summaryText) {
            this.summaryText.innerHTML = '';
        }
        this.sessionId = null;
        this.chunkNumber = 0;
        if (this.generateSummaryBtn) {
            this.generateSummaryBtn.style.display = 'none';
        }
        if (this.summaryTypeContainer) {
            this.summaryTypeContainer.style.display = 'none';
        }
        this.updateStatus('Ready to record', 'ready');
        if (this.timer) {
            this.timer.textContent = '00:00';
        }
    }
    
    clearSummary() {
        if (this.summaryText) {
            this.summaryText.innerHTML = '';
        }
        this.updateStatus('Summary cleared', 'success');
    }
    
    startTimer() {
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            if (this.timer) {
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
    
    checkSummaryButton() {
        const text = this.transcriptionText ? this.transcriptionText.textContent.trim() : '';
        if (text.length > 0) {
            if (this.generateSummaryBtn) {
                this.generateSummaryBtn.style.display = "inline-flex";
            }
            if (this.summaryTypeContainer) {
                this.summaryTypeContainer.style.display = "block";
            }
        } else {
            if (this.generateSummaryBtn) {
                this.generateSummaryBtn.style.display = "none";
            }
            if (this.summaryTypeContainer) {
                this.summaryTypeContainer.style.display = "none";
            }
        }
    }
    
    formatSummary(summary, summaryType) {
        // Convert markdown-like formatting to HTML for better display
        let formatted = summary
            .replace(/^## (.*$)/gm, '<h3>$1</h3>')
            .replace(/^### (.*$)/gm, '<h4>$1</h4>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        
        // Wrap in paragraphs
        if (!formatted.startsWith('<h3>') && !formatted.startsWith('<h4>')) {
            formatted = '<p>' + formatted + '</p>';
        }
        
        return formatted;
    }
    
    exportTxt() {
        const transcription = this.transcriptionText ? this.transcriptionText.textContent.trim() : '';
        const summaryHtml = this.summaryText ? this.summaryText.innerHTML.trim() : '';
        
        // Convert HTML summary to properly formatted text
        let summaryText = '';
        if (summaryHtml) {
            // Create a temporary div to parse HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = summaryHtml;
            
            // Extract text content while preserving structure
            summaryText = tempDiv.textContent || tempDiv.innerText || '';
            
            // Clean up and format the text
            summaryText = summaryText
                .replace(/\s+/g, ' ')           // Replace multiple spaces with single space
                .replace(/\n\s*\n/g, '\n\n')    // Preserve paragraph breaks
                .trim();
        }
        
        let content = '# AI Presentation Notes\n\n';
        content += '## Transcription\n\n' + transcription + '\n\n';
        
        if (summaryText.trim()) {
            content += '## Summary\n\n' + summaryText.trim() + '\n\n';
        }
        
        content += `## Generated on\n\n${new Date().toLocaleString()}`;
        
        // Generate filename based on presentation content
        const filename = this.generatePresentationTitle() + '.txt';
        
        this.downloadFile(content, filename, 'text/plain');
    }
    
    exportJson() {
        const transcription = this.transcriptionText ? this.transcriptionText.textContent.trim() : '';
        const summary = this.summaryText ? this.summaryText.textContent.trim() : '';
        
        const data = {
            transcription: transcription,
            summary: summary,
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,
            summary_type: this.summaryTypeSelect ? this.summaryTypeSelect.value : 'medium'
        };
        
        const filename = this.generatePresentationTitle() + '.json';
        this.downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
    }
    
    generatePresentationTitle() {
        const transcription = this.transcriptionText ? this.transcriptionText.textContent.trim() : '';
        if (transcription.length > 0) {
            // Extract first few words for filename
            const words = transcription.split(' ').slice(0, 5);
            return words.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
        }
        return 'presentation-notes';
    }
    
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    updateStatus(text, type) {
        if (this.statusDiv) {
            this.statusDiv.textContent = text;
            this.statusDiv.className = `status ${type}`;
        } else {
            console.log(`Status: ${text} (${type})`);
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PresentationNotesApp();
});


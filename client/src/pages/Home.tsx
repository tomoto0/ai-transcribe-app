import { useEffect, useRef, useState } from "react";

// Helper function to get file extension from MIME type
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };
  return mimeToExt[mimeType] || "audio";
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Mic, MicOff, Copy, CheckCircle, AlertCircle, Volume2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Home() {
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "processing" | "completed">("idle");
  const [timer, setTimer] = useState(0);
  const [transcription, setTranscription] = useState("");
  const [translation, setTranslation] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState("ja");
  const [summaryType, setSummaryType] = useState<"short" | "medium" | "detailed">("medium");
  const [copied, setCopied] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string>("");
  const audioChunksRef = useRef<Blob[]>([]);
  const selectedMimeTypeRef = useRef<string>("");

  const startSessionMutation = trpc.audio.startSession.useMutation();
  const stopSessionMutation = trpc.audio.stopSession.useMutation();
  const recordTranscriptionMutation = trpc.audio.recordTranscription.useMutation();
  const transcribeAudioMutation = trpc.audio.transcribeAudio.useMutation();
  const translateMutation = trpc.translation.translate.useMutation();
  const generateSummaryMutation = trpc.summary.generate.useMutation();

  // Timer effect
  useEffect(() => {
    if (recordingState === "recording") {
      timerIntervalRef.current = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [recordingState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      setError("");
      setRecordingState("recording");
      setTimer(0);

      // Start session
      const sessionResult = await startSessionMutation.mutateAsync();
      sessionIdRef.current = sessionResult.sessionId;

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create analyser for audio level
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Monitor audio level
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const monitorAudioLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(Math.min(100, (average / 255) * 100));
        animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
      };
      monitorAudioLevel();

      // Create MediaRecorder
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
      ];

      let selectedMimeType = "";
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (!selectedMimeType) {
        selectedMimeType = "audio/webm";
      }

      selectedMimeTypeRef.current = selectedMimeType;
      console.log("MediaRecorder created with mime type:", selectedMimeType);

      const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      mediaRecorderRef.current = mediaRecorder;

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log("Recording stopped, audio chunks:", audioChunksRef.current.length);

        if (audioChunksRef.current.length > 0) {
          try {
            // Create audio blob from chunks
            const mimeType = selectedMimeTypeRef.current || "audio/webm";
            const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
            console.log("Audio blob created, size:", audioBlob.size);

            // Convert blob to base64 string
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const base64String = (reader.result as string).split(',')[1];
                console.log("Audio converted to base64, length:", base64String.length);

                // Upload audio using tRPC mutation
                const uploadMutation = trpc.audio.uploadAudio.useMutation();
                const uploadResult = await uploadMutation.mutateAsync({
                  sessionId: sessionIdRef.current,
                  audioBase64: base64String,
                  mimeType: mimeType,
                });

                console.log("Upload result:", uploadResult);

                if (uploadResult.success && uploadResult.url) {
                  const audioUrl = uploadResult.url;

                  // Transcribe audio
                  try {
                    const transcriptionResult = await transcribeAudioMutation.mutateAsync({
                      audioUrl: audioUrl,
                      sessionId: sessionIdRef.current,
                      language: "en",
                    });

                    console.log("Transcription result:", transcriptionResult);
                    if (transcriptionResult.success) {
                      setTranscription(transcriptionResult.text);
                      toast.success("転写が完了しました");
                    }
                  } catch (err) {
                    console.error("Transcription error:", err);
                    toast.error("転写に失敗しました");
                  }
                } else {
                  console.error("Upload failed:", uploadResult);
                  toast.error("音声のアップロードに失敗しました");
                }
              } catch (err) {
                console.error("Error uploading audio:", err);
                toast.error("音声のアップロードに失敗しました");
              }
            };
            reader.readAsDataURL(audioBlob);
          } catch (err) {
            console.error("Error processing audio:", err);
            toast.error("音声の処理に失敗しました");
          }
        }
      };

      mediaRecorder.onerror = (event) => {
        const errorMsg = `Recording error: ${event.error}`;
        console.error(errorMsg);
        setError(errorMsg);
        toast.error(errorMsg);
      };

      mediaRecorder.start();
      toast.success("録音を開始しました");
    } catch (err) {
      const error = err as Error;
      setError(`マイクアクセスエラー: ${error.message}`);
      setRecordingState("idle");
      toast.error(`エラー: ${error.message}`);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !sessionIdRef.current) return;

    try {
      setRecordingState("processing");
      console.log("Stopping recording...");

      // Stop recording
      const recorder = mediaRecorderRef.current;
      if (recorder.state !== "inactive") {
        recorder.stop();
        console.log("MediaRecorder stopped");
      }

      // Stop audio level monitoring
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setAudioLevel(0);

      // Close audio context
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        await audioContextRef.current.close();
        console.log("AudioContext closed");
      }

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
          console.log("Track stopped");
        });
      }

      // Wait for onstop event to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Stop session
      try {
        await stopSessionMutation.mutateAsync({ sessionId: sessionIdRef.current });
        console.log("Session stopped");
      } catch (err) {
        console.error("Failed to stop session:", err);
      }

      setRecordingState("completed");
    } catch (err) {
      const error = err as Error;
      console.error("Stop recording error:", error);
      setError(`停止エラー: ${error.message}`);
      setRecordingState("idle");
      toast.error(`エラー: ${error.message}`);
    }
  };

  const handleTranslate = async () => {
    if (!transcription || !sessionIdRef.current) {
      setError("転写テキストがありません");
      return;
    }

    try {
      setIsTranslating(true);
      setError("");

      const result = await translateMutation.mutateAsync({
        sessionId: sessionIdRef.current,
        text: transcription,
        targetLanguage: selectedLanguage,
      });

      setTranslation(result.translation);
      toast.success("翻訳が完了しました");
    } catch (err) {
      const error = err as Error;
      setError(`翻訳エラー: ${error.message}`);
      toast.error(`エラー: ${error.message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!transcription || !sessionIdRef.current) {
      setError("転写テキストがありません");
      return;
    }

    try {
      setIsGeneratingSummary(true);
      setError("");

      const result = await generateSummaryMutation.mutateAsync({
        sessionId: sessionIdRef.current,
        summaryType: summaryType,
        summaryLanguage: selectedLanguage,
      });

      setSummary(result.summary);
      toast.success("要約が生成されました");
    } catch (err) {
      const error = err as Error;
      setError(`要約生成エラー: ${error.message}`);
      toast.error(`エラー: ${error.message}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("コピーしました");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setTranscription("");
    setTranslation("");
    setSummary("");
    setError("");
    setTimer(0);
    sessionIdRef.current = "";
    audioChunksRef.current = [];
    setRecordingState("idle");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Volume2 className="w-8 h-8 text-blue-400" />
            <h1 className="text-4xl font-bold">AI Transcribe</h1>
          </div>
          <p className="text-gray-400 text-lg">
            音声を転写、翻訳、要約 - すべてAIで自動処理
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Card className="mb-6 p-4 bg-red-950 border-red-800">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-200 font-semibold">エラーが発生しました</p>
                <p className="text-red-300 text-sm mt-1">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Recording Section */}
        <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">録音</h2>
            <div className="text-4xl font-mono text-blue-400 font-bold">{formatTime(timer)}</div>
          </div>

          {/* Audio Level Indicator */}
          {recordingState === "recording" && (
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm text-gray-400">音量レベル</span>
                <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-100"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Button
              onClick={startRecording}
              disabled={recordingState !== "idle"}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3"
            >
              <Mic className="w-5 h-5" />
              {recordingState === "recording" ? "録音中..." : "開始"}
            </Button>
            <Button
              onClick={stopRecording}
              disabled={recordingState !== "recording"}
              variant="destructive"
              className="flex-1 flex items-center justify-center gap-2 font-semibold py-3"
            >
              <MicOff className="w-5 h-5" />
              停止
            </Button>
            <Button
              onClick={handleClear}
              disabled={recordingState === "recording"}
              variant="outline"
              className="flex-1 font-semibold py-3"
            >
              クリア
            </Button>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                recordingState === "recording"
                  ? "bg-red-500 animate-pulse"
                  : recordingState === "processing"
                    ? "bg-yellow-500 animate-pulse"
                    : recordingState === "completed"
                      ? "bg-green-500"
                      : "bg-gray-500"
              }`}
            />
            <span className="text-sm text-gray-400">
              {recordingState === "idle"
                ? "準備完了"
                : recordingState === "recording"
                  ? "録音中"
                  : recordingState === "processing"
                    ? "処理中"
                    : "完了"}
            </span>
          </div>
        </Card>

        {/* Transcription Section */}
        {transcription && (
          <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">転写結果</h2>
              <Button
                onClick={() => handleCopy(transcription)}
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
              >
                {copied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </Button>
            </div>
            <p className="text-gray-200 leading-relaxed">{transcription}</p>
          </Card>
        )}

        {/* Translation Section */}
        <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">翻訳</h2>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            >
              <option value="ja">日本語</option>
              <option value="en">英語</option>
              <option value="es">スペイン語</option>
              <option value="zh">中国語</option>
              <option value="fr">フランス語</option>
              <option value="it">イタリア語</option>
              <option value="ko">韓国語</option>
              <option value="ar">アラビア語</option>
              <option value="hi">ヒンディー語</option>
              <option value="ru">ロシア語</option>
              <option value="id">インドネシア語</option>
            </select>
            <Button
              onClick={handleTranslate}
              disabled={!transcription || isTranslating}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2"
            >
              {isTranslating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              翻訳
            </Button>
          </div>
          {translation && (
            <div className="bg-slate-700 p-4 rounded">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">翻訳結果</span>
                <Button
                  onClick={() => handleCopy(translation)}
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white"
                >
                  {copied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
              <p className="text-gray-200">{translation}</p>
            </div>
          )}
        </Card>

        {/* Summary Section */}
        <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">要約</h2>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <select
              value={summaryType}
              onChange={(e) => setSummaryType(e.target.value as "short" | "medium" | "detailed")}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            >
              <option value="short">短い要約</option>
              <option value="medium">中程度の要約</option>
              <option value="detailed">詳細な要約</option>
            </select>
            <Button
              onClick={handleGenerateSummary}
              disabled={!transcription || isGeneratingSummary}
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2"
            >
              {isGeneratingSummary ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              生成
            </Button>
          </div>
          {summary && (
            <div className="bg-slate-700 p-4 rounded">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">要約結果</span>
                <Button
                  onClick={() => handleCopy(summary)}
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white"
                >
                  {copied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
              <p className="text-gray-200 whitespace-pre-wrap">{summary}</p>
            </div>
          )}
        </Card>

        {/* Instructions */}
        <Card className="p-6 bg-slate-800 border-slate-700">
          <h3 className="text-lg font-bold text-white mb-3">使い方</h3>
          <p className="text-gray-300 text-sm">
            「開始」ボタンをクリックして、音声の録音を開始してください。録音が完了したら「停止」ボタンをクリックします。転写が自動的に実行され、翻訳と要約を生成できます。
          </p>
          <p className="text-gray-400 text-xs mt-3">
            対応言語: 日本語、英語、スペイン語、中国語、フランス語、イタリア語、韓国語、アラビア語、ヒンディー語、ロシア語
          </p>
        </Card>
      </div>
    </div>
  );
}


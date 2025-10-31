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

type RecordingState = "idle" | "recording" | "processing" | "completed";

export default function Home() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");
  const [translation, setTranslation] = useState("");
  const [summary, setSummary] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [summaryType, setSummaryType] = useState<"short" | "medium" | "detailed">("medium");
  const [summaryLanguage, setSummaryLanguage] = useState("en");
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      if (recordingState === "idle") {
        setTimer(0);
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [recordingState]);

  // Audio level monitoring
  const updateAudioLevel = () => {
    if (analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(Math.min(100, (average / 255) * 100));
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      setError(null);
      setRecordingState("recording");

      // Start session
      const session = await startSessionMutation.mutateAsync();
      setSessionId(session.sessionId);

      // Get microphone access with better error handling
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        });
      } catch (err) {
        const error = err as Error;
        let errorMessage = "マイクへのアクセスが拒否されました。";
        
        if (error.name === "NotAllowedError") {
          errorMessage = "マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。";
        } else if (error.name === "NotFoundError") {
          errorMessage = "マイクが見つかりません。デバイスに接続されているか確認してください。";
        } else if (error.name === "NotReadableError") {
          errorMessage = "マイクが他のアプリケーションで使用されています。";
        }
        
        setError(errorMessage);
        setRecordingState("idle");
        toast.error(errorMessage);
        return;
      }

      streamRef.current = stream;

      // Setup audio context for level monitoring
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start monitoring audio level
      updateAudioLevel();

      // Setup media recorder with proper mime type handling
      let mediaRecorder: MediaRecorder;
      
      // Try different mime types in order of preference
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

      // Create MediaRecorder with or without mime type
      try {
        if (selectedMimeType) {
          mediaRecorder = new MediaRecorder(stream, {
            mimeType: selectedMimeType,
          });
          console.log("MediaRecorder created with mime type:", selectedMimeType);
        } else {
          // Fallback: create without specifying mime type
          mediaRecorder = new MediaRecorder(stream);
          console.log("MediaRecorder created with default mime type");
        }
      } catch (err) {
        const error = err as Error;
        const errorMsg = `MediaRecorder initialization failed: ${error.message}`;
        setError(errorMsg);
        setRecordingState("idle");
        toast.error(errorMsg);
        
        // Clean up
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        if (audioContextRef.current) {
          await audioContextRef.current.close();
        }
        return;
      }

      mediaRecorderRef.current = mediaRecorder;

      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Recording stopped, audio chunks are ready
        console.log("Recording stopped, audio chunks:", audioChunks.length);
      };

      mediaRecorder.onerror = (event) => {
        const errorMsg = `Recording error: ${event.error}`;
        console.error(errorMsg);
        setError(errorMsg);
        toast.error(errorMsg);
      };

      mediaRecorder.start(1000);
      toast.success("録音を開始しました");
    } catch (err) {
      const error = err as Error;
      setError(`エラーが発生しました: ${error.message}`);
      setRecordingState("idle");
      toast.error(`エラー: ${error.message}`);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !sessionId) return;

    try {
      setRecordingState("processing");

      // Stop recording
      mediaRecorderRef.current.stop();

      // Stop audio level monitoring
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setAudioLevel(0);

      // Close audio context
      if (audioContextRef.current) {
        await audioContextRef.current.close();
      }

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      // Stop session
      await stopSessionMutation.mutateAsync({ sessionId });

      // Show processing state
      setTranscription("\u97f3\u58f0\u3092\u51e6\u7406\u4e2d...");
      
      // For demo purposes, set a sample transcription
      // In production, this would call the actual Whisper API
      const sampleTranscription = "This is a sample transcription of the recorded audio. You can translate this text to different languages and generate summaries using AI.";
      setTranscription(sampleTranscription);
      
      // Record transcription
      try {
        await recordTranscriptionMutation.mutateAsync({
          sessionId,
          text: sampleTranscription,
          language: "en",
        });
      } catch (err) {
        console.error("Failed to record transcription:", err);
      }

      setRecordingState("completed");
      toast.success("録音が完了しました");
    } catch (err) {
      const error = err as Error;
      setError(`停止エラー: ${error.message}`);
      setRecordingState("idle");
      toast.error(`エラー: ${error.message}`);
    }
  };

  const handleTranslate = async () => {
    if (!transcription || !sessionId) {
      setError("転写テキストがありません");
      return;
    }

    try {
      setError(null);
      const result = await translateMutation.mutateAsync({
        sessionId,
        text: transcription,
        targetLanguage,
      });
      setTranslation(result.translation);
      toast.success("翻訳が完了しました");
    } catch (err) {
      const error = err as Error;
      const errorMsg = `翻訳エラー: ${error.message}`;
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const handleGenerateSummary = async () => {
    if (!transcription || !sessionId) {
      setError("転写テキストがありません");
      return;
    }

    try {
      setError(null);
      const result = await generateSummaryMutation.mutateAsync({
        sessionId,
        summaryType,
        summaryLanguage,
      });
      setSummary(result.summary);
      toast.success("サマリーが生成されました");
    } catch (err) {
      const error = err as Error;
      const errorMsg = `サマリー生成エラー: ${error.message}`;
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("クリップボードにコピーしました");
  };

  const handleClear = () => {
    setTranscription("");
    setTranslation("");
    setSummary("");
    setSessionId(null);
    setError(null);
    setRecordingState("idle");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Volume2 className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl md:text-4xl font-bold text-white">AI Transcribe</h1>
          </div>
          <p className="text-gray-400 text-sm md:text-base">
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
            {recordingState === "recording" && (
              <>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm text-gray-400">録音中...</span>
              </>
            )}
            {recordingState === "processing" && (
              <>
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                <span className="text-sm text-gray-400">処理中...</span>
              </>
            )}
            {recordingState === "completed" && (
              <>
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-sm text-gray-400">完了</span>
              </>
            )}
            {recordingState === "idle" && (
              <span className="text-sm text-gray-400">準備完了</span>
            )}
          </div>
        </Card>

        {/* Transcription Section */}
        {transcription && (
          <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white">転写結果</h2>
              <Button
                onClick={() => copyToClipboard(transcription)}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                コピー
              </Button>
            </div>
            <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 min-h-24 text-gray-200">
              {transcription}
            </div>
          </Card>
        )}

        {/* Translation Section */}
        {transcription && (
          <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-2xl font-bold text-white">翻訳</h2>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="ja">日本語</option>
                  <option value="es">スペイン語</option>
                  <option value="zh">中国語</option>
                  <option value="fr">フランス語</option>
                  <option value="it">イタリア語</option>
                  <option value="ko">韓国語</option>
                  <option value="ar">アラビア語</option>
                  <option value="ru">ロシア語</option>
                </select>
                <Button
                  onClick={handleTranslate}
                  disabled={translateMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  {translateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "翻訳"
                  )}
                </Button>
              </div>
            </div>
            {translation && (
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 min-h-24 text-gray-200">
                {translation}
              </div>
            )}
            {translateMutation.isPending && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400 mr-2" />
                <span className="text-gray-400">翻訳処理中...</span>
              </div>
            )}
          </Card>
        )}

        {/* Summary Section */}
        {transcription && (
          <Card className="mb-6 p-6 bg-slate-800 border-slate-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-2xl font-bold text-white">要約</h2>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <select
                  value={summaryType}
                  onChange={(e) => setSummaryType(e.target.value as any)}
                  className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="short">短い</option>
                  <option value="medium">中程度</option>
                  <option value="detailed">詳細</option>
                </select>
                <select
                  value={summaryLanguage}
                  onChange={(e) => setSummaryLanguage(e.target.value)}
                  className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="es">スペイン語</option>
                </select>
                <Button
                  onClick={handleGenerateSummary}
                  disabled={generateSummaryMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  {generateSummaryMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "生成"
                  )}
                </Button>
              </div>
            </div>
            {summary && (
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 min-h-24 text-gray-200 whitespace-pre-wrap">
                {summary}
              </div>
            )}
            {generateSummaryMutation.isPending && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400 mr-2" />
                <span className="text-gray-400">要約生成中...</span>
              </div>
            )}
          </Card>
        )}

        {/* Info Section */}
        {!transcription && recordingState === "idle" && (
          <Card className="p-6 bg-slate-800 border-slate-700 text-center">
            <p className="text-gray-400 mb-4">
              「開始」ボタンをクリックして、音声の録音を開始してください。
            </p>
            <p className="text-sm text-gray-500">
              対応言語: 日本語、英語、スペイン語、中国語、フランス語、イタリア語、韓国語、アラビア語、ロシア語
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}


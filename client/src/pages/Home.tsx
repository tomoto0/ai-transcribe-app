import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Mic, MicOff, Copy, CheckCircle, AlertCircle, Volume2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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

function getFileExtensionFromMimeType(mimeType: string): string {
  return getFileExtension(mimeType);
}

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
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

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
  const uploadAudioMutation = trpc.audio.uploadAudio.useMutation();

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
      setMicPermissionDenied(false);
      setRecordingState("recording");
      setTimer(0);

      // Start session
      const sessionResult = await startSessionMutation.mutateAsync();
      sessionIdRef.current = sessionResult.sessionId;

      // Request microphone access with proper error handling
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err: any) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setMicPermissionDenied(true);
          setError("マイクへのアクセスが拒否されました。ブラウザの設定でマイクの使用を許可してください。");
          toast.error("マイクへのアクセスが拒否されました");
        } else if (err.name === "NotFoundError") {
          setError("マイクが見つかりません。マイクが接続されていることを確認してください。");
          toast.error("マイクが見つかりません");
        } else {
          setError(`マイクアクセスエラー: ${err.message}`);
          toast.error(`マイクアクセスエラー: ${err.message}`);
        }
        setRecordingState("idle");
        return;
      }

      streamRef.current = stream;

      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create analyser for audio level
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Update audio level
      const updateAudioLevel = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(Math.min(100, (average / 255) * 100));
          animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
        }
      };
      updateAudioLevel();

      // Find supported MIME type
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
            setRecordingState("processing");

            // Create audio blob from chunks
            const mimeType = selectedMimeTypeRef.current || "audio/webm";
            const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
            console.log("Audio blob created, size:", audioBlob.size);

            // Convert blob to base64 string
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const base64String = (reader.result as string).split(",")[1];
                console.log("Audio converted to base64, length:", base64String.length);

                // Upload audio using tRPC mutation (already defined at component level)
                const uploadResult = await uploadAudioMutation.mutateAsync({
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
                      setRecordingState("completed");
                      toast.success("転写が完了しました");
                    }
                  } catch (err) {
                    console.error("Transcription error:", err);
                    toast.error("転写に失敗しました");
                    setRecordingState("completed");
                  }
                } else {
                  console.error("Upload failed:", uploadResult);
                  toast.error("音声のアップロードに失敗しました");
                  setRecordingState("completed");
                }
              } catch (err) {
                console.error("Error uploading audio:", err);
                toast.error("音声のアップロードに失敗しました");
                setRecordingState("completed");
              }
            };
            reader.readAsDataURL(audioBlob);
          } catch (err) {
            console.error("Error processing audio:", err);
            toast.error("音声の処理に失敗しました");
            setRecordingState("completed");
          }
        } else {
          setRecordingState("completed");
          toast.error("音声データが記録されませんでした");
        }
      };

      mediaRecorder.onerror = (event) => {
        const errorMsg = `Recording error: ${event.error}`;
        console.error(errorMsg);
        setError(errorMsg);
        toast.error(errorMsg);
        setRecordingState("idle");
      };

      mediaRecorder.start();
    } catch (err: any) {
      console.error("Error starting recording:", err);
      setError(err.message || "録音の開始に失敗しました");
      toast.error(err.message || "録音の開始に失敗しました");
      setRecordingState("idle");
    }
  };

  const stopRecording = async () => {
    try {
      console.log("Stopping recording...");

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
        console.log("MediaRecorder stopped");
      }

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        console.log("AudioContext closed");
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        console.log("Track stopped");
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Stop session
      if (sessionIdRef.current) {
        await stopSessionMutation.mutateAsync({ sessionId: sessionIdRef.current });
        console.log("Session stopped");
      }
    } catch (err: any) {
      console.error("Error stopping recording:", err);
      toast.error("録音の停止に失敗しました");
    }
  };

  const handleTranslate = async () => {
    if (!transcription) {
      toast.error("転写テキストがありません");
      return;
    }

    setIsTranslating(true);
    try {
      const result = await translateMutation.mutateAsync({
        text: transcription,
        targetLanguage: selectedLanguage,
        sessionId: sessionIdRef.current,
      });

                    if (result.success) {
                        setTranslation(result.translation);
                        toast.success("翻訳が完了しました");
      }
    } catch (err) {
      console.error("Translation error:", err);
      toast.error("翻訳に失敗しました");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!transcription) {
      toast.error("転写テキストがありません");
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const result = await generateSummaryMutation.mutateAsync({
        summaryType: summaryType,
        summaryLanguage: selectedLanguage,
        sessionId: sessionIdRef.current,
      });

      if (result.success) {
        setSummary(result.summary);
        toast.success("要約が完了しました");
      }
    } catch (err) {
      console.error("Summary error:", err);
      toast.error("要約に失敗しました");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3">
            <Volume2 className="w-8 h-8 text-blue-400" />
            <h1 className="text-4xl font-bold text-white">AI Transcribe</h1>
          </div>
          <p className="text-slate-400">音声を転写、翻訳、要約 - すべてAIで自動処理</p>
        </div>

        {/* Error Display */}
        {error && (
          <Card className="bg-red-900/20 border-red-800 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-red-300 font-semibold">エラーが発生しました</p>
                <p className="text-red-200 text-sm mt-1">{error}</p>
                {micPermissionDenied && (
                  <p className="text-red-200 text-sm mt-2">
                    ブラウザの設定でマイクの使用を許可してから、もう一度お試しください。
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Recording Section */}
        <Card className="bg-slate-800/50 border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Mic className="w-5 h-5" />
            録音
          </h2>

          <div className="space-y-4">
            {/* Timer */}
            <div className="text-center">
              <div className="text-5xl font-mono font-bold text-blue-400 tracking-wider">
                {formatTime(timer)}
              </div>
            </div>

            {/* Audio Level Meter */}
            {recordingState === "recording" && (
              <div className="space-y-2">
                <div className="text-sm text-slate-400">音量レベル</div>
                <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 to-blue-500 h-full transition-all duration-75"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
              </div>
            )}

            {/* Status */}
            <div className="text-center text-sm text-slate-400">
              {recordingState === "idle" && "準備完了"}
              {recordingState === "recording" && "録音中..."}
              {recordingState === "processing" && "処理中..."}
              {recordingState === "completed" && "完了"}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={startRecording}
                disabled={recordingState !== "idle"}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Mic className="w-4 h-4 mr-2" />
                開始
              </Button>

              <Button
                onClick={stopRecording}
                disabled={recordingState !== "recording"}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                <MicOff className="w-4 h-4 mr-2" />
                停止
              </Button>

              <Button
                onClick={() => {
                  setTranscription("");
                  setTranslation("");
                  setSummary("");
                  setError("");
                  setRecordingState("idle");
                  setTimer(0);
                }}
                variant="outline"
                className="flex-1"
              >
                クリア
              </Button>
            </div>
          </div>
        </Card>

        {/* Transcription Section */}
        {transcription && (
          <Card className="bg-slate-800/50 border-slate-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">転写</h2>
            <div className="bg-slate-900 rounded p-4 text-slate-200 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {transcription}
            </div>
            <Button
              onClick={() => copyToClipboard(transcription)}
              variant="outline"
              size="sm"
              className="mt-3 w-full"
            >
              {copied ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  コピーしました
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  コピー
                </>
              )}
            </Button>
          </Card>
        )}

        {/* Translation Section */}
        {transcription && (
          <Card className="bg-slate-800/50 border-slate-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">翻訳</h2>
            <div className="flex gap-3 mb-4">
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
              >
                <option value="ja">日本語</option>
                <option value="en">英語</option>
                <option value="es">スペイン語</option>
                <option value="fr">フランス語</option>
                <option value="de">ドイツ語</option>
                <option value="zh">中国語</option>
                <option value="ko">韓国語</option>
              </select>
              <Button
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                {isTranslating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    翻訳中...
                  </>
                ) : (
                  "翻訳"
                )}
              </Button>
            </div>
            {translation && (
              <div className="bg-slate-900 rounded p-4 text-slate-200 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {translation}
              </div>
            )}
          </Card>
        )}

        {/* Summary Section */}
        {transcription && (
          <Card className="bg-slate-800/50 border-slate-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">要約</h2>
            <div className="flex gap-3 mb-4">
              <select
                value={summaryType}
                onChange={(e) => setSummaryType(e.target.value as "short" | "medium" | "detailed")}
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
              >
                <option value="short">短縮版の要約</option>
                <option value="medium">中程度の要約</option>
                <option value="detailed">詳細版の要約</option>
              </select>
              <Button
                onClick={handleGenerateSummary}
                disabled={isGeneratingSummary}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isGeneratingSummary ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    生成中...
                  </>
                ) : (
                  "生成"
                )}
              </Button>
            </div>
            {summary && (
              <div className="bg-slate-900 rounded p-4 text-slate-200 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {summary}
              </div>
            )}
          </Card>
        )}

        {/* Usage Guide */}
        <Card className="bg-slate-800/50 border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">使い方</h2>
          <div className="text-slate-300 space-y-2 text-sm">
            <p>
              「開始」ボタンをクリックして、音声の録音を開始します。ブラウザがマイクへのアクセスを求めてきたら、許可してください。
            </p>
            <p>「停止」ボタンをクリックすると、録音が終了し、転写が自動的に実行されます。</p>
            <p>転写が完了したら、翻訳や要約を生成できます。</p>
            <p>
              対応言語: 日本語、英語、スペイン語、フランス語、ドイツ語、中国語、韓国語、アラビア語、ヒンディー語、ロシア語
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}


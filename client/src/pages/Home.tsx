import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Mic, MicOff, Copy } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");
  const [translation, setTranslation] = useState("");
  const [summary, setSummary] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [summaryType, setSummaryType] = useState<"short" | "medium" | "detailed">("medium");
  const [summaryLanguage, setSummaryLanguage] = useState("en");
  const [timer, setTimer] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startSessionMutation = trpc.audio.startSession.useMutation();
  const stopSessionMutation = trpc.audio.stopSession.useMutation();
  const recordTranscriptionMutation = trpc.audio.recordTranscription.useMutation();
  const translateMutation = trpc.translation.translate.useMutation();
  const generateSummaryMutation = trpc.summary.generate.useMutation();

  // Timer effect
  useEffect(() => {
    if (isRecording) {
      timerIntervalRef.current = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      setTimer(0);
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      // Start session
      const session = await startSessionMutation.mutateAsync();
      setSessionId(session.sessionId);

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && session.sessionId) {
          console.log("Audio chunk received:", event.data.size);
        }
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to access microphone");
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !sessionId) return;

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());

    try {
      await stopSessionMutation.mutateAsync({ sessionId });
      setIsRecording(false);

      // Simulate transcription
      const sampleTranscription = "This is a sample transcription of the recorded audio.";
      setTranscription(sampleTranscription);

      // Record transcription
      await recordTranscriptionMutation.mutateAsync({
        sessionId,
        text: sampleTranscription,
        language: "en",
      });
    } catch (error) {
      console.error("Failed to stop recording:", error);
    }
  };

  const handleTranslate = async () => {
    if (!transcription || !sessionId) return;

    try {
      const result = await translateMutation.mutateAsync({
        sessionId,
        text: transcription,
        targetLanguage,
      });
      setTranslation(result.translation);
    } catch (error) {
      console.error("Translation failed:", error);
      alert("Failed to translate text");
    }
  };

  const handleGenerateSummary = async () => {
    if (!transcription || !sessionId) return;

    try {
      const result = await generateSummaryMutation.mutateAsync({
        sessionId,
        summaryType,
        summaryLanguage,
      });
      setSummary(result.summary);
    } catch (error) {
      console.error("Summary generation failed:", error);
      alert("Failed to generate summary");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">AI Transcribe App</h1>
          <p className="text-gray-600">Real-time audio transcription, translation, and summarization</p>
        </div>

        {/* Recording Section */}
        <Card className="mb-6 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Recording</h2>
            <div className="text-3xl font-mono">{formatTime(timer)}</div>
          </div>

          <div className="flex gap-4 mb-4">
            <Button
              onClick={startRecording}
              disabled={isRecording}
              className="flex items-center gap-2"
            >
              <Mic className="w-4 h-4" />
              Start Recording
            </Button>
            <Button
              onClick={stopRecording}
              disabled={!isRecording}
              variant="destructive"
              className="flex items-center gap-2"
            >
              <MicOff className="w-4 h-4" />
              Stop Recording
            </Button>
            <Button
              onClick={() => {
                setTranscription("");
                setTranslation("");
                setSummary("");
                setSessionId(null);
              }}
              variant="outline"
            >
              Clear
            </Button>
          </div>

          <div className="text-sm text-gray-600">
            {isRecording ? "🔴 Recording..." : "Ready to record"}
          </div>
        </Card>

        {/* Transcription Section */}
        {transcription && (
          <Card className="mb-6 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Transcription</h2>
              <Button
                onClick={() => copyToClipboard(transcription)}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy
              </Button>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200 min-h-24">
              {transcription}
            </div>
          </Card>
        )}

        {/* Translation Section */}
        {transcription && (
          <Card className="mb-6 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Translation</h2>
              <div className="flex gap-2">
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="ja">Japanese</option>
                  <option value="es">Spanish</option>
                  <option value="zh">Chinese</option>
                  <option value="fr">French</option>
                  <option value="it">Italian</option>
                  <option value="ko">Korean</option>
                </select>
                <Button
                  onClick={handleTranslate}
                  disabled={translateMutation.isPending}
                >
                  {translateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Translate"
                  )}
                </Button>
              </div>
            </div>
            {translation && (
              <div className="bg-white p-4 rounded-lg border border-gray-200 min-h-24">
                {translation}
              </div>
            )}
          </Card>
        )}

        {/* Summary Section */}
        {transcription && (
          <Card className="mb-6 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Summary</h2>
              <div className="flex gap-2">
                <select
                  value={summaryType}
                  onChange={(e) => setSummaryType(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="detailed">Detailed</option>
                </select>
                <select
                  value={summaryLanguage}
                  onChange={(e) => setSummaryLanguage(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="en">English</option>
                  <option value="ja">Japanese</option>
                  <option value="es">Spanish</option>
                </select>
                <Button
                  onClick={handleGenerateSummary}
                  disabled={generateSummaryMutation.isPending}
                >
                  {generateSummaryMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Generate"
                  )}
                </Button>
              </div>
            </div>
            {summary && (
              <div className="bg-white p-4 rounded-lg border border-gray-200 min-h-24">
                {summary}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}


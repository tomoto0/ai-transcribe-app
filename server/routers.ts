import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createAudioSession, getAudioSession, updateAudioSession, createTranscription, getTranscriptionBySessionId, createTranslation, getTranslationsBySessionId, createSummary, getSummaryBySessionId } from "./db";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { storagePut } from "./storage";
import { v4 as uuidv4 } from "uuid";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  audio: router({
    // Start a new recording session (no auth required)
    startSession: publicProcedure.mutation(async () => {
      try {
        const sessionId = uuidv4();
        // Use a default userId of 0 for anonymous users
        await createAudioSession({
          userId: 0,
          sessionId,
          status: "recording",
        });
        return {
          success: true,
          sessionId,
        };
      } catch (error) {
        console.error("[AUDIO] Failed to start session:", error);
        throw new Error("Failed to start recording session");
      }
    }),

    // Stop recording session (no auth required)
    stopSession: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          await updateAudioSession(input.sessionId, {
            status: "completed",
          });

          return { success: true };
        } catch (error) {
          console.error("[AUDIO] Failed to stop session:", error);
          throw error;
        }
      }),

    // Record transcription result (no auth required)
    recordTranscription: publicProcedure
      .input(z.object({
        sessionId: z.string(),
        text: z.string(),
        language: z.string().default("ja"),
      }))
      .mutation(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          await createTranscription({
            sessionId: input.sessionId,
            userId: 0,
            originalText: input.text,
            language: input.language,
          });

          return { success: true };
        } catch (error) {
          console.error("[AUDIO] Failed to record transcription:", error);
          throw error;
        }
      }),

    // Transcribe audio using Whisper API (no auth required)
    transcribeAudio: publicProcedure
      .input(z.object({
        audioUrl: z.string(),
        sessionId: z.string(),
        language: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          const result = await transcribeAudio({
            audioUrl: input.audioUrl,
            language: input.language || "en",
            prompt: "Transcribe the user's voice to text",
          });

          if ("error" in result) {
            throw new Error(result.error);
          }

          await createTranscription({
            sessionId: input.sessionId,
            userId: 0,
            originalText: result.text,
            language: result.language || input.language || "en",
          });

          return {
            success: true,
            text: result.text,
            language: result.language,
            segments: result.segments,
          };
        } catch (error) {
          console.error("[AUDIO] Failed to transcribe:", error);
          throw new Error(`Transcription failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }),

    // Get transcription for a session (no auth required)
    getTranscription: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          const transcription = await getTranscriptionBySessionId(input.sessionId);
          return transcription || null;
        } catch (error) {
          console.error("[AUDIO] Failed to get transcription:", error);
          throw error;
        }
      }),
  }),

  translation: router({
    // Translate text using Manus LLM (no auth required)
    translate: publicProcedure
      .input(z.object({
        sessionId: z.string(),
        text: z.string(),
        targetLanguage: z.string().default("ja"),
        previousTranslations: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          // Language mapping for better prompts
          const languageNames: Record<string, string> = {
            ja: "Japanese",
            es: "Spanish",
            zh: "Chinese",
            fr: "French",
            it: "Italian",
            ko: "Korean",
            ar: "Arabic",
            hi: "Hindi",
            ru: "Russian",
            id: "Indonesian",
            en: "English",
          };

          const targetLanguageName = languageNames[input.targetLanguage] || "Japanese";

          // Create translation prompt with context
          let prompt = "";
          if (input.previousTranslations && input.previousTranslations.length > 0) {
            const contextText = input.previousTranslations.join("\n");
            prompt = `You are a professional real-time translator. Translate the following English text to ${targetLanguageName}.

IMPORTANT CONTEXT: This is part of an ongoing real-time transcription. The previous translations were:
"${contextText}"

Please translate the new text in a way that flows naturally and smoothly from the previous translation. Maintain consistency in terminology, style, and context. Also, try to fill in any missing words or context as minimally as possible to ensure coherence.

Text to translate: "${input.text}"

Provide only the translation without any explanations or additional text. Ensure the translation connects smoothly with the previous context.`;
          } else {
            prompt = `You are a professional real-time translator. Translate the following English text to ${targetLanguageName}.

This is the beginning of a real-time transcription session. Provide a natural, accurate translation. Also, try to fill in any missing words or context as minimally as possible to ensure coherence.

Text to translate: "${input.text}"

Provide only the translation without any explanations or additional text.`;
          }

          const response = await invokeLLM({
            messages: [
              { role: "user", content: prompt },
            ],
          });

          const translatedText = typeof response.choices[0].message.content === 'string' ? response.choices[0].message.content : "";

          // Store translation in database
          const transcription = await getTranscriptionBySessionId(input.sessionId);
          if (transcription) {
            await createTranslation({
              transcriptionId: transcription.id,
              sessionId: input.sessionId,
              userId: 0,
              sourceText: input.text,
              targetText: translatedText,
              sourceLanguage: "en",
              targetLanguage: input.targetLanguage,
            });
          }

          return {
            success: true,
            translation: translatedText,
            targetLanguage: input.targetLanguage,
          };
        } catch (error) {
          console.error("[TRANSLATION] Failed to translate:", error);
          throw new Error(`Translation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }),

    // Get translation history for a session (no auth required)
    getHistory: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          return await getTranslationsBySessionId(input.sessionId);
        } catch (error) {
          console.error("[TRANSLATION] Failed to get history:", error);
          throw error;
        }
      }),
  }),

  summary: router({
    // Generate summary using Manus LLM (no auth required)
    generate: publicProcedure
      .input(z.object({
        sessionId: z.string(),
        summaryType: z.enum(["short", "medium", "detailed"]).default("medium"),
        summaryLanguage: z.string().default("en"),
      }))
      .mutation(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          const transcription = await getTranscriptionBySessionId(input.sessionId);
          if (!transcription) {
            throw new Error("No transcription found for this session");
          }

          const transcript = transcription.originalText;
          if (!transcript || transcript.trim().length < 50) {
            throw new Error("Transcript too short for summary generation. Please record more content.");
          }

          // Language mapping for output instructions
          const languageInstructions: Record<string, string> = {
            en: "Respond in English.",
            ja: "日本語で回答してください。",
            es: "Responde en español.",
            zh: "请用中文回答。",
            fr: "Répondez en français.",
            it: "Rispondi in italiano.",
            ko: "한국어로 답변해주세요.",
            ar: "أجب باللغة العربية.",
            hi: "हिंदी में उत्तर दें।",
            ru: "Отвечайте на русском языке.",
            id: "Jawab dalam bahasa Indonesia.",
          };

          const languageInstruction = languageInstructions[input.summaryLanguage] || languageInstructions.en;

          let prompt = "";

          if (input.summaryType === "short") {
            prompt = `You are a professional executive assistant specializing in creating concise presentation summaries for C-level executives.

Analyze the following transcript and provide a SHORT summary in exactly 4-5 lines. Focus on the most critical points, key decisions, and actionable outcomes. Write in a professional, executive-level tone suitable for busy decision-makers who need immediate insights.

Requirements:
- Exactly 4-5 lines of text
- No bullet points, lists, or markdown formatting
- Focus on main conclusions, decisions, and next steps
- Professional business language with executive tone
- Capture the essence and business impact in minimal words
- Prioritize actionable insights and strategic implications
- ${languageInstruction}

Transcript: ${transcript}`;
          } else if (input.summaryType === "medium") {
            prompt = `You are a professional business analyst creating presentation summaries for corporate teams and stakeholders.

Analyze the following transcript and provide a MEDIUM-length summary that balances comprehensive coverage with readability. Structure your response to cover the main topics, key arguments, important decisions, and strategic implications.

Requirements:
- 3-4 well-structured paragraphs (150-250 words total)
- Cover main topics, key points, and strategic context
- Include important details, decisions, and action items
- Professional business writing style suitable for team sharing
- Clear logical flow from overview to specifics to conclusions
- Suitable for middle management and project teams
- ${languageInstruction}

Structure your response as:
1. Opening paragraph: Main topic, purpose, and key participants
2. Core content: Key points, arguments, and discussions
3. Outcomes: Conclusions, decisions, and recommended next steps

Transcript: ${transcript}`;
          } else {
            // detailed
            prompt = `You are a professional business analyst creating comprehensive presentation summaries.

Analyze the following transcript and provide a DETAILED summary that covers all major points with comprehensive context.

Your summary should:
- Cover all major points discussed with comprehensive context
- Include supporting details, examples, and evidence presented
- Explain the relationships between different topics
- Provide background information and context where relevant
- Highlight any data, statistics, or specific examples mentioned
- Ensure no important information is omitted
- Maintain the logical flow and structure of the original content
- Include any questions raised and answers provided
- Note any conclusions or recommendations made

This should be the most thorough and complete overview of the entire content.
${languageInstruction}

Transcript: ${transcript}`;
          }

          const response = await invokeLLM({
            messages: [
              { role: "user", content: prompt },
            ],
          });

          const summaryText = typeof response.choices[0].message.content === 'string' ? response.choices[0].message.content : "";

          // Store summary in database
          await createSummary({
            sessionId: input.sessionId,
            userId: 0,
            originalText: transcript,
            summaryText,
            summaryType: input.summaryType,
            summaryLanguage: input.summaryLanguage,
          });

          return {
            success: true,
            summary: summaryText,
            summaryType: input.summaryType,
            summaryLanguage: input.summaryLanguage,
          };
        } catch (error) {
          console.error("[SUMMARY] Failed to generate summary:", error);
          throw new Error(`Summary generation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }),

    // Get summary for a session (no auth required)
    get: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        try {
          const session = await getAudioSession(input.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          return await getSummaryBySessionId(input.sessionId);
        } catch (error) {
          console.error("[SUMMARY] Failed to get summary:", error);
          throw error;
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;


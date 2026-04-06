"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyVoiceIntent } from "@/lib/voiceAssistantIntent";

export type VoiceAssistantMicState = "idle" | "listening" | "processing";

export type VoiceAssistantPhase =
  | "off"
  | "wake"
  | "speaking"
  | "prompt"
  | "processing";

/** Substrings after normalizeWake — covers common speech-to-text variants. */
const WAKE_PHRASES = [
  "hey ai",
  "hey a i",
  "hey a.i",
  "hello ai",
  "hello a i",
  "hello a.i",
  "wake up ai",
  "wake up a i",
  "wake up a.i",
];

const GREETING =
  "Hi, I am LF AI. Ask me anything about this app, or tell me a topic and I will create a presentation for you.";

function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("en-us")) ??
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("en")) ??
    voices[0] ??
    null
  );
}

function pickHindiVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const hi = (v: SpeechSynthesisVoice) => (v.lang || "").toLowerCase();
  return (
    voices.find((v) => hi(v).startsWith("hi-in")) ??
    voices.find((v) => hi(v).startsWith("hi")) ??
    null
  );
}

function pickVoiceForLang(lang: string): SpeechSynthesisVoice | null {
  const l = lang.toLowerCase();
  if (l.startsWith("hi")) return pickHindiVoice();
  return pickEnglishVoice();
}

/** Default speech rate (0.1–10). Slightly slow for clarity. */
export const DEFAULT_SPEAK_RATE = 0.78;

export type SpeakOptions = {
  /** Called when the utterance fails (browser may still resolve the promise). */
  onError?: (ev: SpeechSynthesisErrorEvent) => void;
  /** BCP-47 language tag, e.g. en-US, hi-IN */
  lang?: string;
  /** Speech rate; defaults to {@link DEFAULT_SPEAK_RATE} */
  rate?: number;
};

/**
 * Speak text aloud. Defers work off the SpeechRecognition stack — required on Chrome/Edge
 * or TTS may never play when invoked from recognition callbacks.
 */
export function speak(text: string, options?: SpeakOptions): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => resolve();

    let utteranceQueued = false;
    const runUtterance = () => {
      if (utteranceQueued) return;
      utteranceQueued = true;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }

      window.setTimeout(() => {
        const u = new SpeechSynthesisUtterance(text);
        const lang = options?.lang ?? "en-US";
        u.lang = lang;
        u.rate = options?.rate ?? DEFAULT_SPEAK_RATE;
        u.pitch = 1;
        u.volume = 1;
        const voice = pickVoiceForLang(lang);
        if (voice) u.voice = voice;

        u.onend = () => done();

        u.onerror = (ev) => {
          options?.onError?.(ev as SpeechSynthesisErrorEvent);
          done();
        };

        try {
          try {
            window.speechSynthesis.resume();
          } catch {
            /* ignore */
          }
          window.speechSynthesis.speak(u);
          try {
            window.speechSynthesis.resume();
          } catch {
            /* ignore */
          }
        } catch {
          done();
        }
      }, 0);
    };

    const ensureVoicesThenSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        runUtterance();
        return;
      }
      const onVoices = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        runUtterance();
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoices);
      window.setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        runUtterance();
      }, 750);
    };

    // Leave SpeechRecognition / tight sync stacks; Chrome otherwise often plays no audio.
    window.setTimeout(() => {
      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
      ensureVoicesThenSpeak();
    }, 120);
  });
}

function cancelSpeech(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

function normalizeWake(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/gi, " ").replace(/\s+/g, " ").trim();
}

function containsWakeWord(text: string): boolean {
  const n = normalizeWake(text);
  if (WAKE_PHRASES.some((w) => n.includes(w))) return true;
  if (/\bhey\s+(ai|a\s*i|eye)\b/.test(n)) return true;
  if (/\bhello\s+(ai|a\s*i|eye)\b/.test(n)) return true;
  if (/\bwake\s+up\s+(ai|a\s*i|eye)\b/.test(n)) return true;
  return false;
}

/** Strip leading command phrases; keep the topic. */
export function cleanPromptFromSpeech(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";

  const patterns: RegExp[] = [
    /^(create|make)\s+a\s+(ppt|powerpoint|presentation)\s+(on|about)\s+/i,
    /^create\s+a\s+presentation\s+(on|about)\s+/i,
    /^make\s+(a\s+)?presentation\s+(about|on)\s+/i,
    /^make\s+a\s+ppt\s+(on|about)\s+/i,
    /^presentation\s+(on|about)\s+/i,
  ];
  for (const re of patterns) {
    t = t.replace(re, "").trim();
  }

  return t;
}

function containsStopCommand(text: string): boolean {
  return /\bstop\b/i.test(text.trim());
}

type UseVoiceAssistantOptions = {
  /** BCP-47 or label e.g. "English (US)" */
  languageLabel?: string;
  /** Max wait for user prompt after TTS (ms) */
  promptTimeoutMs?: number;
  onPromptReady: (cleanedPrompt: string) => void;
  /**
   * Spoken Q&A about LF AI (product help). If omitted, question-like utterances fall through to deck generation.
   */
  onVoiceQa?: (question: string) => void | Promise<void>;
  onLiveTranscript?: (text: string) => void;
  /** Parent should stop textarea mic / other recognition */
  onRequestStopOtherVoice?: () => void;
  onToast?: (input: { variant: "info" | "error" | "success"; title: string; message?: string }) => void;
};

export function useVoiceAssistant(opts: UseVoiceAssistantOptions) {
  const {
    languageLabel = "English (US)",
    promptTimeoutMs = 6500,
    onPromptReady,
    onVoiceQa,
    onLiveTranscript,
    onRequestStopOtherVoice,
    onToast,
  } = opts;

  const [phase, setPhase] = useState<VoiceAssistantPhase>("off");
  const [liveTranscript, setLiveTranscript] = useState("");
  const phaseRef = useRef<VoiceAssistantPhase>("off");
  const recognitionRef = useRef<any>(null);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const resolveLang = useCallback((): string => {
    const l = languageLabel.toLowerCase();
    if (l.includes("hindi")) return "hi-IN";
    if (l.includes("french")) return "fr-FR";
    return "en-US";
  }, [languageLabel]);

  const clearPromptTimer = useCallback(() => {
    if (promptTimerRef.current) {
      clearTimeout(promptTimerRef.current);
      promptTimerRef.current = null;
    }
  }, []);

  const stopRecognitionInstance = useCallback(() => {
    try {
      recognitionRef.current?.stop?.();
      recognitionRef.current?.abort?.();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    clearPromptTimer();
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
    cancelSpeech();
    stopRecognitionInstance();
    phaseRef.current = "off";
    setLiveTranscript("");
    setPhase("off");
  }, [clearPromptTimer, stopRecognitionInstance]);

  const runPromptCapture = useCallback(() => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      onToast?.({ variant: "error", title: "Voice not available", message: "Speech recognition is not supported." });
      setPhase("off");
      return;
    }

    stopRecognitionInstance();
    setLiveTranscript("");
    phaseRef.current = "prompt";
    setPhase("prompt");

    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = resolveLang();

    let finalText = "";
    let lastMerged = "";

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = String(r?.[0]?.transcript ?? "");
        if (r?.isFinal) finalText += t;
        else interim += t;
      }
      const merged = `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
      lastMerged = merged;
      setLiveTranscript(merged);
      optsRef.current.onLiveTranscript?.(merged);
      if (containsStopCommand(merged)) {
        stopListening();
        onToast?.({ variant: "info", title: "Cancelled", message: "Voice assistant stopped." });
      }
    };

    rec.onerror = (event: any) => {
      const code = String(event?.error ?? "").trim();
      if (code === "aborted") return;
      if (code === "no-speech" && phaseRef.current === "prompt") {
        clearPromptTimer();
        setPhase("off");
        setLiveTranscript("");
        onToast?.({ variant: "info", title: "No speech detected", message: "Try again or type your prompt." });
        return;
      }
      onToast?.({
        variant: "error",
        title: "Voice input issue",
        message: code === "not-allowed" ? "Microphone permission denied." : `Speech error: ${code || "unknown"}`,
      });
    };

    rec.onend = () => {
      clearPromptTimer();
      recognitionRef.current = null;
      if (phaseRef.current !== "prompt") return;

      const raw = (finalText.replace(/\s+/g, " ").trim() || lastMerged).trim();
      if (containsStopCommand(raw)) {
        stopListening();
        onToast?.({ variant: "info", title: "Cancelled", message: "Voice assistant stopped." });
        return;
      }

      const intent = classifyVoiceIntent(raw);
      if (intent === "qa" && optsRef.current.onVoiceQa) {
        setPhase("processing");
        setLiveTranscript("");
        void (async () => {
          try {
            await optsRef.current.onVoiceQa?.(raw);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            onToast?.({ variant: "error", title: "Could not answer", message: msg.slice(0, 160) });
          } finally {
            setPhase("off");
          }
        })();
        return;
      }

      const cleaned = cleanPromptFromSpeech(raw);
      if (!cleaned) {
        onToast?.({ variant: "info", title: "No speech detected", message: "Try again or type your prompt." });
        setPhase("off");
        setLiveTranscript("");
        return;
      }

      setPhase("processing");
      setLiveTranscript("");
      onToast?.({
        variant: "info",
        title: "Generating presentation…",
        message: cleaned.slice(0, 120) + (cleaned.length > 120 ? "…" : ""),
      });
      try {
        optsRef.current.onPromptReady(cleaned);
      } finally {
        setPhase("off");
      }
    };

    promptTimerRef.current = setTimeout(() => {
      try {
        rec.stop?.();
      } catch {
        /* ignore */
      }
    }, promptTimeoutMs);

    try {
      rec.start();
    } catch {
      clearPromptTimer();
      onToast?.({ variant: "error", title: "Could not start microphone", message: "Try again." });
      setPhase("off");
    }
  }, [onToast, resolveLang, stopListening, stopRecognitionInstance, clearPromptTimer]);

  const onWakeDetected = useCallback(async () => {
    stopRecognitionInstance();
    phaseRef.current = "speaking";
    setPhase("speaking");
    optsRef.current.onRequestStopOtherVoice?.();

    await speak(GREETING, {
      onError: () => {
        optsRef.current.onToast?.({
          variant: "info",
          title: "Could not play voice reply",
          message: "Unmute the tab, check system volume, or allow sound for this site. Say your topic when the mic is on.",
        });
      },
    });

    if (phaseRef.current !== "speaking") return;
    runPromptCapture();
  }, [runPromptCapture, stopRecognitionInstance]);

  const runWakeListen = useCallback(() => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      onToast?.({ variant: "error", title: "Voice not available", message: "Speech recognition is not supported." });
      setPhase("off");
      return;
    }

    stopRecognitionInstance();
    setLiveTranscript("");
    phaseRef.current = "wake";
    setPhase("wake");

    const startSession = () => {
      if (phaseRef.current !== "wake") return;
      let wakeHandled = false;
      const rec = new SR();
      recognitionRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = resolveLang();

      rec.onresult = (event: any) => {
        let chunk = "";
        for (let i = 0; i < event.results.length; i++) {
          chunk += String(event.results[i]?.[0]?.transcript ?? "");
        }
        const merged = chunk.replace(/\s+/g, " ").trim();
        setLiveTranscript(merged);
        if (!wakeHandled && containsWakeWord(merged)) {
          wakeHandled = true;
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
          void onWakeDetected();
        }
      };

      rec.onerror = (event: any) => {
        const code = String(event?.error ?? "").trim();
        if (code === "aborted") return;
        if (code === "no-speech" && phaseRef.current === "wake") {
          return;
        }
        if (code === "not-allowed") {
          onToast?.({ variant: "error", title: "Microphone blocked", message: "Allow microphone access for the voice assistant." });
          stopListening();
        }
      };

      rec.onend = () => {
        recognitionRef.current = null;
        if (phaseRef.current !== "wake") return;
        wakeRestartTimerRef.current = setTimeout(() => {
          if (phaseRef.current !== "wake") return;
          try {
            startSession();
          } catch {
            /* ignore */
          }
        }, 120);
      };

      try {
        rec.start();
      } catch {
        onToast?.({ variant: "error", title: "Could not start listening", message: "Try again." });
        setPhase("off");
      }
    };

    startSession();
  }, [onToast, onWakeDetected, resolveLang, stopListening, stopRecognitionInstance]);

  const startListening = useCallback(() => {
    optsRef.current.onRequestStopOtherVoice?.();
    runWakeListen();
  }, [runWakeListen]);

  useEffect(() => {
    return () => {
      clearPromptTimer();
      if (wakeRestartTimerRef.current) clearTimeout(wakeRestartTimerRef.current);
      cancelSpeech();
      try {
        recognitionRef.current?.stop?.();
        recognitionRef.current?.abort?.();
      } catch {
        /* ignore */
      }
    };
  }, [clearPromptTimer]);

  const listening = phase === "wake" || phase === "prompt";
  const micState: VoiceAssistantMicState =
    phase === "processing" || phase === "speaking" ? "processing" : listening ? "listening" : "idle";

  return {
    phase,
    micState,
    liveTranscript,
    listening,
    transcript: liveTranscript,
    startListening,
    stopListening,
    isSupported: isSpeechRecognitionSupported(),
  };
}

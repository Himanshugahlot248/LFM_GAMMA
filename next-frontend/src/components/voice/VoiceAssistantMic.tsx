"use client";

import type { VoiceAssistantMicState } from "@/hooks/useVoiceAssistant";

type Props = {
  micState: VoiceAssistantMicState;
  /** Live transcript (wake or prompt) */
  liveTranscript: string;
  isSupported: boolean;
  /** Assistant is active (wake or prompt or speaking) */
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export function VoiceAssistantMic({
  micState,
  liveTranscript,
  isSupported,
  active,
  disabled = false,
  onToggle,
}: Props) {
  const processing = micState === "processing";
  const listening = micState === "listening";
  const idle = !processing && !listening;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[130] flex max-w-[min(92vw,320px)] flex-col items-end gap-2">
      {(listening || active) && liveTranscript ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none rounded-2xl border border-white/10 bg-zinc-950/95 px-3 py-2 text-xs leading-snug text-zinc-100 shadow-lg backdrop-blur-md"
        >
          <span className="font-semibold text-[#FACC15]">Voice</span>
          <span className="text-zinc-500"> · </span>
          <span className="text-zinc-200">{liveTranscript}</span>
        </div>
      ) : null}
      <div className="pointer-events-auto flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={!isSupported || disabled}
          onClick={onToggle}
          aria-pressed={active}
          aria-label={
            !isSupported
              ? "Voice assistant not supported in this browser"
              : active
                ? "Stop voice assistant"
                : "Start voice assistant — say Hey AI, Hello AI, or Wake up AI"
          }
          title={!isSupported ? "Voice assistant not supported" : active ? "Stop" : "Say Hey AI, Hello AI, or Wake up AI to wake"}
          className={[
            "relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15]/50 disabled:cursor-not-allowed disabled:opacity-60",
            idle
              ? "border-zinc-600 bg-zinc-600/90 text-zinc-200 hover:bg-zinc-500/90"
              : listening
                ? "border-red-500 bg-red-600/90 text-white"
                : "border-amber-400/60 bg-zinc-800/95 text-amber-200",
          ].join(" ")}
        >
          {processing ? (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z" />
            </svg>
          )}
          {listening ? (
            <span
              className="absolute inset-0 animate-ping rounded-full border-2 border-red-400/30"
              aria-hidden
            />
          ) : null}
        </button>
        <span className="max-w-[14rem] text-right text-[10px] font-semibold text-zinc-500">
          {!isSupported
            ? "Not supported"
            : "Say Hey AI, Hello AI, or Wake up AI — then ask or speak a topic"}
        </span>
      </div>
    </div>
  );
}

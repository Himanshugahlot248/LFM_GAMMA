"use client";

import { useState } from "react";
import { ApiError, localUsernameAuth } from "@/lib/api";
import type { StoredUser } from "@/lib/auth";
import { setStoredUser } from "@/lib/auth";
import { normalizeUsernameInput } from "@/lib/usernameDerivedId";

type Mode = "register" | "login";

type Props = {
  onSignedIn: (user: StoredUser) => void;
};

export function UsernameGateModal({ onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>("register");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const u = username.trim();
    if (!u) {
      setError("Enter a username.");
      return;
    }
    try {
      normalizeUsernameInput(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(true);
    try {
      const res = await localUsernameAuth({ action: mode, username: u });
      const stored: StoredUser = {
        userId: res.userId,
        username: res.username,
        email: res.email,
        name: res.username,
      };
      setStoredUser(stored);
      onSignedIn(stored);
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body as { detail?: string; message?: string } | undefined;
        const d = body?.detail;
        const msg =
          typeof d === "string"
            ? d
            : d && typeof d === "object" && d !== null && "message" in d
              ? String((d as { message?: string }).message)
              : e.message;
        setError(msg || "Something went wrong.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1419] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="username-gate-title"
      >
        <h1 id="username-gate-title" className="text-xl font-bold text-white">
          Welcome to LF AI
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Choose a unique username. New accounts start with no decks or charts. Use an existing name to continue where you left off.
        </p>

        <div className="mt-5 flex gap-2 rounded-xl border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={[
              "flex-1 rounded-lg py-2 text-sm font-semibold transition",
              mode === "register" ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200",
            ].join(" ")}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={[
              "flex-1 rounded-lg py-2 text-sm font-semibold transition",
              mode === "login" ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200",
            ].join(" ")}
          >
            Sign in
          </button>
        </div>

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Username</label>
        <input
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="e.g. alex_chen"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-sky-500/50"
        />
        <p className="mt-2 text-[11px] text-zinc-500">2–32 characters: lowercase letters, numbers, underscores, hyphens.</p>

        {error ? <p className="mt-3 text-sm text-amber-400">{error}</p> : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-6 w-full rounded-xl bg-[#FACC15] py-3 text-sm font-bold text-black transition hover:bg-[#fde047] disabled:opacity-50"
        >
          {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

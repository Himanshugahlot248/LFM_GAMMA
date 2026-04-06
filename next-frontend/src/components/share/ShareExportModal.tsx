"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PresentationShareSettings } from "@/lib/types";
import { getPresentationShareViews, updatePresentationShareSettings, type ShareViewViewer } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/copyToClipboard";

type Panel = "share" | "export" | "embed";
type TopTab = "sharing" | "settings";

type Props = {
  open: boolean;
  onClose: () => void;
  presentationId: string;
  title: string;
  userId: string;
  initialShare?: PresentationShareSettings | null;
  onSaved: (next: PresentationShareSettings) => void;
  /** Called after attempting to copy the share URL (clipboard API may still fail on some browsers). */
  onCopyLink?: (detail: { ok: boolean; url: string }) => void;
  exporting: boolean;
  onExportPptx: () => void;
  onExportPdf: () => void;
  onExportGoogle: () => void;
  userLabel?: string;
};

function defaultShare(): PresentationShareSettings {
  return { linkAccess: "view", passwordEnabled: false, searchIndexing: false, hasPassword: false };
}

export function ShareExportModal({
  open,
  onClose,
  presentationId,
  title,
  userId,
  initialShare,
  onSaved,
  onCopyLink,
  exporting,
  onExportPptx,
  onExportPdf,
  onExportGoogle,
  userLabel = "You",
}: Props) {
  const [topTab, setTopTab] = useState<TopTab>("sharing");
  const [panel, setPanel] = useState<Panel>("share");
  const [linkAccess, setLinkAccess] = useState<"none" | "view">("view");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [searchIndexing, setSearchIndexing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<ShareViewViewer[]>([]);
  const [anonymousViewCount, setAnonymousViewCount] = useState(0);
  const shareLinkCopiedTimer = useRef<number | null>(null);

  const merged = useMemo(() => ({ ...defaultShare(), ...initialShare }), [initialShare]);

  useEffect(() => {
    if (!open) return;
    setLinkAccess(merged.linkAccess === "none" ? "none" : "view");
    setPasswordEnabled(merged.passwordEnabled);
    setSearchIndexing(merged.searchIndexing);
    setPasswordDraft("");
    setTopTab("sharing");
    setPanel("share");
    setInviteError(null);
    setShareLinkCopied(false);
    setAnalyticsOpen(false);
    setAnalyticsError(null);
    setViewers([]);
    setAnonymousViewCount(0);
    if (shareLinkCopiedTimer.current) {
      window.clearTimeout(shareLinkCopiedTimer.current);
      shareLinkCopiedTimer.current = null;
    }
  }, [open, merged, presentationId]);

  useEffect(() => {
    if (!open || !userId.trim() || !analyticsOpen) return;
    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    void getPresentationShareViews(presentationId, userId)
      .then((r) => {
        if (cancelled) return;
        setViewers(Array.isArray(r.viewers) ? r.viewers : []);
        setAnonymousViewCount(typeof r.anonymousViewCount === "number" ? r.anonymousViewCount : 0);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setAnalyticsError(msg);
        setViewers([]);
        setAnonymousViewCount(0);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, analyticsOpen, presentationId, userId]);

  useEffect(() => {
    return () => {
      if (shareLinkCopiedTimer.current) window.clearTimeout(shareLinkCopiedTimer.current);
    };
  }, []);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/preview/${presentationId}`;
  }, [presentationId]);

  const footerStatus = useMemo(() => {
    if (linkAccess === "none") return "Only you can open this deck via the link.";
    if (passwordEnabled) return "Only people with the password can view from the link.";
    return "Anyone with the link can view this deck.";
  }, [linkAccess, passwordEnabled]);

  async function persist(partial: {
    linkAccess?: "none" | "view";
    passwordEnabled?: boolean;
    password?: string | null;
    searchIndexing?: boolean;
  }) {
    setSaving(true);
    try {
      const res = await updatePresentationShareSettings(presentationId, userId, partial);
      if (res.shareSettings) onSaved(res.shareSettings);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyLink() {
    const url = shareUrl.trim();
    const ok = await copyTextToClipboard(url);
    if (ok) {
      if (shareLinkCopiedTimer.current) window.clearTimeout(shareLinkCopiedTimer.current);
      setShareLinkCopied(true);
      shareLinkCopiedTimer.current = window.setTimeout(() => {
        setShareLinkCopied(false);
        shareLinkCopiedTimer.current = null;
      }, 2200);
    }
    onCopyLink?.({ ok, url });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative flex max-h-[min(92vh,880px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1419] shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
      >
        <header className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 text-[#9CA3AF]" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M9 11V8a3 3 0 0 1 6 0v3" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="share-dialog-title" className="truncate text-lg font-bold text-white">
                Share {title || "Presentation"}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">Control link access, password, and export.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close dialog"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex flex-shrink-0 gap-6 border-b border-white/10 px-5">
          {(["sharing", "settings"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopTab(t)}
              className={[
                "-mb-px border-b-2 pb-3 text-sm font-semibold",
                topTab === t ? "border-sky-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {t === "sharing" ? "Sharing" : "Settings"}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {topTab === "settings" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
              <p className="text-sm font-semibold text-white">Deck visibility</p>
              <p className="mt-1 text-xs text-zinc-500">
                When search indexing is off, we ask crawlers not to index this preview URL (best-effort via meta tag).
              </p>
              <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <span className="text-sm text-zinc-200">Search indexing</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={searchIndexing}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSearchIndexing(v);
                    void persist({ searchIndexing: v });
                  }}
                  disabled={saving}
                />
              </label>
            </div>
          ) : (
            <>
          <nav className="w-44 flex-shrink-0 border-r border-white/10 bg-black/20 py-3">
            {(
              [
                ["share", "Share", "share"],
                ["export", "Export", "download"],
                ["embed", "Embed", "code"],
              ] as const
            ).map(([key, label, kind]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTopTab("sharing");
                  setPanel(key);
                }}
                className={[
                  "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium",
                  panel === key ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                ].join(" ")}
              >
                {kind === "share" ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
                  </svg>
                ) : kind === "download" ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
                    <path d="M4 21h16" />
                  </svg>
                ) : (
                  <span className="font-mono text-[11px] leading-none">&lt;/&gt;</span>
                )}
                {label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {panel === "share" ? (
              <div className="space-y-4 px-5 py-5">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M20 20l-3-3" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    placeholder="Add emails or people"
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-sky-500/50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setInviteError("Email invites are not yet enabled — use Copy share link.");
                      }
                    }}
                  />
                </div>
                {inviteError ? <p className="text-xs text-amber-400">{inviteError}</p> : null}

                <div className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm text-zinc-200">
                      <span className="text-zinc-500">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                      </span>
                      Anyone with the link
                    </div>
                    <select
                      value={linkAccess}
                      onChange={(e) => {
                        const v = e.target.value === "none" ? "none" : "view";
                        setLinkAccess(v);
                        void persist({ linkAccess: v });
                      }}
                      disabled={saving}
                      className="rounded-lg border border-white/10 bg-[#0B0F1A] px-2 py-1.5 text-xs font-semibold text-white outline-none"
                    >
                      <option value="none">No access</option>
                      <option value="view">Can view</option>
                    </select>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {linkAccess === "none" ? "Link sharing has been turned off." : "Anyone with the link can open the deck preview."}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-400">
                  <span className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M9 9h6v6H9z" />
                    </svg>
                    Workspace members
                  </span>
                  <span className="text-xs font-semibold text-zinc-300">No access</span>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                      {userLabel.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="font-medium text-white">{userLabel}</span>
                  </div>
                  <span className="text-xs font-semibold text-sky-400">Full access</span>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                  <span className="text-sm text-zinc-200">Password</span>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      checked={passwordEnabled}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setPasswordEnabled(v);
                        void persist({ passwordEnabled: v, password: v ? "" : null });
                      }}
                      disabled={saving || linkAccess === "none"}
                    />
                    <span className="text-xs text-zinc-500">{passwordEnabled ? "On" : "Off"}</span>
                  </label>
                </div>
                {passwordEnabled && linkAccess !== "none" ? (
                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3">
                    <label className="text-xs font-semibold text-amber-200/90">Set password</label>
                    <input
                      type="password"
                      value={passwordDraft}
                      onChange={(e) => setPasswordDraft(e.target.value)}
                      placeholder={merged.hasPassword ? "New password (leave blank to keep)" : "Enter password"}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#FACC15]/50"
                    />
                    <button
                      type="button"
                      disabled={saving || !passwordDraft.trim()}
                      onClick={() => void persist({ password: passwordDraft.trim(), passwordEnabled: true })}
                      className="mt-2 rounded-lg bg-[#FACC15] px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40"
                    >
                      Save password
                    </button>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                  <span className="text-sm text-zinc-200">Search indexing</span>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      checked={searchIndexing}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setSearchIndexing(v);
                        void persist({ searchIndexing: v });
                      }}
                      disabled={saving}
                    />
                    <span className="text-xs text-zinc-500">{searchIndexing ? "On" : "Off"}</span>
                  </label>
                </div>
              </div>
            ) : null}

            {panel === "export" && topTab === "sharing" ? (
              <div className="space-y-2 px-5 py-5">
                <p className="text-xs text-zinc-500">Download or open in Google Slides (same as Export menu).</p>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => onExportPptx()}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-left text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/20 text-xs font-black text-amber-200">
                    PPT
                  </span>
                  PowerPoint (.pptx)
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => onExportPdf()}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-left text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/20 text-xs font-black text-red-200">
                    PDF
                  </span>
                  PDF export
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => onExportGoogle()}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-left text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/20 text-[10px] font-black text-blue-200">
                    G
                  </span>
                  Google Slides
                </button>
              </div>
            ) : null}

            {panel === "embed" && topTab === "sharing" ? (
              <div className="space-y-3 px-5 py-5">
                <p className="text-xs text-zinc-500">Paste this iframe on your site (same origin works best).</p>
                <textarea
                  readOnly
                  className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-zinc-300"
                  value={`<iframe src="${shareUrl}" width="960" height="540" style="border:0;border-radius:12px;max-width:100%" title="${title.replace(/"/g, "&quot;")}" loading="lazy" allowfullscreen></iframe>`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const code = `<iframe src="${shareUrl}" width="960" height="540" style="border:0;border-radius:12px;max-width:100%" title="${title.replace(/"/g, "&quot;")}" loading="lazy" allowfullscreen></iframe>`;
                    void copyTextToClipboard(code);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                >
                  Copy embed code
                </button>
              </div>
            ) : null}
          </div>
            </>
          )}
        </div>

        {analyticsOpen ? (
          <div className="max-h-[min(40vh,320px)] flex-shrink-0 overflow-y-auto border-t border-white/10 bg-black/35 px-5 py-4">
            <p className="text-sm font-semibold text-white">Who viewed this link</p>
            <p className="mt-1 text-xs text-zinc-500">
              Identified viewers are recorded when someone opens the preview while signed in (same browser profile). Anonymous opens are counted separately.
            </p>
            {analyticsLoading ? (
              <p className="mt-3 text-xs text-zinc-400">Loading…</p>
            ) : analyticsError ? (
              <p className="mt-3 text-xs text-amber-400">{analyticsError}</p>
            ) : viewers.length === 0 && anonymousViewCount === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">No views recorded yet. Share the link; opens appear here after the first visit.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {viewers.map((v, i) => {
                  const label =
                    v.displayName?.trim() ||
                    v.email?.trim() ||
                    (v.viewerUserId ? `User ${v.viewerUserId.slice(0, 8)}…` : "Viewer");
                  const sub = [v.email, v.viewCount > 1 ? `${v.viewCount} opens` : null]
                    .filter(Boolean)
                    .join(" · ");
                  let when = "";
                  try {
                    when = v.lastViewedAt
                      ? new Date(v.lastViewedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "";
                  } catch {
                    when = v.lastViewedAt ?? "";
                  }
                  return (
                    <li
                      key={`${v.viewerUserId ?? "anon"}-${i}`}
                      className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    >
                      <div className="font-medium text-zinc-100">{label}</div>
                      {sub ? <div className="text-xs text-zinc-500">{sub}</div> : null}
                      {when ? <div className="text-[11px] text-zinc-600">Last seen {when}</div> : null}
                    </li>
                  );
                })}
                {anonymousViewCount > 0 ? (
                  <li className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-400">
                    Anonymous / unidentified opens: <span className="font-semibold text-zinc-300">{anonymousViewCount}</span>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        ) : null}

        <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/30 px-5 py-4">
          <button
            type="button"
            onClick={() => setAnalyticsOpen((o) => !o)}
            className="flex items-center gap-2 text-xs font-semibold text-sky-400 hover:text-sky-300"
            aria-expanded={analyticsOpen}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 19V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
              <path d="M8 15v-4M12 15V9M16 15v-2" />
            </svg>
            {analyticsOpen ? "Hide analytics" : "View analytics"}
          </button>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <span className="text-center text-[11px] text-zinc-500">{footerStatus}</span>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className={[
                "inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold shadow-lg transition-all duration-200 active:scale-[0.97]",
                shareLinkCopied
                  ? "bg-emerald-500 text-white ring-2 ring-emerald-300/50 ring-offset-2 ring-offset-[#0a0d10]"
                  : "bg-zinc-100 text-zinc-900 hover:bg-white",
              ].join(" ")}
              aria-live="polite"
            >
              {shareLinkCopied ? (
                <>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.25">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Link copied
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Copy share link
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

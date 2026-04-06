"use client";

import { usePathname, useRouter } from "next/navigation";

type LogoHeaderProps = {
  /** Primary label (e.g. @username) */
  userDisplayName?: string | null;
  userEmail?: string | null;
  onSignOut?: () => void;
};

export function LogoHeader({ userDisplayName, userEmail, onSignOut }: LogoHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isProfile = pathname === "/profile" || pathname === "/dashboard";

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <img
          src="/lf-ai-mark.png"
          alt="LF AI"
          className="logo-header h-10 w-10 shrink-0 rounded-md bg-black object-contain 
            border-2 border-yellow-300/60 
            shadow-lg shadow-yellow-200/30
            animate-border-gradient 
            transition-all duration-300 
            relative z-10
            before:content-[''] before:absolute before:inset-0 before:-z-10 before:rounded-md
            before:border-4 before:border-yellow-300/60
            before:blur-[2.5px]
            before:animate-[gradient-border_2.5s_linear_infinite]"
          style={{
            boxShadow: "0 0 3px white, 0 1px 1px 0 white",
          }}

        />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-bold tracking-wide text-yellow-300">LF AI</span>
          <span className="truncate text-xs tracking-wide text-yellow-300/85">Prompt to Presentation</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {userDisplayName ? (
          <span
            className="hidden sm:inline max-w-[160px] truncate text-xs font-semibold text-[#FACC15]"
            title={userDisplayName}
          >
            {userDisplayName}
          </span>
        ) : null}
        {userEmail ? (
          <span className="hidden md:inline max-w-[200px] truncate text-xs text-zinc-400" title={userEmail}>
            {userEmail}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => {
            if (!isProfile) router.push("/profile");
          }}
          aria-label="Profile"
          title="Profile"
          className={[
            "inline-flex items-center justify-center rounded-2xl border px-2.5 py-2 backdrop-blur-md transition",
            isProfile
              ? "cursor-default border-yellow-300/35 bg-yellow-300/15 text-yellow-100"
              : "border-white/15 bg-slate-950/70 text-zinc-100 hover:-translate-y-0.5 hover:border-yellow-300/45 hover:bg-slate-950/85",
          ].join(" ")}
        >
          <span
            className={[
              "inline-flex h-7 w-7 items-center justify-center rounded-xl border",
              isProfile ? "border-yellow-300/35 bg-yellow-300/20" : "border-white/10 bg-white/5",
            ].join(" ")}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
              <path
                d="M12 12c2.761 0 5-2.462 5-5.5S14.761 1 12 1 7 3.462 7 6.5 9.239 12 12 12Zm0 2c-4.97 0-9 3.358-9 7.5 0 .276.224.5.5.5h17a.5.5 0 0 0 .5-.5c0-4.142-4.03-7.5-9-7.5Z"
                fill="currentColor"
              />
            </svg>
          </span>
        </button>

        {onSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            className={[
              "rounded-2xl px-4 py-1.5 text-xs font-semibold transition-colors duration-150 cursor-pointer",
              "border border-[#FACC15]/35 bg-[#FACC15]/15 text-[#FACC15]",
              "hover:bg-[#FACC15]/30 hover:border-[#FACC15]/55 hover:text-white-900"
            ].join(" ")}
          >
            Sign out
          </button>
        ) : null}
      </div>
    </div>
  );
}


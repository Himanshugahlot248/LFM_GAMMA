"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";

export function FloatingProfileButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(Boolean(getStoredUser()?.username));
  }, [pathname]);

  if (!show) return null;

  const isProfile = pathname === "/profile" || pathname === "/dashboard";
  const isEditor = pathname.startsWith("/app");

  return (
    <button
      type="button"
      onClick={() => {
        if (!isProfile) router.push("/profile");
      }}
      aria-label="Profile"
      className={[
        "fixed z-[90] inline-flex items-center rounded-2xl border backdrop-blur-md transition",
        // Keep it visible but less intrusive inside the editor workspace.
        isEditor ? "bottom-4 left-4" : "bottom-5 left-5",
        "px-3 py-2.5 sm:px-3.5",
        "shadow-[0_12px_34px_rgba(0,0,0,0.35)]",
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
      <span className="hidden text-sm font-semibold sm:inline">Profile</span>
    </button>
  );
}

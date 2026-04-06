"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/home");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
      <div className="h-10 w-10 animate-pulse rounded-2xl bg-white/10 ring-1 ring-white/10 shadow-lg" />
    </div>
  );
}

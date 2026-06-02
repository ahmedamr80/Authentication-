"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import Image from "next/image";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // 2.5s fallback timeout to prevent hanging on loading screen if Auth initialization is slow/blocked
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading || timedOut) {
      if (user && !timedOut) {
        router.replace("/dashboard");
      } else {
        router.replace("/auth/signin");
      }
    }
  }, [user, loading, timedOut, router]);

  // Show a brief loading screen while auth state resolves.
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4">
        <Image src="/logo.svg" alt="Logo" width={100} height={100} className="w-24 h-24 animate-pulse" />
        <div className="text-gray-400">Loading Padel Manager...</div>
      </div>
    </div>
  );
}

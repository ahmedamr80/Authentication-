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
    // Fallback timeout to prevent hanging on loading screen if Auth initialization is slow/blocked
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // If a user is authenticated, always redirect to dashboard
    if (user) {
      router.replace("/dashboard");
      return;
    }

    // Only redirect to signin once auth loading finishes with no user, or fallback timeout triggers
    if (!loading || timedOut) {
      router.replace("/auth/signin");
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

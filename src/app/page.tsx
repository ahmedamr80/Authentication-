"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from "react";
import Image from "next/image";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace("/dashboard");
      } else {
        router.replace("/auth/signin");
      }
    }
  }, [user, loading, router]);

  // Show a brief loading screen while auth state resolves.
  // The redirect in next.config.mjs handles the server-side case.
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4">
        <Image src="/logo.svg" alt="Logo" width={100} height={100} className="w-24 h-24 animate-pulse" />
        <div className="text-gray-400">Loading Padel Manager...</div>
      </div>
    </div>
  );
}

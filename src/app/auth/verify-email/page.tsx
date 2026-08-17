"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");

    const [status, setStatus] = useState<"loading" | "success" | "error">(() => token ? "loading" : "error");
    const [message, setMessage] = useState<string>(() => token ? "" : "Missing verification token in request.");

    useEffect(() => {
        if (!token) return;

        let isSubscribed = true;

        async function verify() {
            try {
                const res = await fetch("/api/auth/verify-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                });

                const data = await res.json();
                if (isSubscribed) {
                    if (res.ok && data.success) {
                        setStatus("success");
                        setMessage(data.message || "Your email address has been verified successfully!");
                    } else {
                        setStatus("error");
                        setMessage(data.error || "Failed to verify email address.");
                    }
                }
            } catch (err) {
                console.error("Verification request error:", err);
                if (isSubscribed) {
                    setStatus("error");
                    setMessage("An unexpected error occurred while processing your verification link.");
                }
            }
        }

        verify();

        return () => {
            isSubscribed = false;
        };
    }, [token]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4 text-white">
            <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-6 shadow-xl">
                {status === "loading" && (
                    <div className="flex flex-col items-center space-y-4">
                        <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
                        <h2 className="text-xl font-bold">Verifying Email...</h2>
                        <p className="text-sm text-gray-400">Please wait while we validate your verification token.</p>
                    </div>
                )}

                {status === "success" && (
                    <div className="flex flex-col items-center space-y-4">
                        <CheckCircle2 className="w-14 h-14 text-green-500" />
                        <h2 className="text-2xl font-bold text-green-400">Email Verified!</h2>
                        <p className="text-sm text-gray-300">{message}</p>
                        <div className="flex flex-col sm:flex-row gap-3 w-full mt-4">
                            <Button
                                variant="outline"
                                className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
                                onClick={() => router.push("/dashboard")}
                            >
                                Go to Dashboard
                            </Button>
                            <Button
                                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                                onClick={() => router.push("/auth/signin")}
                            >
                                Sign In
                            </Button>
                        </div>
                    </div>
                )}

                {status === "error" && (
                    <div className="flex flex-col items-center space-y-4">
                        <XCircle className="w-14 h-14 text-red-500" />
                        <h2 className="text-2xl font-bold text-red-400">Verification Failed</h2>
                        <p className="text-sm text-gray-300">{message}</p>
                        <div className="flex flex-col sm:flex-row gap-3 w-full mt-4">
                            <Button
                                variant="outline"
                                className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
                                onClick={() => router.push("/dashboard")}
                            >
                                Back to Dashboard
                            </Button>
                            <Button
                                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                                onClick={() => router.push("/auth/signin")}
                            >
                                Return to Sign In
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">Loading...</div>}>
            <VerifyEmailContent />
        </Suspense>
    );
}

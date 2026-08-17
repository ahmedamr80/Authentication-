"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Phone, AlertTriangle, ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { User, sendEmailVerification } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useToast } from "@/context/ToastContext";

interface EligibilityGateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user: User | null;
    isEmailVerified: boolean;
    hasPhone: boolean;
    onVerifiedRefresh?: () => void;
}

export function EligibilityGateDialog({
    open,
    onOpenChange,
    user,
    isEmailVerified,
    hasPhone,
    onVerifiedRefresh,
}: EligibilityGateDialogProps) {
    const router = useRouter();
    const { showToast } = useToast();
    const [resendingEmail, setResendingEmail] = useState(false);
    const [reloadingAuth, setReloadingAuth] = useState(false);

    const handleResendVerification = async () => {
        if (!user) return;
        setResendingEmail(true);
        try {
            await sendEmailVerification(user);
            showToast("Verification email sent! Please check your inbox.", "success");
        } catch (error) {
            console.error("Error sending verification email:", error);
            showToast("Failed to send verification email. Please try again later.", "error");
        } finally {
            setResendingEmail(false);
        }
    };

    const handleCheckVerification = async () => {
        if (!user) return;
        setReloadingAuth(true);
        try {
            await user.reload();
            if (user.emailVerified) {
                showToast("Email verified successfully!", "success");
                if (onVerifiedRefresh) {
                    onVerifiedRefresh();
                } else {
                    window.location.reload();
                }
            } else {
                showToast("Email is still not verified. Please check your inbox and click the link.", "warning");
            }
        } catch (err) {
            console.error("Error reloading user status:", err);
        } finally {
            setReloadingAuth(false);
        }
    };

    const handleCompleteProfile = () => {
        onOpenChange(false);
        router.push("/player?completeProfile=true");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md w-full p-6 sm:p-8 rounded-2xl shadow-2xl">
                <DialogHeader className="text-center space-y-3">
                    <div className="mx-auto w-12 h-12 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <DialogTitle className="text-xl font-bold text-white">
                        Complete Profile to Register
                    </DialogTitle>
                    <DialogDescription className="text-sm text-gray-400">
                        To register for events and tournaments, players must have a verified email and a registered phone number.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 my-4">
                    {/* 1. Email Verification Requirement */}
                    <div className={`p-4 rounded-xl border flex flex-col gap-3 transition-all ${
                        isEmailVerified
                            ? "bg-green-950/20 border-green-500/30 text-green-300"
                            : "bg-gray-800/60 border-red-500/30 text-gray-200"
                    }`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Mail className={`w-5 h-5 ${isEmailVerified ? "text-green-400" : "text-red-400"}`} />
                                <div>
                                    <h4 className="font-semibold text-sm text-white">Email Verification</h4>
                                    <p className="text-xs text-gray-400">{user?.email || "No email"}</p>
                                </div>
                            </div>
                            {isEmailVerified ? (
                                <span className="flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20">
                                    <XCircle className="w-3.5 h-3.5" /> Unverified
                                </span>
                            )}
                        </div>

                        {!isEmailVerified && (
                            <div className="flex gap-2 pt-1">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleResendVerification}
                                    disabled={resendingEmail}
                                    className="text-xs h-8 flex-1 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white"
                                >
                                    {resendingEmail ? (
                                        <>
                                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                            Sending...
                                        </>
                                    ) : (
                                        "Resend Email"
                                    )}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleCheckVerification}
                                    disabled={reloadingAuth}
                                    className="text-xs h-8 flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                >
                                    {reloadingAuth ? (
                                        <>
                                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                            Checking...
                                        </>
                                    ) : (
                                        "I Verified"
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* 2. Phone Number Requirement */}
                    <div className={`p-4 rounded-xl border flex flex-col gap-3 transition-all ${
                        hasPhone
                            ? "bg-green-950/20 border-green-500/30 text-green-300"
                            : "bg-gray-800/60 border-red-500/30 text-gray-200"
                    }`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Phone className={`w-5 h-5 ${hasPhone ? "text-green-400" : "text-red-400"}`} />
                                <div>
                                    <h4 className="font-semibold text-sm text-white">Phone Number</h4>
                                    <p className="text-xs text-gray-400">Required for match notifications</p>
                                </div>
                            </div>
                            {hasPhone ? (
                                <span className="flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Added
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20">
                                    <XCircle className="w-3.5 h-3.5" /> Missing
                                </span>
                            )}
                        </div>

                        {!hasPhone && (
                            <Button
                                size="sm"
                                onClick={handleCompleteProfile}
                                className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs h-8 font-semibold"
                            >
                                Add Phone Number in Profile
                            </Button>
                        )}
                    </div>
                </div>

                {/* Back / Dismiss Button */}
                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="w-full border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white flex items-center justify-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Go Back
                    </Button>
                    {(!isEmailVerified || !hasPhone) && (
                        <Button
                            onClick={handleCompleteProfile}
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                        >
                            Open Profile
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

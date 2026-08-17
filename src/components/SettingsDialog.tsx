"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
    Download,
    Bell,
    BellOff,
    Trash2,
    CheckCircle2,
    AlertTriangle,
    Smartphone,
    Share,
    Loader2,
    ShieldAlert,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

interface SettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
    const router = useRouter();
    const { user } = useAuth();
    const { showToast } = useToast();

    // PWA Install Hook
    const { isInstallable, isIOS, isStandalone, triggerInstall } = usePwaInstall();

    // Push Notifications Hook
    const { notificationPermissionStatus, requestPermission } = usePushNotifications();
    const [requestingNotifs, setRequestingNotifs] = useState(false);

    // Delete Account State
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState("");
    const [confirmPhrase, setConfirmPhrase] = useState("");
    const [deleteLoading, setDeleteLoading] = useState(false);

    // Handler: Install App
    const handleInstallApp = async () => {
        try {
            if (isInstallable) {
                const result = await triggerInstall();
                if (result === "accepted") {
                    showToast("EveryWherePadel is being installed!", "success");
                }
            } else if (isIOS) {
                showToast("On iOS: Tap Safari Share icon -> 'Add to Home Screen'", "info");
            } else {
                showToast("App installation is not available on this browser or is already installed.", "info");
            }
        } catch (error) {
            console.error("Install error:", error);
            showToast("Failed to initiate app installation", "error");
        }
    };

    // Handler: Toggle Notifications
    const handleToggleNotifications = async () => {
        if (notificationPermissionStatus === "granted") {
            showToast("Notifications are already enabled for this browser.", "info");
            return;
        }

        setRequestingNotifs(true);
        try {
            await requestPermission();
            if (Notification.permission === "granted") {
                showToast("Browser notifications enabled successfully!", "success");
            } else if (Notification.permission === "denied") {
                showToast("Notifications were blocked. Please enable them in browser settings.", "error");
            }
        } catch (error) {
            console.error("Notification permission error:", error);
            showToast("Could not request notification permissions.", "error");
        } finally {
            setRequestingNotifs(false);
        }
    };

    // Handler: Delete Account
    const handleDeleteAccount = async () => {
        if (!user) return;

        if (confirmPhrase !== "DELETE MY ACCOUNT") {
            showToast("Please type 'DELETE MY ACCOUNT' to confirm deletion.", "error");
            return;
        }

        setDeleteLoading(true);
        try {
            const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : "";

            const response = await fetch("/api/auth/delete-account", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify({
                    stepUpPassword: confirmPassword,
                    confirmPhrase: "DELETE MY ACCOUNT",
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                // If direct server route requires password verification or failed, fallback to client delete
                if (auth.currentUser) {
                    try {
                        await auth.currentUser.delete();
                    } catch (clientDelErr) {
                        console.warn("Client auth delete fallback:", clientDelErr);
                    }
                }
                throw new Error(data.error || "Failed to delete account");
            }

            showToast("Your account has been permanently deleted.", "success");
            onOpenChange(false);
            try {
                await signOut(auth);
            } catch {
                // Ignore
            }
            router.push("/auth/signin");

        } catch (error: unknown) {
            console.error("Delete account error:", error);
            const msg = error instanceof Error ? error.message : "Failed to delete account";
            showToast(msg, "error");
        } finally {
            setDeleteLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-gray-950 border border-gray-800 text-white p-6 shadow-2xl rounded-2xl">
                <DialogHeader className="mb-4">
                    <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                        Settings
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-xs">
                        Manage your application preferences and account settings.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* 1. DOWNLOAD APP */}
                    <div className="p-4 bg-gray-900/70 border border-gray-800 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-orange-500/10 text-orange-500 rounded-lg">
                                    <Smartphone className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-white">Download App</h4>
                                    <p className="text-xs text-gray-400">Install EveryWherePadel on your device</p>
                                </div>
                            </div>

                            {isStandalone ? (
                                <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-xs flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Installed
                                </Badge>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleInstallApp}
                                    className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold h-8 flex items-center gap-1.5"
                                >
                                    <Download className="w-3.5 h-3.5" /> Install
                                </Button>
                            )}
                        </div>

                        {isIOS && !isStandalone && (
                            <div className="p-2.5 bg-gray-950 rounded-lg border border-gray-800 text-xs text-gray-400 flex items-start gap-2">
                                <Share className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                                <span>
                                    On iPhone / iPad: Tap the <strong className="text-white">Share</strong> button in Safari toolbar, then select <strong className="text-white">&quot;Add to Home Screen&quot;</strong>.
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 2. ENABLE NOTIFICATIONS ON BROWSER */}
                    <div className="p-4 bg-gray-900/70 border border-gray-800 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-lg">
                                {notificationPermissionStatus === "granted" ? (
                                    <Bell className="w-5 h-5" />
                                ) : (
                                    <BellOff className="w-5 h-5" />
                                )}
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-white">Browser Notifications</h4>
                                <p className="text-xs text-gray-400">
                                    {notificationPermissionStatus === "granted"
                                        ? "Notifications are enabled"
                                        : notificationPermissionStatus === "denied"
                                        ? "Notifications are blocked"
                                        : "Get updates on event invites & waitlists"}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {requestingNotifs ? (
                                <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                            ) : (
                                <Switch
                                    checked={notificationPermissionStatus === "granted"}
                                    onCheckedChange={handleToggleNotifications}
                                />
                            )}
                        </div>
                    </div>

                    {/* 3. DELETE MY ACCOUNT */}
                    <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-red-500/10 text-red-400 rounded-lg">
                                    <Trash2 className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-red-400">Delete My Account</h4>
                                    <p className="text-xs text-gray-400">Permanently delete your profile and data</p>
                                </div>
                            </div>

                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
                                className="bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold h-8"
                            >
                                Delete
                            </Button>
                        </div>

                        {showDeleteConfirm && (
                            <div className="pt-3 border-t border-red-900/40 space-y-3 animate-in fade-in duration-200">
                                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/60 p-2.5 rounded-lg border border-red-900/50">
                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                    <span>Warning: This action is irreversible. All your registrations and profile info will be wiped.</span>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs text-gray-300">
                                        Type <strong className="text-white">DELETE MY ACCOUNT</strong> to confirm:
                                    </label>
                                    <Input
                                        value={confirmPhrase}
                                        onChange={(e) => setConfirmPhrase(e.target.value)}
                                        placeholder="DELETE MY ACCOUNT"
                                        className="bg-gray-900 border-gray-700 text-xs text-white"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs text-gray-300">Enter your password:</label>
                                    <Input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Current Password"
                                        className="bg-gray-900 border-gray-700 text-xs text-white"
                                    />
                                </div>

                                <div className="flex gap-2 justify-end pt-1">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="text-xs text-gray-400 hover:text-white"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        disabled={confirmPhrase !== "DELETE MY ACCOUNT" || deleteLoading}
                                        onClick={handleDeleteAccount}
                                        className="text-xs bg-red-600 hover:bg-red-700 text-white"
                                    >
                                        {deleteLoading ? (
                                            <>
                                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                                Deleting...
                                            </>
                                        ) : (
                                            "Confirm Deletion"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, UserPlus, User as UserIcon } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp, doc, runTransaction, limit } from "firebase/firestore";
import { User } from "firebase/auth";
import { EventData } from "./EventCard";
import { useTeamInvite } from "@/hooks/useTeamInvite";

interface TeamRegisterDialogProps {
    event: EventData;
    user: User;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

interface UserProfile {
    uid: string;
    displayName: string;
    email: string;
    photoURL?: string;
}

export function TeamRegisterDialog({ event, user, trigger, onSuccess, open: controlledOpen, onOpenChange: setControlledOpen }: TeamRegisterDialogProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = isControlled ? setControlledOpen : setInternalOpen;

    console.log("TeamRegisterDialog Render - open:", open, "controlledOpen:", controlledOpen, "event:", event);

    const [mode, setMode] = useState<"SELECT" | "PARTNER" | "SINGLE">("SELECT");
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
    const [searching, setSearching] = useState(false);
    const { showToast } = useToast();

    // Hook integration
    const { sendInvite, loading: inviteLoading } = useTeamInvite();

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setMode("SELECT");
            setSearchQuery("");
            setSearchResults([]);
        }
    }, [open]);

    const handleSearch = async () => {
        if (!user) return;
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            // 1. Fetch all registrations for this event to filter out already registered users
            const regsRef = collection(db, "registrations");
            const regsQ = query(regsRef, where("eventId", "==", event.eventId));
            const regsSnapshot = await getDocs(regsQ);
            const registeredUserIds = new Set(regsSnapshot.docs.map(doc => doc.data().playerId));

            // Add current user to filtered list (can't invite yourself)
            registeredUserIds.add(user.uid);

            // 2. Optimized Search (Simple Prefix Search)
            const usersRef = collection(db, "users");
            const q = query(
                usersRef,
                where("fullName", ">=", searchQuery),
                where("fullName", "<=", searchQuery + '\uf8ff'),
                limit(5)
            );

            const usersSnapshot = await getDocs(q);

            const results = usersSnapshot.docs
                .map(doc => {
                    const data = doc.data();
                    return {
                        uid: doc.id,
                        displayName: data.fullName || data.displayName || "Unknown",
                        email: data.email,
                        photoURL: data.photoUrl || data.photoURL
                    } as UserProfile;
                })
                .filter(u => !registeredUserIds.has(u.uid));

            setSearchResults(results);
        } catch (error) {
            console.error("Search error:", error);
            showToast("Failed to search users", "error");
        } finally {
            setSearching(false);
        }
    };

    const handleInvitePartner = async (partner: UserProfile) => {
        if (!user) return;

        try {
            await sendInvite(user, event, partner, () => {
                showToast(`Invite sent to ${partner.displayName}!`, "success");
                if (setOpen) setOpen(false);
                if (onSuccess) onSuccess();
            });
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to send invite", "error");
        }
    };

    const handleRegisterSingle = async () => {
        if (!user) return;
        setLoading(true);
        try {
            await runTransaction(db, async (transaction) => {
                // 1. Check Event Slots
                const eventRef = doc(db, "events", event.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("Event not found");


                // Register as Single
                const regRef = doc(collection(db, "registrations"));
                transaction.set(regRef, {
                    registrationId: regRef.id,
                    eventId: event.eventId,
                    playerId: user.uid,
                    registeredAt: Timestamp.now(),
                    status: "CONFIRMED", // Confirmed as a single player
                    partnerStatus: "NONE",
                    lookingForPartner: true,
                    fullNameP1: user.displayName || "Unknown Player",
                    playerPhotoURL: user.photoURL || "",
                    _debugSource: "TeamRegisterDialog.tsx - handleRegisterSingle"
                });
            });

            showToast("Registered as Free Agent!", "success");
            if (onSuccess) onSuccess();
            if (setOpen) setOpen(false);
        } catch (error) {
            console.error("Registration error:", error);
            showToast(error instanceof Error ? error.message : "Failed to register", "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || <Button>Register Team</Button>}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Team Registration</DialogTitle>
                    <DialogDescription>
                        Choose how you want to join {event.eventName}
                    </DialogDescription>
                </DialogHeader>

                {mode === "SELECT" && (
                    <div className="grid gap-4 py-4">
                        <Button
                            variant="outline"
                            className="h-24 flex flex-col items-center justify-center gap-2 hover:bg-blue-50 hover:border-blue-200 transition-all"
                            onClick={() => setMode("PARTNER")}
                        >
                            <UserPlus className="h-8 w-8 text-blue-600" />
                            <span className="font-semibold">I have a partner</span>
                            <span className="text-xs text-gray-500 font-normal">Invite a friend to play with you</span>
                        </Button>
                        <Button
                            variant="outline"
                            className="h-24 flex flex-col items-center justify-center gap-2 hover:bg-green-50 hover:border-green-200 transition-all"
                            onClick={() => handleRegisterSingle()}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="h-8 w-8 animate-spin" /> : <UserIcon className="h-8 w-8 text-green-600" />}
                            <span className="font-semibold">Find me a partner</span>
                            <span className="text-xs text-gray-500 font-normal">Join the &quot;Free Agents&quot; list</span>
                        </Button>
                    </div>
                )}

                {mode === "PARTNER" && (
                    <div className="space-y-4 py-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Search by name or email..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <Button onClick={handleSearch} disabled={searching}>
                                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            </Button>
                        </div>

                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                            {searchResults.map(result => (
                                <div key={result.uid} className="flex items-center justify-between p-2 border rounded hover:bg-gray-50">
                                    <div className="flex flex-col">
                                        <span className="font-medium">{result.displayName || "Unknown User"}</span>
                                        <span className="text-xs text-gray-500">{result.email}</span>
                                    </div>
                                    <Button size="sm" onClick={() => handleInvitePartner(result)} disabled={inviteLoading}>
                                        {inviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
                                    </Button>
                                </div>
                            ))}
                            {searchResults.length === 0 && searchQuery && !searching && (
                                <p className="text-center text-sm text-gray-500 py-2">No users found</p>
                            )}
                        </div>

                        <Button variant="ghost" size="sm" onClick={() => setMode("SELECT")} className="w-full">
                            Back
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

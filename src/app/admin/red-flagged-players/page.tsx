"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { withAdminProtection } from "@/lib/with-admin-protection";
import { useToast } from "@/context/ToastContext";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { parseFirebaseDate } from "@/lib/date-utils";
import { format } from "date-fns";
import {
    ShieldAlert,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    ArrowLeft,
    Search,
    UserCheck,
    UserX,
    Calendar,
    Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";

interface RedFlaggedUser {
    id: string;
    uid: string;
    displayName?: string;
    fullName?: string;
    fullname?: string;
    email?: string;
    photoURL?: string;
    photoUrl?: string;
    redflagged?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redflaggedAt?: any;
    redflagReason?: string | null;
    redflagEventId?: string | null;
}

function RedFlaggedPlayersPage() {
    const router = useRouter();
    const { user } = useAuth();
    const { showToast } = useToast();

    const [players, setPlayers] = useState<RedFlaggedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedPlayer, setSelectedPlayer] = useState<RedFlaggedUser | null>(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    // Real-time listener for red-flagged users
    useEffect(() => {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("redflagged", "==", true));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const list: RedFlaggedUser[] = [];
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    list.push({
                        id: docSnap.id,
                        uid: docSnap.id,
                        ...data,
                    } as RedFlaggedUser);
                });
                setPlayers(list);
                setLoading(false);
            },
            (error) => {
                console.error("Error fetching red-flagged players:", error);
                showToast("Failed to load red-flagged players", "error");
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [showToast]);

    const filteredPlayers = players.filter((p) => {
        const name = (p.displayName || p.fullName || p.fullname || "").toLowerCase();
        const email = (p.email || "").toLowerCase();
        const id = p.id.toLowerCase();
        const reason = (p.redflagReason || "").toLowerCase();
        const q = searchQuery.toLowerCase();
        return name.includes(q) || email.includes(q) || id.includes(q) || reason.includes(q);
    });

    const handleOpenClearDialog = (player: RedFlaggedUser) => {
        setSelectedPlayer(player);
        setIsConfirmOpen(true);
    };

    const handleConfirmClear = async () => {
        if (!selectedPlayer || !user) return;

        setIsClearing(true);
        try {
            const token = await user.getIdToken();

            // 1. Call server endpoint
            let serverSuccess = false;
            try {
                const res = await fetch("/api/admin/clear-redflag", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ targetUid: selectedPlayer.id }),
                });
                const resData = await res.json();
                if (res.ok && resData.success) {
                    serverSuccess = true;
                }
            } catch (err) {
                console.warn("Server clear-redflag API call failed, falling back to direct Firestore update", err);
            }

            // 2. Direct Firestore update as safety fallback/sync (allowed by isAdmin security rules)
            if (!serverSuccess) {
                const userDocRef = doc(db, "users", selectedPlayer.id);
                await updateDoc(userDocRef, {
                    redflagged: false,
                    redflaggedAt: null,
                    redflagReason: null,
                    redflagEventId: null,
                });
            }

            // 3. Immediately update UI state
            setPlayers((prev) => prev.filter((p) => p.id !== selectedPlayer.id));
            showToast(
                `Red flag cleared for ${selectedPlayer.displayName || selectedPlayer.fullName || "player"}`,
                "success"
            );
            setIsConfirmOpen(false);
            setSelectedPlayer(null);
        } catch (error) {
            console.error("Failed to clear red flag:", error);
            showToast(
                error instanceof Error ? error.message : "Failed to clear red flag status.",
                "error"
            );
        } finally {
            setIsClearing(false);
        }
    };

    const getPlayerName = (p: RedFlaggedUser) =>
        p.displayName || p.fullName || p.fullname || "Unnamed Player";

    const getPlayerAvatar = (p: RedFlaggedUser) =>
        p.photoURL || p.photoUrl || "";

    const formatAppliedDate = (raw: unknown) => {
        const d = parseFirebaseDate(raw);
        if (!d) return "Not recorded";
        return format(d, "MMM dd, yyyy 'at' hh:mm a");
    };

    return (
        <div className="min-h-screen bg-black text-white pb-24 relative">
            {/* Background Gradient */}
            <div className="fixed inset-0 z-0 bg-linear-to-b from-gray-900 via-black to-black" />

            <Header user={user} showBack={true} onBack={() => router.push("/admin")} />

            <main className="relative z-10 pt-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
                {/* Top Navigation & Title */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push("/admin")}
                                className="text-gray-400 hover:text-white p-0 h-auto font-normal gap-1"
                            >
                                <ArrowLeft className="w-4 h-4" /> Admin Console
                            </Button>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                                <ShieldAlert className="w-6 h-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2.5">
                                    Red-Flagged Players
                                    <Badge variant="destructive" className="bg-red-500/20 text-red-400 border-red-500/30">
                                        {players.length} Active
                                    </Badge>
                                </h1>
                                <p className="text-sm text-gray-400">
                                    Players currently restricted from registering due to late withdrawals or infractions.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Search by player name, email, ID, or reason..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 bg-gray-900/80 border-gray-800 text-white placeholder:text-gray-500 rounded-xl focus:border-red-500/50"
                    />
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                        <p className="text-sm text-gray-400">Loading red-flagged players...</p>
                    </div>
                ) : filteredPlayers.length === 0 ? (
                    <Card className="bg-gray-900/50 border-gray-800 text-center py-16 px-4">
                        <CardContent className="space-y-4">
                            <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 mx-auto flex items-center justify-center">
                                <UserCheck className="w-7 h-7" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold text-white">
                                    {searchQuery ? "No matching players found" : "No Red-Flagged Players"}
                                </h3>
                                <p className="text-sm text-gray-400 max-w-md mx-auto">
                                    {searchQuery
                                        ? "Try adjusting your search criteria."
                                        : "All players currently have clean records with full participation privileges."}
                                </p>
                            </div>
                            {searchQuery && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSearchQuery("")}
                                    className="border-gray-700 text-gray-300 hover:text-white"
                                >
                                    Clear search
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredPlayers.map((player) => {
                            const name = getPlayerName(player);
                            const avatar = getPlayerAvatar(player);
                            const appliedTimeStr = formatAppliedDate(player.redflaggedAt);

                            return (
                                <Card
                                    key={player.id}
                                    className="bg-gray-900/80 border-gray-800 hover:border-red-500/30 transition-all rounded-xl overflow-hidden"
                                >
                                    <CardContent className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        {/* Player Details */}
                                        <div className="flex items-start gap-4">
                                            <div className="relative shrink-0">
                                                <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-800 border-2 border-red-500/40 flex items-center justify-center text-white font-bold">
                                                    {avatar ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={avatar}
                                                            alt={name}
                                                            className="w-full h-full object-cover"
                                                            referrerPolicy="no-referrer"
                                                        />
                                                    ) : (
                                                        name.charAt(0).toUpperCase()
                                                    )}
                                                </div>
                                                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-gray-950 flex items-center justify-center">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                                </span>
                                            </div>

                                            <div className="space-y-1.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="text-base sm:text-lg font-semibold text-white">
                                                        {name}
                                                    </h3>
                                                    <Badge className="bg-red-500/20 text-red-400 border border-red-500/30 text-xs">
                                                        Suspended
                                                    </Badge>
                                                </div>

                                                <p className="text-xs font-mono text-gray-500">
                                                    ID: {player.id}
                                                    {player.email ? ` • ${player.email}` : ""}
                                                </p>

                                                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 pt-1">
                                                    <span className="inline-flex items-center gap-1.5 bg-gray-950/60 px-2.5 py-1 rounded-md border border-gray-800">
                                                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                                        <span className="text-gray-300 font-medium">
                                                            Reason:
                                                        </span>{" "}
                                                        <span className="text-red-300">
                                                            {player.redflagReason || "Late withdrawal infraction"}
                                                        </span>
                                                    </span>

                                                    <span className="inline-flex items-center gap-1.5 bg-gray-950/60 px-2.5 py-1 rounded-md border border-gray-800">
                                                        <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                        <span>Applied: {appliedTimeStr}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action Button */}
                                        <div className="flex md:flex-col items-center md:items-end justify-end shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-800">
                                            <Button
                                                onClick={() => handleOpenClearDialog(player)}
                                                className="bg-green-600 hover:bg-green-500 text-white font-medium text-sm rounded-lg shadow-sm w-full md:w-auto"
                                            >
                                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                                Clear Red Flag
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Confirmation Dialog */}
            <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                <DialogContent className="bg-gray-950 border-gray-800 text-white max-w-md sm:rounded-xl">
                    <DialogHeader className="space-y-3">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 flex items-center justify-center">
                            <CheckCircle2 className="w-6 h-6" />
                        </div>
                        <DialogTitle className="text-xl font-bold text-white">
                            Clear Red Flag?
                        </DialogTitle>
                        <DialogDescription className="text-sm text-gray-400">
                            Are you sure you want to clear the red-flag status for{" "}
                            <span className="font-semibold text-white">
                                {selectedPlayer ? getPlayerName(selectedPlayer) : "this player"}
                            </span>
                            ?
                        </DialogDescription>
                    </DialogHeader>

                    {selectedPlayer && (
                        <div className="p-3 rounded-lg bg-gray-900 border border-gray-800 space-y-1.5 text-xs">
                            <div className="flex justify-between text-gray-400">
                                <span>Player ID:</span>
                                <span className="font-mono text-gray-300">{selectedPlayer.id}</span>
                            </div>
                            <div className="flex justify-between text-gray-400">
                                <span>Current Reason:</span>
                                <span className="text-red-300 font-medium">
                                    {selectedPlayer.redflagReason || "Late withdrawal"}
                                </span>
                            </div>
                            <p className="text-gray-400 pt-1 text-[11px]">
                                This will update the player&apos;s record in the database and immediately restore their ability to register for events and invite partners.
                            </p>
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsConfirmOpen(false)}
                            disabled={isClearing}
                            className="border-gray-800 text-gray-300 hover:bg-gray-900 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirmClear}
                            disabled={isClearing}
                            className="bg-green-600 hover:bg-green-500 text-white font-medium"
                        >
                            {isClearing ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Clearing...
                                </>
                            ) : (
                                "Yes, Clear Red Flag"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <BottomNav />
        </div>
    );
}

export default withAdminProtection(RedFlaggedPlayersPage);

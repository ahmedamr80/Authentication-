"use client";

import { useState, useEffect, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import {
    collection,
    doc,
    query,
    where,
    getDocs,
    getDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { EventData, User as FirestoreUser } from "@/types";
import {
    TournamentDocument,
    TournamentMatch,
    TournamentPair,
    TournamentParticipant,
    TournamentStatus,
} from "@/lib/tournaments/types";
import { calculatePairStandings, calculatePlayerStandings } from "@/lib/tournaments/standingsCalculator";
import { updateBracketProgression, syncQualifiersFromGroups } from "@/lib/tournaments/bracketManager";
import { cleanForFirestore } from "@/lib/tournaments/firestoreUtils";
import { BracketSlot } from "@/lib/tournaments/engines/knockoutEngine";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Trophy,
    ArrowLeft,
    Clock,
    Activity,
    RotateCcw,
    AlertTriangle,
    ShieldAlert,
    CheckCircle2,
    Flame,
    Trash2,
    Unlock,
    Loader2,
} from "lucide-react";

export default function TournamentWorkspacePage({
    params,
}: {
    params: Promise<{ eventId: string }>;
}) {
    const { eventId } = use(params);
    const router = useRouter();
    const { user, isAdmin, loading: authLoading } = useAuth();
    const { showToast } = useToast();

    // Data States
    const [loading, setLoading] = useState(true);
    const [event, setEvent] = useState<EventData | null>(null);
    const [tournament, setTournament] = useState<TournamentDocument | null>(null);
    const [matches, setMatches] = useState<TournamentMatch[]>([]);
    const [bracketSlots, setBracketSlots] = useState<BracketSlot[]>([]);
    const [stages, setStages] = useState<any[]>([]);
    const [userProfiles, setUserProfiles] = useState<Record<string, FirestoreUser>>({});

    // Active View / Subfilters
    const [activeTab, setActiveTab] = useState<"schedule" | "standings" | "bracket" | "admin">("schedule");
    const [selectedRoundFilter, setSelectedRoundFilter] = useState<string>("ALL");
    const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>("ALL");

    // Dialog Confirmation States
    const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
    const [resetScoresDialogOpen, setResetScoresDialogOpen] = useState(false);
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    // 1. Fetch Event and subscribe real-time to Tournament Document
    useEffect(() => {
        let isMounted = true;

        async function fetchEvent() {
            try {
                const eventRef = doc(db, "events", eventId);
                const eventSnap = await getDoc(eventRef);
                if (eventSnap.exists() && isMounted) {
                    setEvent({ eventId: eventSnap.id, ...eventSnap.data() } as unknown as EventData);
                }
            } catch (err) {
                console.error("Error fetching event in workspace:", err);
            }
        }

        fetchEvent();

        // Subscribe to tournament document linked to this event
        const qTourney = query(
            collection(db, "tournaments"),
            where("eventId", "==", eventId)
        );

        const unsub = onSnapshot(
            qTourney,
            (snap) => {
                if (!isMounted) return;
                if (snap.empty) {
                    setTournament(null);
                    setLoading(false);
                    return;
                }

                const docData = snap.docs[0].data();
                const tDoc: TournamentDocument = {
                    id: snap.docs[0].id,
                    ...docData,
                } as unknown as TournamentDocument;

                setTournament(tDoc);
                setMatches(docData.matches || []);
                setBracketSlots(docData.bracketSlots || []);
                setStages(docData.stages || []);
                setLoading(false);
            },
            (err) => {
                console.error("Error listening to tournament:", err);
                if (isMounted) setLoading(false);
            }
        );

        return () => {
            isMounted = false;
            unsub();
        };
    }, [eventId]);

    // Fetch missing user profiles for tournament competitors
    useEffect(() => {
        if (!tournament) return;
        const uids = new Set<string>();

        tournament.participants?.forEach((p) => {
            if (p.uid) uids.add(p.uid);
            if (typeof p.id === "string") uids.add(p.id);
        });

        tournament.pairs?.forEach((pair) => {
            pair.playerIds?.forEach((pid) => {
                if (typeof pid === "string") uids.add(pid);
            });
        });

        matches.forEach((m) => {
            m.team1PlayerIds?.forEach((pid) => {
                if (typeof pid === "string") uids.add(pid);
            });
            m.team2PlayerIds?.forEach((pid) => {
                if (typeof pid === "string") uids.add(pid);
            });
        });

        const missingUids = Array.from(uids).filter((u) => !userProfiles[u] && u.length > 5);
        if (missingUids.length === 0) return;

        let isSubscribed = true;
        async function loadProfiles() {
            try {
                const chunks = [];
                for (let i = 0; i < missingUids.length; i += 10) {
                    chunks.push(missingUids.slice(i, i + 10));
                }
                const map: Record<string, FirestoreUser> = {};
                for (const chunk of chunks) {
                    const qUsers = query(collection(db, "users"), where("__name__", "in", chunk));
                    const snap = await getDocs(qUsers);
                    snap.forEach((d) => {
                        map[d.id] = { uid: d.id, ...d.data() } as FirestoreUser;
                    });
                }
                if (isSubscribed) {
                    setUserProfiles((prev) => ({ ...prev, ...map }));
                }
            } catch (err) {
                console.error("Error loading user profiles in workspace:", err);
            }
        }
        loadProfiles();

        return () => {
            isSubscribed = false;
        };
    }, [tournament, matches]);

    // Helper to get player photo from profiles map or tournament document
    const getPlayerPhoto = (playerIdOrUid: string | number, fallbackPhoto?: string | null) => {
        if (fallbackPhoto) return fallbackPhoto;
        const key = String(playerIdOrUid);
        const profile = userProfiles[key];
        if (profile?.photoUrl || profile?.photoURL) return profile.photoUrl || profile.photoURL;
        const participant = tournament?.participants?.find(
            (p) => String(p.id) === key || String(p.uid) === key
        );
        if (participant?.photoURL) return participant.photoURL;
        return undefined;
    };

    const getPlayerPhotosForPair = (pairId: string) => {
        const pair = tournament?.pairs?.find((p) => p.pairId === pairId);
        if (!pair) return [];
        if (pair.playerPhotos && pair.playerPhotos.length > 0) return pair.playerPhotos;
        return pair.playerIds.map((pid) => getPlayerPhoto(pid));
    };

    // Admin authorization check
    const isAuthorizedAdmin = useMemo(() => {
        if (!user || !event) return false;
        return isAdmin || event.adminId === user.uid;
    }, [user, event, isAdmin]);

    // Live calculated player standings
    const playerStandings = useMemo(() => {
        if (!tournament) return [];
        return calculatePlayerStandings(
            tournament.participants || [],
            matches,
            selectedGroupFilter
        );
    }, [tournament, matches, selectedGroupFilter]);

    // Live calculated pair/team standings
    const pairStandings = useMemo(() => {
        if (!tournament || !tournament.pairs) return [];
        return calculatePairStandings(
            tournament.pairs,
            matches,
            selectedGroupFilter
        );
    }, [tournament, matches, selectedGroupFilter]);

    // Save single match score update to Firestore
    const handleScoreChange = async (
        matchId: string,
        scoreA: number,
        scoreB: number,
        status: TournamentMatch["result"]["status"] = "completed",
        winnerOverride?: "Side A" | "Side B" | "Draw"
    ) => {
        if (!tournament || !isAuthorizedAdmin) return;
        if (tournament.status === "completed") {
            showToast("Tournament is completed. Reopen tournament from Admin tab to edit scores.", "warning");
            return;
        }

        const updatedMatches = matches.map((m) => {
            if (m.matchId !== matchId) return m;

            let winner = winnerOverride || null;
            if (!winner) {
                if (scoreA > scoreB) winner = "Side A";
                else if (scoreB > scoreA) winner = "Side B";
                else winner = "Draw";
            }

            return {
                ...m,
                result: {
                    ...m.result,
                    scoreA,
                    scoreB,
                    status,
                    winner,
                },
            };
        });

        // If knockout bracket exists, evaluate progression
        let updatedBracket = [...bracketSlots];
        if (tournament.pairs && updatedBracket.length > 0) {
            updateBracketProgression(updatedBracket, updatedMatches, tournament.pairs);
        }

        setMatches(updatedMatches);
        setBracketSlots(updatedBracket);

        try {
            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(tRef, cleanForFirestore({
                matches: updatedMatches,
                bracketSlots: updatedBracket,
                updatedAt: serverTimestamp(),
            }));
        } catch (err: any) {
            console.error("Error saving match score:", err);
            showToast("Failed to save score update.", "error");
        }
    };

    // Quick Score Increment
    const adjustScore = (matchId: string, side: "A" | "B", delta: number) => {
        const m = matches.find((x) => x.matchId === matchId);
        if (!m) return;
        const currentA = m.result.scoreA || 0;
        const currentB = m.result.scoreB || 0;
        const nextA = side === "A" ? Math.max(0, currentA + delta) : currentA;
        const nextB = side === "B" ? Math.max(0, currentB + delta) : currentB;
        handleScoreChange(matchId, nextA, nextB, "completed");
    };

    // Award Walkover
    const handleWalkover = (matchId: string, winnerSide: "Side A" | "Side B") => {
        const scoreA = winnerSide === "Side A" ? 6 : 0;
        const scoreB = winnerSide === "Side B" ? 6 : 0;
        handleScoreChange(matchId, scoreA, scoreB, "walkover", winnerSide);
        showToast(`Walkover awarded to ${winnerSide}.`, "info");
    };

    // Reset single match to not started
    const handleResetMatch = (matchId: string) => {
        handleScoreChange(matchId, 0, 0, "not_started", "Draw");
        showToast("Match reset.", "info");
    };

    // Sync Qualifiers to Knockout Bracket (Hybrid mode)
    const handleSyncQualifiers = async () => {
        if (!tournament || !tournament.pairs) return;
        try {
            setActionLoading(true);
            const groups = (tournament as any).groups || [];
            const updatedSlots = [...bracketSlots];
            const updatedMatches = [...matches];

            const count = syncQualifiersFromGroups(
                groups,
                updatedSlots,
                updatedMatches,
                tournament.pairs
            );

            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(tRef, cleanForFirestore({
                bracketSlots: updatedSlots,
                matches: updatedMatches,
                updatedAt: serverTimestamp(),
            }));

            setBracketSlots(updatedSlots);
            setMatches(updatedMatches);
            showToast(`Synced ${count} advancing qualifiers into the playoff bracket!`, "success");
        } catch (err: any) {
            console.error("Error syncing qualifiers:", err);
            showToast("Failed to sync qualifiers.", "error");
        } finally {
            setActionLoading(false);
        }
    };

    // Status Transitions: Launch (active) or Finalize (completed)
    const handleSetStatus = async (newStatus: TournamentStatus) => {
        if (!tournament || !isAuthorizedAdmin) return;
        try {
            setActionLoading(true);
            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(tRef, {
                status: newStatus,
                updatedAt: serverTimestamp(),
            });
            showToast(`Tournament is now ${newStatus.toUpperCase()}.`, "success");
        } catch (err: any) {
            console.error("Error updating tournament status:", err);
            showToast("Failed to update status.", "error");
        } finally {
            setActionLoading(false);
        }
    };

    // Protected Reopening (with Audit Warning)
    const handleConfirmReopen = async () => {
        if (!tournament || !isAuthorizedAdmin) return;
        try {
            setActionLoading(true);
            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(tRef, {
                status: "active",
                updatedAt: serverTimestamp(),
            });
            setReopenDialogOpen(false);
            showToast("Tournament reopened! Scores can now be edited.", "info");
        } catch (err: any) {
            console.error("Error reopening tournament:", err);
            showToast("Failed to reopen tournament.", "error");
        } finally {
            setActionLoading(false);
        }
    };

    // Reset All Scores
    const handleConfirmResetAllScores = async () => {
        if (!tournament || !isAuthorizedAdmin) return;
        try {
            setActionLoading(true);
            const resetMatches = matches.map((m) => ({
                ...m,
                result: {
                    scoreA: 0,
                    scoreB: 0,
                    status: "not_started" as const,
                    winner: null,
                },
            }));

            let resetSlots = [...bracketSlots];
            if (tournament.pairs && resetSlots.length > 0) {
                resetSlots.forEach((s) => {
                    s.winnerPairId = null;
                });
                updateBracketProgression(resetSlots, resetMatches, tournament.pairs);
            }

            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(tRef, cleanForFirestore({
                matches: resetMatches,
                bracketSlots: resetSlots,
                updatedAt: serverTimestamp(),
            }));

            setMatches(resetMatches);
            setBracketSlots(resetSlots);
            setResetScoresDialogOpen(false);
            showToast("All match scores have been reset to 0-0.", "info");
        } catch (err: any) {
            console.error("Error resetting all scores:", err);
            showToast("Failed to reset scores.", "error");
        } finally {
            setActionLoading(false);
        }
    };

    // Delete Tournament
    const handleConfirmDeleteTournament = async () => {
        if (!tournament || !isAuthorizedAdmin) return;
        try {
            setActionLoading(true);
            const tRef = doc(db, "tournaments", tournament.id);
            await deleteDoc(tRef);
            setCancelDialogOpen(false);
            showToast("Tournament deleted successfully.", "success");
            router.push(`/events/${eventId}`);
        } catch (err: any) {
            console.error("Error deleting tournament:", err);
            showToast("Failed to delete tournament.", "error");
        } finally {
            setActionLoading(false);
        }
    };

    if (loading || authLoading) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.push(`/events/${eventId}`)} />
                <div className="flex-1 flex flex-col items-center justify-center p-6 pt-24 sm:pt-28 text-center">
                    <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
                    <p className="text-slate-400 font-medium">Opening Tournament Workspace...</p>
                </div>
                <BottomNav />
            </div>
        );
    }

    if (!tournament) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.push(`/events/${eventId}`)} />
                <div className="flex-1 max-w-lg mx-auto p-6 pt-24 sm:pt-28 flex flex-col items-center justify-center text-center">
                    <Trophy className="w-16 h-16 text-slate-600 mb-4" />
                    <h1 className="text-2xl font-bold text-white mb-2">No Active Tournament</h1>
                    <p className="text-slate-400 mb-6 text-sm">
                        A tournament has not been generated for this event yet.
                    </p>
                    {isAuthorizedAdmin && (
                        <Button
                            onClick={() => router.push(`/events/${eventId}/tournament/create`)}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                        >
                            Create a Tournament
                        </Button>
                    )}
                </div>
                <BottomNav />
            </div>
        );
    }

    const totalRounds = tournament.config.numRounds || 1;
    const hasBracket = tournament.mode === "knockout" || tournament.mode === "round_robin_knockout";

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
            <Header user={user} showBack={true} onBack={() => router.push(`/events/${eventId}`)} />

            <main className="flex-1 max-w-5xl mx-auto w-full px-4 pt-24 sm:pt-28 pb-28">
                {/* Workspace Header Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6 shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => router.push(`/events/${eventId}`)}
                                className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition-colors"
                                aria-label="Return to Event"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                            <div>
                                <div className="flex items-center gap-2">
                                    <Badge
                                        className={
                                            tournament.status === "completed"
                                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]"
                                                : tournament.status === "active"
                                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]"
                                                : "bg-slate-800 text-slate-300 border-slate-700 text-[10px]"
                                        }
                                    >
                                        {tournament.status.toUpperCase()}
                                    </Badge>
                                    <Badge className="bg-slate-950 text-slate-300 border-slate-800 text-[10px] capitalize">
                                        {tournament.mode.replace(/_/g, " ")}
                                    </Badge>
                                    {!isAuthorizedAdmin && (
                                        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">
                                            Spectator (Read-Only)
                                        </Badge>
                                    )}
                                </div>
                                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-1">
                                    {tournament.title}
                                </h1>
                            </div>
                        </div>

                        {/* Top quick stats */}
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 font-semibold text-slate-300">
                                {tournament.config.numCourts} Courts
                            </span>
                            <span className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 font-semibold text-slate-300">
                                {matches.length} Matches
                            </span>
                            <span className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 font-semibold text-slate-300">
                                {tournament.participants.length} Competitors
                            </span>
                        </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="flex items-center justify-between pt-4">
                        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                            <button
                                onClick={() => setActiveTab("schedule")}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                                    activeTab === "schedule"
                                        ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                                        : "bg-slate-950/60 border border-slate-800/80 text-slate-400 hover:text-white"
                                }`}
                            >
                                <Clock className="w-3.5 h-3.5" /> Schedule & Scores
                            </button>

                            <button
                                onClick={() => setActiveTab("standings")}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                                    activeTab === "standings"
                                        ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                                        : "bg-slate-950/60 border border-slate-800/80 text-slate-400 hover:text-white"
                                }`}
                            >
                                <Trophy className="w-3.5 h-3.5" /> Standings
                            </button>

                            {hasBracket && (
                                <button
                                    onClick={() => setActiveTab("bracket")}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                                        activeTab === "bracket"
                                            ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                                            : "bg-slate-950/60 border border-slate-800/80 text-slate-400 hover:text-white"
                                    }`}
                                >
                                    <Flame className="w-3.5 h-3.5" /> Playoff Bracket
                                </button>
                            )}

                            {isAuthorizedAdmin && (
                                <button
                                    onClick={() => setActiveTab("admin")}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                                        activeTab === "admin"
                                            ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                                            : "bg-slate-950/60 border border-slate-800/80 text-slate-400 hover:text-white"
                                    }`}
                                >
                                    <Activity className="w-3.5 h-3.5" /> Admin Controls
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* TAB 1: SCHEDULE & LIVE SCORES */}
                {activeTab === "schedule" && (
                    <div className="space-y-6">
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                            <button
                                onClick={() => setSelectedRoundFilter("ALL")}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
                                    selectedRoundFilter === "ALL"
                                        ? "bg-slate-800 text-white font-bold"
                                        : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
                                }`}
                            >
                                All Rounds
                            </button>
                            {Array.from({ length: totalRounds }).map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setSelectedRoundFilter(String(idx))}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
                                        selectedRoundFilter === String(idx)
                                            ? "bg-slate-800 text-white font-bold"
                                            : "bg-slate-900/60 text-slate-400 hover:text-slate-200"
                                    }`}
                                >
                                    Round {idx + 1}
                                </button>
                            ))}
                        </div>

                        <div className="space-y-6">
                            {Array.from({ length: totalRounds }).map((_, rIdx) => {
                                if (selectedRoundFilter !== "ALL" && selectedRoundFilter !== String(rIdx)) {
                                    return null;
                                }

                                const roundMatches = matches.filter((m) => m.roundIdx === rIdx);
                                if (roundMatches.length === 0) return null;

                                return (
                                    <div key={rIdx} className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-amber-400 tracking-wider">
                                                ROUND {rIdx + 1}
                                            </span>
                                            <span className="text-xs text-slate-500 font-medium">
                                                {roundMatches.filter((m) => m.result.status === "completed" || m.result.status === "walkover").length} / {roundMatches.length} Completed
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {roundMatches.map((m) => {
                                                const res = m.result;
                                                const isCompleted = res.status === "completed" || res.status === "walkover";
                                                const isWinnerA = res.winner === "Side A";
                                                const isWinnerB = res.winner === "Side B";

                                                const teamAName = m.team1Names ? m.team1Names.join(" & ") : "Side A";
                                                const teamBName = m.team2Names ? m.team2Names.join(" & ") : "Side B";

                                                const sideAPlayers = (m.team1PlayerIds && m.team1PlayerIds.length > 0)
                                                    ? m.team1PlayerIds.map((pid, idx) => ({
                                                        id: pid,
                                                        name: m.team1Names?.[idx] || `Player ${idx + 1}`,
                                                        photo: getPlayerPhoto(pid, m.team1Photos?.[idx]),
                                                    }))
                                                    : (m.team1Names || []).map((name, idx) => ({
                                                        id: `p1-${idx}`,
                                                        name,
                                                        photo: m.team1Photos?.[idx] || getPlayerPhoto(name),
                                                    }));

                                                const sideBPlayers = (m.team2PlayerIds && m.team2PlayerIds.length > 0)
                                                    ? m.team2PlayerIds.map((pid, idx) => ({
                                                        id: pid,
                                                        name: m.team2Names?.[idx] || `Player ${idx + 1}`,
                                                        photo: getPlayerPhoto(pid, m.team2Photos?.[idx]),
                                                    }))
                                                    : (m.team2Names || []).map((name, idx) => ({
                                                        id: `p2-${idx}`,
                                                        name,
                                                        photo: m.team2Photos?.[idx] || getPlayerPhoto(name),
                                                    }));

                                                return (
                                                    <Card
                                                        key={m.matchId}
                                                        className={`bg-slate-900 border transition-all ${
                                                            isCompleted
                                                                ? "border-emerald-500/30"
                                                                : "border-slate-800"
                                                        }`}
                                                    >
                                                        <CardHeader className="p-3.5 pb-2 flex flex-row items-center justify-between border-b border-slate-800/80">
                                                            <Badge className="bg-slate-950 text-slate-400 border-slate-800 text-[10px]">
                                                                {m.courtName || `Court ${m.courtIdx + 1}`}
                                                            </Badge>

                                                            <div className="flex items-center gap-1.5">
                                                                {res.status === "walkover" ? (
                                                                    <Badge className="bg-amber-500/20 text-amber-300 text-[10px]">
                                                                        Walkover
                                                                    </Badge>
                                                                ) : isCompleted ? (
                                                                    <Badge className="bg-emerald-500/20 text-emerald-300 text-[10px]">
                                                                        Final ({res.scoreA} - {res.scoreB})
                                                                    </Badge>
                                                                ) : (
                                                                    <Badge className="bg-slate-950 text-slate-500 text-[10px]">
                                                                        Upcoming
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </CardHeader>

                                                        <CardContent className="p-3.5 space-y-2.5">
                                                            {/* Side A */}
                                                            <div
                                                                className={`p-2.5 rounded-xl border flex items-center justify-between ${
                                                                    isWinnerA
                                                                        ? "bg-emerald-950/20 border-emerald-500/40"
                                                                        : "bg-slate-950 border-slate-800/80"
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0 mr-2">
                                                                    {sideAPlayers.length > 0 && (
                                                                        <div className="flex items-center -space-x-2 shrink-0">
                                                                            {sideAPlayers.map((p, pIdx) => (
                                                                                <Avatar key={pIdx} className="h-8 w-8 sm:h-9 sm:w-9 border-2 border-slate-900 z-10 shrink-0">
                                                                                    <AvatarImage src={p.photo} alt={p.name} />
                                                                                    <AvatarFallback className="bg-slate-800 text-slate-300 text-xs font-bold">
                                                                                        {p.name?.charAt(0) || "P"}
                                                                                    </AvatarFallback>
                                                                                </Avatar>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                    <div className="truncate min-w-0">
                                                                        <span className="text-sm font-bold text-white block truncate">
                                                                            {teamAName}
                                                                        </span>
                                                                        {isWinnerA && (
                                                                            <span className="text-[10px] text-emerald-400 font-bold">
                                                                                Winner
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {isAuthorizedAdmin ? (
                                                                    <div className="flex items-center gap-1 shrink-0">
                                                                        <button
                                                                            onClick={() => adjustScore(m.matchId, "A", -1)}
                                                                            className="w-7 h-7 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold text-xs"
                                                                        >
                                                                            -
                                                                        </button>
                                                                        <input
                                                                            type="number"
                                                                            min={0}
                                                                            max={99}
                                                                            value={res.scoreA}
                                                                            onChange={(e) =>
                                                                                handleScoreChange(
                                                                                    m.matchId,
                                                                                    parseInt(e.target.value) || 0,
                                                                                    res.scoreB
                                                                                )
                                                                            }
                                                                            className="w-12 h-7 text-center bg-slate-900 border border-slate-700 text-white font-bold text-sm rounded focus:border-amber-500"
                                                                        />
                                                                        <button
                                                                            onClick={() => adjustScore(m.matchId, "A", 1)}
                                                                            className="w-7 h-7 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold text-xs"
                                                                        >
                                                                            +
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-lg font-bold text-white px-2">
                                                                        {res.scoreA}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="text-center text-[10px] font-bold text-slate-600">vs</div>

                                                            {/* Side B */}
                                                            <div
                                                                className={`p-2.5 rounded-xl border flex items-center justify-between ${
                                                                    isWinnerB
                                                                        ? "bg-emerald-950/20 border-emerald-500/40"
                                                                        : "bg-slate-950 border-slate-800/80"
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0 mr-2">
                                                                    {sideBPlayers.length > 0 && (
                                                                        <div className="flex items-center -space-x-2 shrink-0">
                                                                            {sideBPlayers.map((p, pIdx) => (
                                                                                <Avatar key={pIdx} className="h-8 w-8 sm:h-9 sm:w-9 border-2 border-slate-900 z-10 shrink-0">
                                                                                    <AvatarImage src={p.photo} alt={p.name} />
                                                                                    <AvatarFallback className="bg-slate-800 text-slate-300 text-xs font-bold">
                                                                                        {p.name?.charAt(0) || "P"}
                                                                                    </AvatarFallback>
                                                                                </Avatar>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                    <div className="truncate min-w-0">
                                                                        <span className="text-sm font-bold text-white block truncate">
                                                                            {teamBName}
                                                                        </span>
                                                                        {isWinnerB && (
                                                                            <span className="text-[10px] text-emerald-400 font-bold">
                                                                                Winner
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {isAuthorizedAdmin ? (
                                                                    <div className="flex items-center gap-1 shrink-0">
                                                                        <button
                                                                            onClick={() => adjustScore(m.matchId, "B", -1)}
                                                                            className="w-7 h-7 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold text-xs"
                                                                        >
                                                                            -
                                                                        </button>
                                                                        <input
                                                                            type="number"
                                                                            min={0}
                                                                            max={99}
                                                                            value={res.scoreB}
                                                                            onChange={(e) =>
                                                                                handleScoreChange(
                                                                                    m.matchId,
                                                                                    res.scoreA,
                                                                                    parseInt(e.target.value) || 0
                                                                                )
                                                                            }
                                                                            className="w-12 h-7 text-center bg-slate-900 border border-slate-700 text-white font-bold text-sm rounded focus:border-amber-500"
                                                                        />
                                                                        <button
                                                                            onClick={() => adjustScore(m.matchId, "B", 1)}
                                                                            className="w-7 h-7 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold text-xs"
                                                                        >
                                                                            +
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-lg font-bold text-white px-2">
                                                                        {res.scoreB}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Walkover / Reset Quick Actions for Admin */}
                                                            {isAuthorizedAdmin && (
                                                                <div className="pt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                                                                    <div className="flex gap-2 items-center">
                                                                        <button
                                                                            onClick={() => handleWalkover(m.matchId, "Side A")}
                                                                            className="px-2 py-0.5 rounded bg-slate-950 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 transition-colors border border-slate-800"
                                                                        >
                                                                            WO Side A
                                                                        </button>
                                                                        <span className="text-slate-600">•</span>
                                                                        <button
                                                                            onClick={() => handleWalkover(m.matchId, "Side B")}
                                                                            className="px-2 py-0.5 rounded bg-slate-950 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 transition-colors border border-slate-800"
                                                                        >
                                                                            WO Side B
                                                                        </button>
                                                                    </div>
                                                                    {isCompleted && (
                                                                        <button
                                                                            onClick={() => handleResetMatch(m.matchId)}
                                                                            className="px-2 py-0.5 rounded bg-slate-950 hover:bg-red-500/20 text-slate-300 hover:text-red-400 transition-colors border border-slate-800"
                                                                        >
                                                                            Reset
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </CardContent>
                                                    </Card>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* TAB 2: STANDINGS */}
                {activeTab === "standings" && (
                    <div className="space-y-6">
                        <Card className="bg-slate-900 border-slate-800 shadow-xl overflow-hidden">
                            <CardHeader className="p-4 border-b border-slate-800 flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                        <Trophy className="w-4 h-4 text-amber-400" />
                                        Official Leaderboard
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Calculated automatically with 8-tier tiebreaking and live point accumulation.
                                    </p>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0 overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-semibold uppercase tracking-wider">
                                            <th className="py-3 px-3 w-12 text-center">Rank</th>
                                            <th className="py-3 px-4">Competitor</th>
                                            <th className="py-3 px-2 text-center">P</th>
                                            <th className="py-3 px-2 text-center">W</th>
                                            <th className="py-3 px-2 text-center">D</th>
                                            <th className="py-3 px-2 text-center">L</th>
                                            <th className="py-3 px-2 text-center">GF</th>
                                            <th className="py-3 px-2 text-center">GA</th>
                                            <th className="py-3 px-2 text-center">Diff</th>
                                            <th className="py-3 px-3 text-center font-bold text-amber-400">Pts</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/80">
                                        {(tournament.unitType === "teams" ? pairStandings : playerStandings).map((row) => {
                                            const competitorPhotos: (string | null | undefined)[] =
                                                tournament.unitType === "teams"
                                                    ? row.playerPhotos && row.playerPhotos.length > 0
                                                        ? row.playerPhotos
                                                        : getPlayerPhotosForPair(String(row.id))
                                                    : [row.photoURL || getPlayerPhoto(row.id)];

                                            return (
                                                <tr
                                                    key={String(row.id)}
                                                    className={`transition-colors ${
                                                        row.rank === 1
                                                            ? "bg-amber-500/10 hover:bg-amber-500/15"
                                                            : "hover:bg-slate-800/40"
                                                    }`}
                                                >
                                                    <td className="py-3 px-3 text-center font-bold text-slate-300">
                                                        {row.rank === 1 ? "🥇 1" : row.rank === 2 ? "🥈 2" : row.rank === 3 ? "🥉 3" : row.rank}
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div className="flex items-center -space-x-2 shrink-0">
                                                                {competitorPhotos.map((photo, pIdx) => (
                                                                    <Avatar key={pIdx} className="h-7 w-7 border-2 border-slate-900 z-10 shrink-0">
                                                                        <AvatarImage src={photo || undefined} alt={row.name} />
                                                                        <AvatarFallback className="bg-slate-800 text-slate-300 text-[10px] font-bold">
                                                                            {row.name?.charAt(0) || "P"}
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                ))}
                                                            </div>
                                                            <span className="font-bold text-white truncate max-w-[180px]">
                                                                {row.name}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-2 text-center text-slate-400">{row.played}</td>
                                                    <td className="py-3 px-2 text-center text-emerald-400 font-semibold">{row.wins}</td>
                                                    <td className="py-3 px-2 text-center text-slate-400">{row.draws}</td>
                                                    <td className="py-3 px-2 text-center text-red-400">{row.losses}</td>
                                                    <td className="py-3 px-2 text-center text-slate-400">{row.gf}</td>
                                                    <td className="py-3 px-2 text-center text-slate-400">{row.ga}</td>
                                                    <td
                                                        className={`py-3 px-2 text-center font-semibold ${
                                                            row.diff > 0
                                                                ? "text-emerald-400"
                                                                : row.diff < 0
                                                                ? "text-red-400"
                                                                : "text-slate-400"
                                                        }`}
                                                    >
                                                        {row.diff > 0 ? `+${row.diff}` : row.diff}
                                                    </td>
                                                    <td className="py-3 px-3 text-center font-bold text-amber-400 text-sm">
                                                        {row.points}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* TAB 3: PLAYOFF BRACKET */}
                {activeTab === "bracket" && hasBracket && (
                    <div className="space-y-6">
                        {tournament.mode === "round_robin_knockout" && isAuthorizedAdmin && (
                            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                                <div>
                                    <span className="text-sm font-bold text-white block">Group Qualifiers Synchronization</span>
                                    <span className="text-xs text-slate-400">
                                        Populate the playoff bracket automatically from final group stage rankings.
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    disabled={actionLoading}
                                    onClick={handleSyncQualifiers}
                                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs h-9"
                                >
                                    Sync Qualifiers from Groups
                                </Button>
                            </div>
                        )}

                        <div className="space-y-4">
                            {stages.map((stage) => {
                                const stageSlots = bracketSlots.filter((s) => s.stageId === stage.stageId);
                                if (stageSlots.length === 0) return null;

                                return (
                                    <div key={stage.stageId} className="space-y-3">
                                        <div className="text-xs font-bold text-amber-400 tracking-wider uppercase">
                                            {stage.stageId.replace(/_/g, " ")}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {stageSlots.map((slot) => {
                                                const pairA = tournament.pairs?.find((p) => p.pairId === slot.resolvedPairAId);
                                                const pairB = tournament.pairs?.find((p) => p.pairId === slot.resolvedPairBId);
                                                const isBye = slot.winnerPairId && (!slot.resolvedPairAId || !slot.resolvedPairBId);

                                                const matchObj = matches.find((m) => m.matchId === slot.matchId);
                                                const isWinnerA = slot.winnerPairId && pairA && slot.winnerPairId === pairA.pairId;
                                                const isWinnerB = slot.winnerPairId && pairB && slot.winnerPairId === pairB.pairId;

                                                return (
                                                    <div
                                                        key={slot.slotId}
                                                        className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs"
                                                    >
                                                        <div className="flex justify-between items-center text-[10px] text-slate-500 font-semibold">
                                                            <span>{slot.slotId}</span>
                                                            {isBye && <Badge className="bg-slate-800 text-slate-400">BYE</Badge>}
                                                        </div>

                                                        <div
                                                            className={`p-2 rounded-lg border flex items-center justify-between ${
                                                                isWinnerA
                                                                    ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300 font-bold"
                                                                    : "bg-slate-950 border-slate-800 text-slate-200"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2 min-w-0 mr-2">
                                                                {pairA && (
                                                                    <div className="flex items-center -space-x-1.5 shrink-0">
                                                                        {getPlayerPhotosForPair(pairA.pairId).map((photo, pIdx) => (
                                                                            <Avatar key={pIdx} className="h-6 w-6 border border-slate-900 z-10 shrink-0">
                                                                                <AvatarImage src={photo || undefined} alt={pairA.pairName} />
                                                                                <AvatarFallback className="bg-slate-800 text-slate-300 text-[9px] font-bold">
                                                                                    {pairA.pairName?.charAt(0) || "P"}
                                                                                </AvatarFallback>
                                                                            </Avatar>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <span className="truncate">{pairA ? pairA.pairName : "TBD"}</span>
                                                            </div>
                                                            <span className="shrink-0">{matchObj ? matchObj.result.scoreA : 0}</span>
                                                        </div>

                                                        <div
                                                            className={`p-2 rounded-lg border flex items-center justify-between ${
                                                                isWinnerB
                                                                    ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300 font-bold"
                                                                    : "bg-slate-950 border-slate-800 text-slate-200"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2 min-w-0 mr-2">
                                                                {pairB && (
                                                                    <div className="flex items-center -space-x-1.5 shrink-0">
                                                                        {getPlayerPhotosForPair(pairB.pairId).map((photo, pIdx) => (
                                                                            <Avatar key={pIdx} className="h-6 w-6 border border-slate-900 z-10 shrink-0">
                                                                                <AvatarImage src={photo || undefined} alt={pairB.pairName} />
                                                                                <AvatarFallback className="bg-slate-800 text-slate-300 text-[9px] font-bold">
                                                                                    {pairB.pairName?.charAt(0) || "P"}
                                                                                </AvatarFallback>
                                                                            </Avatar>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <span className="truncate">{pairB ? pairB.pairName : "TBD"}</span>
                                                            </div>
                                                            <span className="shrink-0">{matchObj ? matchObj.result.scoreB : 0}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* TAB 4: ADMIN CONTROLS */}
                {activeTab === "admin" && isAuthorizedAdmin && (
                    <div className="space-y-6">
                        <Card className="bg-slate-900 border-slate-800">
                            <CardHeader className="pb-3 border-b border-slate-800">
                                <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-amber-400" />
                                    Tournament Lifecycle
                                </CardTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Control status progression: Draft → Active → Completed.
                                </p>
                            </CardHeader>
                            <CardContent className="p-4 space-y-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    {tournament.status === "draft" && (
                                        <Button
                                            onClick={() => handleSetStatus("active")}
                                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                                        >
                                            <Trophy className="w-4 h-4 mr-1.5" /> Start & Launch Tournament
                                        </Button>
                                    )}

                                    {tournament.status === "active" && (
                                        <Button
                                            onClick={() => handleSetStatus("completed")}
                                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                                        >
                                            <CheckCircle2 className="w-4 h-4 mr-1.5" /> Finalize Tournament
                                        </Button>
                                    )}

                                    {tournament.status === "completed" && (
                                        <Button
                                            onClick={() => setReopenDialogOpen(true)}
                                            variant="outline"
                                            className="bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 text-xs font-semibold"
                                        >
                                            <Unlock className="w-4 h-4 mr-1.5" /> Reopen Tournament (Protected)
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-slate-900 border-slate-800">
                            <CardHeader className="pb-3 border-b border-slate-800">
                                <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                    <RotateCcw className="w-4 h-4 text-amber-400" />
                                    Match Score Reset & Regeneration Guard
                                </CardTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Regenerating matches or altering tournament structure is blocked if any match has recorded scores.
                                </p>
                            </CardHeader>
                            <CardContent className="p-4 space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                                    <div>
                                        <span className="text-sm font-semibold text-white block">Reset All Match Scores</span>
                                        <span className="text-xs text-slate-400">
                                            Clears all recorded scores back to 0-0 and unlocks match regeneration.
                                        </span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setResetScoresDialogOpen(true)}
                                        className="bg-slate-900 border-amber-500/50 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 text-xs shrink-0 font-semibold"
                                    >
                                        Reset All Scores
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-slate-900 border-red-500/30">
                            <CardHeader className="pb-3 border-b border-slate-800">
                                <CardTitle className="text-base font-bold text-red-400 flex items-center gap-2">
                                    <Trash2 className="w-4 h-4 text-red-400" />
                                    Danger Zone
                                </CardTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Irreversible action. Deletes this tournament document permanently.
                                </p>
                            </CardHeader>
                            <CardContent className="p-4">
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => setCancelDialogOpen(true)}
                                    className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs"
                                >
                                    Delete Tournament
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </main>

            {/* CONFIRMATION DIALOG: PROTECTED REOPENING */}
            <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
                    <DialogHeader>
                        <DialogTitle className="text-amber-400 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-400" />
                            Reopen Completed Tournament?
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 text-xs leading-relaxed pt-2">
                            This tournament is marked as completed. Reopening it will allow scores to be modified, which automatically recalculates official standings and podium rankings.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-4">
                        <Button
                            variant="outline"
                            onClick={() => setReopenDialogOpen(false)}
                            className="bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={actionLoading}
                            onClick={handleConfirmReopen}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                        >
                            Confirm Reopen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* CONFIRMATION DIALOG: RESET SCORES */}
            <Dialog open={resetScoresDialogOpen} onOpenChange={setResetScoresDialogOpen}>
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
                    <DialogHeader>
                        <DialogTitle className="text-amber-400 flex items-center gap-2">
                            <RotateCcw className="w-5 h-5 text-amber-400" />
                            Reset All Match Scores?
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 text-xs leading-relaxed pt-2">
                            This will clear all game scores and walkovers back to 0-0 for every match in this tournament. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-4">
                        <Button
                            variant="outline"
                            onClick={() => setResetScoresDialogOpen(false)}
                            className="bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={actionLoading}
                            onClick={handleConfirmResetAllScores}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                        >
                            Reset Scores
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* CONFIRMATION DIALOG: DELETE TOURNAMENT */}
            <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
                    <DialogHeader>
                        <DialogTitle className="text-red-400 flex items-center gap-2">
                            <Trash2 className="w-5 h-5 text-red-400" />
                            Delete Tournament Permanently?
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 text-xs leading-relaxed pt-2">
                            Are you sure you want to delete this tournament? All match schedules, scores, and standings will be erased permanently.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-4">
                        <Button
                            variant="outline"
                            onClick={() => setCancelDialogOpen(false)}
                            className="bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={actionLoading}
                            onClick={handleConfirmDeleteTournament}
                            className="bg-red-600 hover:bg-red-500 text-white font-bold"
                        >
                            Delete Permanently
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <BottomNav />
        </div>
    );
}

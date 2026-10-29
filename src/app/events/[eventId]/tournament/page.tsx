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
    CanonicalMatchStatus,
    SetScore,
    TournamentDocument,
    TournamentMatch,
    TournamentStatus,
    createInitialSets,
    evaluateMatchSets,
    isMatchClosed,
    normalizeMatchStatus,
} from "@/lib/tournaments/types";
import { calculatePairStandings, calculatePlayerStandings } from "@/lib/tournaments/standingsCalculator";
import { updateBracketProgression, syncQualifiersFromGroups } from "@/lib/tournaments/bracketManager";
import {
    buildTeamTournamentSummary,
    resolveMatchSideTeamId,
} from "@/lib/tournaments/teamMatchesQuery";
import { cleanForFirestore } from "@/lib/tournaments/firestoreUtils";
import { BracketSlot } from "@/lib/tournaments/engines/knockoutEngine";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
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
    CheckCircle2,
    Flame,
    Trash2,
    Unlock,
    Loader2,
    Printer,
    ExternalLink,
    Users,
    Sliders,
    Lock,
    Play,
} from "lucide-react";

interface OngoingMatchDraft {
    sets: SetScore[];
    tieBreakOpen: Record<number, boolean>;
}

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

    // Local Ongoing Draft State (retains score inputs locally while status === ONGOING without writing to Firestore until CLOSED)
    const [localMatchStatuses, setLocalMatchStatuses] = useState<Record<string, CanonicalMatchStatus>>({});
    const [ongoingDrafts, setOngoingDrafts] = useState<Record<string, OngoingMatchDraft>>({});

    // Active View / Subfilters
    const [activeTab, setActiveTab] = useState<"schedule" | "standings" | "bracket" | "admin">("schedule");
    const [selectedRoundFilter, setSelectedRoundFilter] = useState<string>("ALL");
    const [selectedGroupFilter] = useState<string>("ALL");

    // Interactive Team Filter Modal State
    const [selectedTeamIdForModal, setSelectedTeamIdForModal] = useState<string | null>(null);

    // Print / Export PDF Modal & Options State
    const [printDialogOpen, setPrintDialogOpen] = useState(false);
    const [printIncludeStandings, setPrintIncludeStandings] = useState(true);
    const [printGrayscaleMode, setPrintGrayscaleMode] = useState(false);
    const [printGroupBy, setPrintGroupBy] = useState<"round" | "court">("round");
    const [printTimestamp, setPrintTimestamp] = useState<string>("");

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

    //Configured number of sets for this tournament (1, 3, or 5)
    const numberOfSets: 1 | 3 | 5 = useMemo(() => {
        const raw =
            tournament?.config?.numberOfSets ||
            tournament?.config?.matchFormat?.numberOfSets ||
            tournament?.matchFormat?.numberOfSets ||
            1;
        if (raw === 3 || raw === 5) return raw;
        return 1;
    }, [tournament]);

    // Helper to get normalized sets array of length `numberOfSets` for any match
    const getNormalizedMatchSets = (m: TournamentMatch, targetSetsCount: 1 | 3 | 5 = numberOfSets): SetScore[] => {
        const existing = (m.sets && m.sets.length > 0 ? m.sets : m.result?.sets) || [];
        return Array.from({ length: targetSetsCount }, (_, idx) => {
            const found = existing[idx];
            if (found) {
                return {
                    setNumber: idx + 1,
                    teamAScore: Number(found.teamAScore ?? 0),
                    teamBScore: Number(found.teamBScore ?? 0),
                    ...(found.tieBreak
                        ? {
                              tieBreak: {
                                  teamAScore: Number(found.tieBreak.teamAScore ?? 0),
                                  teamBScore: Number(found.tieBreak.teamBScore ?? 0),
                              },
                          }
                        : {}),
                };
            }
            if (idx === 0 && existing.length === 0) {
                return {
                    setNumber: 1,
                    teamAScore: Number(m.result?.scoreA ?? 0),
                    teamBScore: Number(m.result?.scoreB ?? 0),
                };
            }
            return {
                setNumber: idx + 1,
                teamAScore: 0,
                teamBScore: 0,
            };
        });
    };

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

    // Selected team summary for interactive Team Filter Modal
    const selectedTeamSummary = useMemo(() => {
        if (!tournament || !selectedTeamIdForModal) return null;
        return buildTeamTournamentSummary(
            { ...tournament, matches },
            selectedTeamIdForModal
        );
    }, [tournament, matches, selectedTeamIdForModal]);

    // Resolve effective match status (local ONGOING state takes precedence while editing)
    const getEffectiveMatchStatus = (m: TournamentMatch): CanonicalMatchStatus => {
        if (localMatchStatuses[m.matchId]) {
            return localMatchStatuses[m.matchId];
        }
        return normalizeMatchStatus(m.status ?? m.result?.status);
    };

    // Transition 1: Set Match to NOT_STARTED (resets scores to 0 / empty and locks inputs)
    const handleSetMatchNotStarted = async (m: TournamentMatch) => {
        if (!tournament || !isAuthorizedAdmin) return;
        if (tournament.status === "completed") {
            showToast("Tournament is completed. Reopen tournament from Admin tab to edit matches.", "warning");
            return;
        }

        const resetSets = createInitialSets(numberOfSets);

        // Clear local draft & set local status to NOT_STARTED
        setOngoingDrafts((prev) => {
            const next = { ...prev };
            delete next[m.matchId];
            return next;
        });
        setLocalMatchStatuses((prev) => ({
            ...prev,
            [m.matchId]: "NOT_STARTED",
        }));

        const persistedStatus = normalizeMatchStatus(m.status ?? m.result?.status);
        const hadScores =
            persistedStatus !== "NOT_STARTED" ||
            (m.result?.scoreA ?? 0) > 0 ||
            (m.result?.scoreB ?? 0) > 0;

        if (!hadScores) {
            showToast("Match set to Not Started (inputs locked).", "info");
            return;
        }

        const updatedMatches: TournamentMatch[] = matches.map((item) => {
            if (item.matchId !== m.matchId) return item;
            return {
                ...item,
                status: "NOT_STARTED",
                sets: resetSets,
                winnerTeamId: null,
                loserTeamId: null,
                isDraw: false,
                result: {
                    ...item.result,
                    scoreA: 0,
                    scoreB: 0,
                    sets: resetSets,
                    status: "NOT_STARTED",
                    winner: null,
                    winnerTeamId: null,
                    loserTeamId: null,
                    isDraw: false,
                },
            };
        });

        let updatedBracket = [...bracketSlots];
        if (tournament.pairs && updatedBracket.length > 0) {
            updateBracketProgression(updatedBracket, updatedMatches, tournament.pairs);
        }

        setMatches(updatedMatches);
        setBracketSlots(updatedBracket);

        try {
            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(
                tRef,
                cleanForFirestore({
                    matches: updatedMatches,
                    bracketSlots: updatedBracket,
                    updatedAt: serverTimestamp(),
                })
            );
            showToast("Match reset to Not Started.", "info");
        } catch (err) {
            console.error("Error resetting match:", err);
            showToast("Failed to reset match.", "error");
        }
    };

    // Transition 2: Set Match to ONGOING (unlocks inputs in local component state without writing to Firestore)
    const handleSetMatchOngoing = (m: TournamentMatch) => {
        if (!tournament || !isAuthorizedAdmin) return;
        if (tournament.status === "completed") {
            showToast("Tournament is completed. Reopen tournament from Admin tab to edit scores.", "warning");
            return;
        }

        const currentSets = ongoingDrafts[m.matchId]?.sets || getNormalizedMatchSets(m, numberOfSets);
        const initialTieBreakOpen: Record<number, boolean> = {};
        currentSets.forEach((s, idx) => {
            if (s.tieBreak && (s.tieBreak.teamAScore > 0 || s.tieBreak.teamBScore > 0)) {
                initialTieBreakOpen[idx] = true;
            }
        });

        setOngoingDrafts((prev) => ({
            ...prev,
            [m.matchId]: {
                sets: currentSets,
                tieBreakOpen: prev[m.matchId]?.tieBreakOpen || initialTieBreakOpen,
            },
        }));

        setLocalMatchStatuses((prev) => ({
            ...prev,
            [m.matchId]: "ONGOING",
        }));
    };

    // Update a set's score in local ONGOING draft state (does NOT write to Firestore)
    const handleUpdateDraftSetScore = (
        matchId: string,
        setIdx: number,
        side: "A" | "B",
        nextVal: number
    ) => {
        const sanitized = Math.max(0, Math.min(99, Number.isNaN(nextVal) ? 0 : nextVal));
        setOngoingDrafts((prev) => {
            const matchObj = matches.find((x) => x.matchId === matchId);
            const baseSets = prev[matchId]?.sets || (matchObj ? getNormalizedMatchSets(matchObj, numberOfSets) : createInitialSets(numberOfSets));
            const nextSets = baseSets.map((s, idx) => {
                if (idx !== setIdx) return s;
                const updated: SetScore = {
                    ...s,
                    teamAScore: side === "A" ? sanitized : s.teamAScore,
                    teamBScore: side === "B" ? sanitized : s.teamBScore,
                };
                // If scores are no longer equal, clear tieBreak unless user explicitly keeps it
                if (updated.teamAScore !== updated.teamBScore && updated.tieBreak) {
                    delete updated.tieBreak;
                }
                return updated;
            });

            return {
                ...prev,
                [matchId]: {
                    sets: nextSets,
                    tieBreakOpen: prev[matchId]?.tieBreakOpen || {},
                },
            };
        });
    };

    // Toggle Tie-Break input for a drawn set in local ONGOING draft state
    const handleToggleDraftTieBreak = (matchId: string, setIdx: number) => {
        setOngoingDrafts((prev) => {
            const currentDraft = prev[matchId];
            if (!currentDraft) return prev;
            const isCurrentlyOpen = Boolean(currentDraft.tieBreakOpen[setIdx]);
            const nextOpen = {
                ...currentDraft.tieBreakOpen,
                [setIdx]: !isCurrentlyOpen,
            };
            const nextSets = currentDraft.sets.map((s, idx) => {
                if (idx !== setIdx) return s;
                if (isCurrentlyOpen) {
                    const copy = { ...s };
                    delete copy.tieBreak;
                    return copy;
                }
                return {
                    ...s,
                    tieBreak: s.tieBreak || { teamAScore: 0, teamBScore: 0 },
                };
            });

            return {
                ...prev,
                [matchId]: {
                    sets: nextSets,
                    tieBreakOpen: nextOpen,
                },
            };
        });
    };

    // Update Tie-Break score for a drawn set in local ONGOING draft state
    const handleUpdateDraftTieBreakScore = (
        matchId: string,
        setIdx: number,
        side: "A" | "B",
        nextVal: number
    ) => {
        const sanitized = Math.max(0, Math.min(99, Number.isNaN(nextVal) ? 0 : nextVal));
        setOngoingDrafts((prev) => {
            const currentDraft = prev[matchId];
            if (!currentDraft) return prev;
            const nextSets = currentDraft.sets.map((s, idx) => {
                if (idx !== setIdx) return s;
                const existingTB = s.tieBreak || { teamAScore: 0, teamBScore: 0 };
                return {
                    ...s,
                    tieBreak: {
                        teamAScore: side === "A" ? sanitized : existingTB.teamAScore,
                        teamBScore: side === "B" ? sanitized : existingTB.teamBScore,
                    },
                };
            });

            return {
                ...prev,
                [matchId]: {
                    ...currentDraft,
                    sets: nextSets,
                },
            };
        });
    };

    // Transition 3: Set Match to CLOSED (locks inputs, evaluates sets + tie-breaks, commits to Firestore, updates standings)
    const handleSetMatchClosed = async (
        m: TournamentMatch,
        overrideSets?: SetScore[],
        walkoverWinner?: "Team 1" | "Team 2"
    ) => {
        if (!tournament || !isAuthorizedAdmin) return;
        if (tournament.status === "completed") {
            showToast("Tournament is completed. Reopen tournament from Admin tab to edit scores.", "warning");
            return;
        }

        const setsToCommit = (
            overrideSets ||
            ongoingDrafts[m.matchId]?.sets ||
            getNormalizedMatchSets(m, numberOfSets)
        ).map((s, idx) => {
            const cleaned: SetScore = {
                setNumber: idx + 1,
                teamAScore: Number(s.teamAScore ?? 0),
                teamBScore: Number(s.teamBScore ?? 0),
            };
            if (
                s.teamAScore === s.teamBScore &&
                s.tieBreak &&
                (s.tieBreak.teamAScore > 0 || s.tieBreak.teamBScore > 0)
            ) {
                cleaned.tieBreak = {
                    teamAScore: Number(s.tieBreak.teamAScore ?? 0),
                    teamBScore: Number(s.tieBreak.teamBScore ?? 0),
                };
            }
            return cleaned;
        });

        const evaluation = evaluateMatchSets(
            setsToCommit,
            setsToCommit[0]?.teamAScore ?? 0,
            setsToCommit[0]?.teamBScore ?? 0
        );

        const sideATeamId = resolveMatchSideTeamId(m, "A", tournament);
        const sideBTeamId = resolveMatchSideTeamId(m, "B", tournament);

        const finalWinnerSide = walkoverWinner || evaluation.winnerSide;
        const isDraw = !walkoverWinner && evaluation.isDraw;

        const winnerTeamId =
            finalWinnerSide === "Team 1"
                ? sideATeamId
                : finalWinnerSide === "Team 2"
                ? sideBTeamId
                : null;
        const loserTeamId =
            finalWinnerSide === "Team 1"
                ? sideBTeamId
                : finalWinnerSide === "Team 2"
                ? sideATeamId
                : null;

        const winnerLabel =
            finalWinnerSide === "Team 1"
                ? "Team 1"
                : finalWinnerSide === "Team 2"
                ? "Team 2"
                : "Draw";

        const updatedMatches: TournamentMatch[] = matches.map((item) => {
            if (item.matchId !== m.matchId) return item;
            return {
                ...item,
                tournamentId: tournament.id,
                teamAId: sideATeamId,
                teamBId: sideBTeamId,
                status: "CLOSED",
                sets: setsToCommit,
                winnerTeamId,
                loserTeamId,
                isDraw,
                result: {
                    ...item.result,
                    scoreA: evaluation.totalGamesA,
                    scoreB: evaluation.totalGamesB,
                    sets: setsToCommit,
                    status: walkoverWinner ? "walkover" : "CLOSED",
                    winner: winnerLabel,
                    winnerTeamId,
                    loserTeamId,
                    isDraw,
                    completedAt: Date.now(),
                },
            };
        });

        let updatedBracket = [...bracketSlots];
        if (tournament.pairs && updatedBracket.length > 0) {
            updateBracketProgression(updatedBracket, updatedMatches, tournament.pairs);
        }

        // Clear local draft & mark CLOSED
        setOngoingDrafts((prev) => {
            const next = { ...prev };
            delete next[m.matchId];
            return next;
        });
        setLocalMatchStatuses((prev) => ({
            ...prev,
            [m.matchId]: "CLOSED",
        }));

        setMatches(updatedMatches);
        setBracketSlots(updatedBracket);

        try {
            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(
                tRef,
                cleanForFirestore({
                    matches: updatedMatches,
                    bracketSlots: updatedBracket,
                    updatedAt: serverTimestamp(),
                })
            );
            showToast(
                isDraw
                    ? "Match closed and recorded as a Draw."
                    : `Match closed! Standings updated.`,
                "success"
            );
        } catch (err) {
            console.error("Error closing match:", err);
            showToast("Failed to save closed match to Firestore.", "error");
        }
    };

    // Award Walkover
    const handleWalkover = (m: TournamentMatch, winnerSide: "Team 1" | "Team 2") => {
        const woSets: SetScore[] = Array.from({ length: numberOfSets }, (_, idx) => ({
            setNumber: idx + 1,
            teamAScore: winnerSide === "Team 1" ? 6 : 0,
            teamBScore: winnerSide === "Team 2" ? 6 : 0,
        }));
        handleSetMatchClosed(m, woSets, winnerSide);
    };

    // Update tournament numberOfSets configuration from Admin Controls
    const handleUpdateNumberOfSets = async (nextSets: 1 | 3 | 5) => {
        if (!tournament || !isAuthorizedAdmin) return;
        try {
            setActionLoading(true);
            const matchFormat = {
                numberOfSets: nextSets,
                setsToWin: Math.ceil(nextSets / 2) as 1 | 2 | 3,
            };
            const updatedConfig = {
                ...tournament.config,
                numberOfSets: nextSets,
                matchFormat,
            };
            const updatedMatches = matches.map((m) => {
                const resizedSets = getNormalizedMatchSets(m, nextSets);
                return {
                    ...m,
                    sets: resizedSets,
                    result: {
                        ...m.result,
                        sets: resizedSets,
                    },
                };
            });

            const tRef = doc(db, "tournaments", tournament.id);
            await updateDoc(
                tRef,
                cleanForFirestore({
                    config: updatedConfig,
                    matchFormat,
                    matches: updatedMatches,
                    updatedAt: serverTimestamp(),
                })
            );
            setMatches(updatedMatches);
            showToast(`Match format updated to ${nextSets} ${nextSets === 1 ? "Set" : "Sets"}.`, "success");
        } catch (err) {
            console.error("Error updating match format:", err);
            showToast("Failed to update match format.", "error");
        } finally {
            setActionLoading(false);
        }
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
            await updateDoc(
                tRef,
                cleanForFirestore({
                    bracketSlots: updatedSlots,
                    matches: updatedMatches,
                    updatedAt: serverTimestamp(),
                })
            );

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
            const initialSets = createInitialSets(numberOfSets);
            const resetMatches: TournamentMatch[] = matches.map((m) => ({
                ...m,
                status: "NOT_STARTED",
                sets: initialSets,
                winnerTeamId: null,
                loserTeamId: null,
                isDraw: false,
                result: {
                    scoreA: 0,
                    scoreB: 0,
                    sets: initialSets,
                    status: "NOT_STARTED",
                    winner: null,
                    winnerTeamId: null,
                    loserTeamId: null,
                    isDraw: false,
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
            await updateDoc(
                tRef,
                cleanForFirestore({
                    matches: resetMatches,
                    bracketSlots: resetSlots,
                    updatedAt: serverTimestamp(),
                })
            );

            setOngoingDrafts({});
            setLocalMatchStatuses({});
            setMatches(resetMatches);
            setBracketSlots(resetSlots);
            setResetScoresDialogOpen(false);
            showToast("All match scores have been reset to Not Started (0-0).", "info");
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

    // Trigger Print / Export PDF
    const handleTriggerPrint = () => {
        setPrintTimestamp(new Date().toLocaleString());
        setPrintDialogOpen(false);
        setTimeout(() => {
            window.print();
        }, 180);
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

    const totalRounds = tournament.config?.numRounds || 1;
    const totalCourts = tournament.config?.numCourts || 1;
    const tourneyMode = tournament.mode || tournament.config?.mode || "americano";
    const isTeamUnit =
        tournament.unitType === "teams" ||
        tournament.config?.unitType === "teams" ||
        tourneyMode === "round_robin" ||
        tourneyMode === "knockout" ||
        tourneyMode === "round_robin_knockout" ||
        Boolean(tournament.pairs && tournament.pairs.length > 0);
    const hasBracket = tourneyMode === "knockout" || tourneyMode === "round_robin_knockout";
    const activeStandings = isTeamUnit ? pairStandings : playerStandings;

    const closedMatchesCount = matches.filter((m) => getEffectiveMatchStatus(m) === "CLOSED").length;
    const ongoingMatchesCount = matches.filter((m) => getEffectiveMatchStatus(m) === "ONGOING").length;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
            {/* Print-specific CSS for A4 Portrait Vector-Crisp Export */}
            <style jsx global>{`
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 12mm;
                    }
                    body {
                        background: #ffffff !important;
                        color: #0f172a !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .no-print {
                        display: none !important;
                    }
                    #tournament-print-summary {
                        display: block !important;
                    }
                    .print-avoid-break {
                        break-inside: avoid !important;
                        page-break-inside: avoid !important;
                    }
                }
            `}</style>

            <div className="no-print flex-1 flex flex-col">
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
                                    <div className="flex items-center gap-2 flex-wrap">
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
                                            {tourneyMode.replace(/_/g, " ")}
                                        </Badge>
                                        <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]">
                                            {numberOfSets} {numberOfSets === 1 ? "Set" : "Sets"} Format
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

                            {/* Top quick stats + Export PDF button */}
                            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
                                <span className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 font-semibold text-slate-300">
                                    {totalCourts} Courts
                                </span>
                                <span className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 font-semibold text-emerald-400">
                                    {closedMatchesCount}/{matches.length} Closed
                                </span>
                                {ongoingMatchesCount > 0 && (
                                    <span className="bg-amber-500/15 px-3 py-1.5 rounded-lg border border-amber-500/40 font-semibold text-amber-300">
                                        {ongoingMatchesCount} Ongoing
                                    </span>
                                )}
                                {isAuthorizedAdmin && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setPrintTimestamp(new Date().toLocaleString());
                                            setPrintDialogOpen(true);
                                        }}
                                        className="bg-slate-950 border-amber-500/40 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 h-8 text-xs font-bold"
                                    >
                                        <Printer className="w-3.5 h-3.5 mr-1.5" /> Export / Print Summary
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Navigation Tabs */}
                        <div className="flex items-center justify-between pt-4">
                            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                                <button
                                    onClick={() => setActiveTab("schedule")}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
                                        activeTab === "schedule"
                                            ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                                            : "bg-slate-950/60 border border-slate-800/80 text-slate-400 hover:text-white"
                                    }`}
                                >
                                    <Clock className="w-3.5 h-3.5" /> Schedule & Scores
                                </button>

                                <button
                                    onClick={() => setActiveTab("standings")}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
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
                                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
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
                                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
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
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
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
                                <span className="text-[11px] text-slate-400">
                                    Tip: Click any team name or avatar to inspect all their matches in this tournament.
                                </span>
                            </div>

                            <div className="space-y-6">
                                {Array.from({ length: totalRounds }).map((_, rIdx) => {
                                    if (selectedRoundFilter !== "ALL" && selectedRoundFilter !== String(rIdx)) {
                                        return null;
                                    }

                                    const roundMatches = matches.filter((m) => m.roundIdx === rIdx);
                                    if (roundMatches.length === 0) return null;

                                    const roundClosedCount = roundMatches.filter(
                                        (m) => getEffectiveMatchStatus(m) === "CLOSED"
                                    ).length;

                                    return (
                                        <div key={rIdx} className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-amber-400 tracking-wider">
                                                    ROUND {rIdx + 1}
                                                </span>
                                                <span className="text-xs text-slate-500 font-medium">
                                                    {roundClosedCount} / {roundMatches.length} Closed
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {roundMatches.map((m) => {
                                                    const effectiveStatus = getEffectiveMatchStatus(m);
                                                    const isNotStarted = effectiveStatus === "NOT_STARTED";
                                                    const isOngoing = effectiveStatus === "ONGOING";
                                                    const isClosed = effectiveStatus === "CLOSED";

                                                    const activeSets = isOngoing
                                                        ? ongoingDrafts[m.matchId]?.sets || getNormalizedMatchSets(m, numberOfSets)
                                                        : getNormalizedMatchSets(m, numberOfSets);

                                                    const evalRes = evaluateMatchSets(
                                                        activeSets,
                                                        m.result?.scoreA ?? 0,
                                                        m.result?.scoreB ?? 0
                                                    );

                                                    const isDraw =
                                                        isClosed &&
                                                        (evalRes.isDraw ||
                                                            m.isDraw ||
                                                            m.result?.isDraw ||
                                                            m.result?.winner === "Draw");
                                                    const isWinnerA =
                                                        isClosed &&
                                                        !isDraw &&
                                                        (evalRes.winnerSide === "Team 1" ||
                                                            m.result?.winner === "Team 1" ||
                                                            (m.result?.winner as any) === "Side A");
                                                    const isWinnerB =
                                                        isClosed &&
                                                        !isDraw &&
                                                        (evalRes.winnerSide === "Team 2" ||
                                                            m.result?.winner === "Team 2" ||
                                                            (m.result?.winner as any) === "Side B");

                                                    // Card border accents for closed matches as required by Section 2.2
                                                    const sideABorderStyle = isClosed
                                                        ? isDraw
                                                            ? { border: "2px solid #f59e0b" }
                                                            : isWinnerA
                                                            ? { border: "2px solid #22c55e" }
                                                            : { border: "2px solid #ef4444" }
                                                        : undefined;

                                                    const sideBBorderStyle = isClosed
                                                        ? isDraw
                                                            ? { border: "2px solid #f59e0b" }
                                                            : isWinnerB
                                                            ? { border: "2px solid #22c55e" }
                                                            : { border: "2px solid #ef4444" }
                                                        : undefined;

                                                    const sideATeamId = resolveMatchSideTeamId(m, "A", tournament);
                                                    const sideBTeamId = resolveMatchSideTeamId(m, "B", tournament);

                                                    const teamAName = m.team1Names ? m.team1Names.join(" & ") : "Team A";
                                                    const teamBName = m.team2Names ? m.team2Names.join(" & ") : "Team B";

                                                    const sideAPlayers =
                                                        m.team1PlayerIds && m.team1PlayerIds.length > 0
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

                                                    const sideBPlayers =
                                                        m.team2PlayerIds && m.team2PlayerIds.length > 0
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
                                                            className={`transition-all overflow-hidden ${
                                                                isClosed
                                                                    ? "bg-emerald-950/10 border-emerald-500/35 shadow-lg shadow-emerald-950/10"
                                                                    : isOngoing
                                                                    ? "bg-amber-950/15 border-amber-500/45 shadow-lg shadow-amber-950/10"
                                                                    : "bg-red-950/10 border-red-500/25"
                                                            }`}
                                                        >
                                                            {/* Match Card Top Bar: Court Badge + 3 Status Transition Buttons */}
                                                            <CardHeader className="p-3 pb-2.5 flex flex-col gap-2.5 border-b border-slate-800/80 bg-slate-900/70">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <Badge className="bg-slate-950 text-slate-300 border-slate-800 text-[10px]">
                                                                        {m.courtName || `Court ${m.courtIdx + 1}`}
                                                                    </Badge>

                                                                    <div className="flex items-center gap-1.5">
                                                                        {m.result?.status === "walkover" && isClosed && (
                                                                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                                                                                Walkover
                                                                            </Badge>
                                                                        )}
                                                                        {isClosed ? (
                                                                            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] font-bold">
                                                                                {isDraw
                                                                                    ? `Closed • Draw (${evalRes.totalGamesA}-${evalRes.totalGamesB})`
                                                                                    : numberOfSets > 1
                                                                                    ? `Closed • Sets ${evalRes.setsWonA}-${evalRes.setsWonB} (${evalRes.totalGamesA}-${evalRes.totalGamesB})`
                                                                                    : `Closed (${evalRes.totalGamesA} - ${evalRes.totalGamesB})`}
                                                                            </Badge>
                                                                        ) : isOngoing ? (
                                                                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] font-bold animate-pulse">
                                                                                Ongoing (Editing Local Scores)
                                                                            </Badge>
                                                                        ) : (
                                                                            <Badge className="bg-red-500/15 text-red-300 border-red-500/35 text-[10px]">
                                                                                Not Started (Locked)
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* 3 Explicit Status Buttons (Not Started / Ongoing / Closed) */}
                                                                {isAuthorizedAdmin && (
                                                                    <div
                                                                        className="grid grid-cols-3 gap-1.5"
                                                                        role="group"
                                                                        aria-label="Match Status Controls"
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSetMatchNotStarted(m)}
                                                                            className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                                                                isNotStarted
                                                                                    ? "bg-red-500/25 border-red-500 text-red-200 shadow-sm"
                                                                                    : "bg-red-950/20 border-red-500/25 text-red-400/80 hover:bg-red-500/15 hover:text-red-200"
                                                                            }`}
                                                                        >
                                                                            <Lock className="w-3 h-3 shrink-0" />
                                                                            <span>Not Started</span>
                                                                        </button>

                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSetMatchOngoing(m)}
                                                                            className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                                                                isOngoing
                                                                                    ? "bg-amber-500/25 border-amber-400 text-amber-200 shadow-sm"
                                                                                    : "bg-amber-950/20 border-amber-500/25 text-amber-400/80 hover:bg-amber-500/15 hover:text-amber-200"
                                                                            }`}
                                                                        >
                                                                            <Play className="w-3 h-3 shrink-0" />
                                                                            <span>Ongoing</span>
                                                                        </button>

                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSetMatchClosed(m)}
                                                                            className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                                                                isClosed
                                                                                    ? "bg-emerald-500/25 border-emerald-400 text-emerald-200 shadow-sm"
                                                                                    : "bg-emerald-950/20 border-emerald-500/25 text-emerald-400/80 hover:bg-emerald-500/15 hover:text-emerald-200"
                                                                            }`}
                                                                        >
                                                                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                                                                            <span>Closed</span>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </CardHeader>

                                                            <CardContent className="p-3.5 space-y-2.5">
                                                                {/* Set Headers when numberOfSets > 1 */}
                                                                {numberOfSets > 1 && (
                                                                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 font-semibold uppercase tracking-wider">
                                                                        <span>Teams</span>
                                                                        <div className="flex items-center gap-1.5">
                                                                            {activeSets.map((s, idx) => (
                                                                                <span
                                                                                    key={idx}
                                                                                    className="w-11 text-center text-amber-400"
                                                                                >
                                                                                    Set {s.setNumber}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Side A Container */}
                                                                <div
                                                                    style={sideABorderStyle}
                                                                    className={`p-2.5 rounded-xl flex items-center justify-between gap-2 transition-all ${
                                                                        isClosed
                                                                            ? isWinnerA
                                                                                ? "bg-emerald-950/25"
                                                                                : isDraw
                                                                                ? "bg-amber-950/20"
                                                                                : "bg-red-950/20"
                                                                            : "bg-slate-950 border border-slate-800/80"
                                                                    }`}
                                                                >
                                                                    {/* Clickable Team A Avatar + Name */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setSelectedTeamIdForModal(sideATeamId)
                                                                        }
                                                                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                                                                        title={`View ${teamAName} tournament record`}
                                                                    >
                                                                        {sideAPlayers.length > 0 && (
                                                                            <div className="flex items-center -space-x-2 shrink-0">
                                                                                {sideAPlayers.map((p, pIdx) => (
                                                                                    <Avatar
                                                                                        key={pIdx}
                                                                                        className="h-8 w-8 sm:h-9 sm:w-9 border-2 border-slate-900 group-hover:border-amber-400 transition-colors z-10 shrink-0"
                                                                                    >
                                                                                        <AvatarImage
                                                                                            src={p.photo}
                                                                                            alt={p.name}
                                                                                        />
                                                                                        <AvatarFallback className="bg-slate-800 text-slate-300 text-xs font-bold">
                                                                                            {p.name?.charAt(0) || "P"}
                                                                                        </AvatarFallback>
                                                                                    </Avatar>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                        <div className="truncate min-w-0">
                                                                            <span className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors block truncate underline-offset-2 group-hover:underline">
                                                                                {teamAName}
                                                                            </span>
                                                                            {isClosed && (
                                                                                <span
                                                                                    className={`text-[10px] font-bold ${
                                                                                        isWinnerA
                                                                                            ? "text-emerald-400"
                                                                                            : isDraw
                                                                                            ? "text-amber-400"
                                                                                            : "text-red-400"
                                                                                    }`}
                                                                                >
                                                                                    {isWinnerA
                                                                                        ? "Winner"
                                                                                        : isDraw
                                                                                        ? "Draw"
                                                                                        : "Loser"}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </button>

                                                                    {/* Dynamic Set Score Inputs for Side A */}
                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                        {activeSets.map((setItem, sIdx) => {
                                                                            if (isOngoing && isAuthorizedAdmin) {
                                                                                return (
                                                                                    <div
                                                                                        key={sIdx}
                                                                                        className="flex items-center gap-0.5"
                                                                                    >
                                                                                        {numberOfSets === 1 && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    handleUpdateDraftSetScore(
                                                                                                        m.matchId,
                                                                                                        sIdx,
                                                                                                        "A",
                                                                                                        (setItem.teamAScore || 0) - 1
                                                                                                    )
                                                                                                }
                                                                                                className="w-7 h-8 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs"
                                                                                            >
                                                                                                -
                                                                                            </button>
                                                                                        )}
                                                                                        <input
                                                                                            type="number"
                                                                                            min={0}
                                                                                            max={99}
                                                                                            aria-label={`Team A Set ${sIdx + 1} Score`}
                                                                                            value={setItem.teamAScore}
                                                                                            onChange={(e) =>
                                                                                                handleUpdateDraftSetScore(
                                                                                                    m.matchId,
                                                                                                    sIdx,
                                                                                                    "A",
                                                                                                    parseInt(e.target.value, 10) || 0
                                                                                                )
                                                                                            }
                                                                                            className="w-11 h-8 text-center bg-slate-900 border border-amber-500/60 text-white font-extrabold text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                                                                        />
                                                                                        {numberOfSets === 1 && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    handleUpdateDraftSetScore(
                                                                                                        m.matchId,
                                                                                                        sIdx,
                                                                                                        "A",
                                                                                                        (setItem.teamAScore || 0) + 1
                                                                                                    )
                                                                                                }
                                                                                                className="w-7 h-8 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs"
                                                                                            >
                                                                                                +
                                                                                            </button>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            }

                                                                            return (
                                                                                <div
                                                                                    key={sIdx}
                                                                                    className={`w-11 h-8 rounded-lg border flex items-center justify-center font-extrabold text-sm ${
                                                                                        isNotStarted
                                                                                            ? "bg-slate-900/50 border-slate-800 text-slate-500"
                                                                                            : "bg-slate-900 border-slate-800 text-white"
                                                                                    }`}
                                                                                >
                                                                                    {isNotStarted ? "0" : setItem.teamAScore}
                                                                                    {!isNotStarted &&
                                                                                    setItem.tieBreak &&
                                                                                    (setItem.tieBreak.teamAScore > 0 ||
                                                                                        setItem.tieBreak.teamBScore > 0) ? (
                                                                                        <sup className="text-[9px] text-amber-400 ml-0.5">
                                                                                            ({setItem.tieBreak.teamAScore})
                                                                                        </sup>
                                                                                    ) : null}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>

                                                                <div className="text-center text-[10px] font-bold text-slate-600">
                                                                    vs
                                                                </div>

                                                                {/* Side B Container */}
                                                                <div
                                                                    style={sideBBorderStyle}
                                                                    className={`p-2.5 rounded-xl flex items-center justify-between gap-2 transition-all ${
                                                                        isClosed
                                                                            ? isWinnerB
                                                                                ? "bg-emerald-950/25"
                                                                                : isDraw
                                                                                ? "bg-amber-950/20"
                                                                                : "bg-red-950/20"
                                                                            : "bg-slate-950 border border-slate-800/80"
                                                                    }`}
                                                                >
                                                                    {/* Clickable Team B Avatar + Name */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setSelectedTeamIdForModal(sideBTeamId)
                                                                        }
                                                                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                                                                        title={`View ${teamBName} tournament record`}
                                                                    >
                                                                        {sideBPlayers.length > 0 && (
                                                                            <div className="flex items-center -space-x-2 shrink-0">
                                                                                {sideBPlayers.map((p, pIdx) => (
                                                                                    <Avatar
                                                                                        key={pIdx}
                                                                                        className="h-8 w-8 sm:h-9 sm:w-9 border-2 border-slate-900 group-hover:border-amber-400 transition-colors z-10 shrink-0"
                                                                                    >
                                                                                        <AvatarImage
                                                                                            src={p.photo}
                                                                                            alt={p.name}
                                                                                        />
                                                                                        <AvatarFallback className="bg-slate-800 text-slate-300 text-xs font-bold">
                                                                                            {p.name?.charAt(0) || "P"}
                                                                                        </AvatarFallback>
                                                                                    </Avatar>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                        <div className="truncate min-w-0">
                                                                            <span className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors block truncate underline-offset-2 group-hover:underline">
                                                                                {teamBName}
                                                                            </span>
                                                                            {isClosed && (
                                                                                <span
                                                                                    className={`text-[10px] font-bold ${
                                                                                        isWinnerB
                                                                                            ? "text-emerald-400"
                                                                                            : isDraw
                                                                                            ? "text-amber-400"
                                                                                            : "text-red-400"
                                                                                    }`}
                                                                                >
                                                                                    {isWinnerB
                                                                                        ? "Winner"
                                                                                        : isDraw
                                                                                        ? "Draw"
                                                                                        : "Loser"}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </button>

                                                                    {/* Dynamic Set Score Inputs for Side B */}
                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                        {activeSets.map((setItem, sIdx) => {
                                                                            if (isOngoing && isAuthorizedAdmin) {
                                                                                return (
                                                                                    <div
                                                                                        key={sIdx}
                                                                                        className="flex items-center gap-0.5"
                                                                                    >
                                                                                        {numberOfSets === 1 && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    handleUpdateDraftSetScore(
                                                                                                        m.matchId,
                                                                                                        sIdx,
                                                                                                        "B",
                                                                                                        (setItem.teamBScore || 0) - 1
                                                                                                    )
                                                                                                }
                                                                                                className="w-7 h-8 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs"
                                                                                            >
                                                                                                -
                                                                                            </button>
                                                                                        )}
                                                                                        <input
                                                                                            type="number"
                                                                                            min={0}
                                                                                            max={99}
                                                                                            aria-label={`Team B Set ${sIdx + 1} Score`}
                                                                                            value={setItem.teamBScore}
                                                                                            onChange={(e) =>
                                                                                                handleUpdateDraftSetScore(
                                                                                                    m.matchId,
                                                                                                    sIdx,
                                                                                                    "B",
                                                                                                    parseInt(e.target.value, 10) || 0
                                                                                                )
                                                                                            }
                                                                                            className="w-11 h-8 text-center bg-slate-900 border border-amber-500/60 text-white font-extrabold text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                                                                        />
                                                                                        {numberOfSets === 1 && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    handleUpdateDraftSetScore(
                                                                                                        m.matchId,
                                                                                                        sIdx,
                                                                                                        "B",
                                                                                                        (setItem.teamBScore || 0) + 1
                                                                                                    )
                                                                                                }
                                                                                                className="w-7 h-8 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs"
                                                                                            >
                                                                                                +
                                                                                            </button>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            }

                                                                            return (
                                                                                <div
                                                                                    key={sIdx}
                                                                                    className={`w-11 h-8 rounded-lg border flex items-center justify-center font-extrabold text-sm ${
                                                                                        isNotStarted
                                                                                            ? "bg-slate-900/50 border-slate-800 text-slate-500"
                                                                                            : "bg-slate-900 border-slate-800 text-white"
                                                                                    }`}
                                                                                >
                                                                                    {isNotStarted ? "0" : setItem.teamBScore}
                                                                                    {!isNotStarted &&
                                                                                    setItem.tieBreak &&
                                                                                    (setItem.tieBreak.teamAScore > 0 ||
                                                                                        setItem.tieBreak.teamBScore > 0) ? (
                                                                                        <sup className="text-[9px] text-amber-400 ml-0.5">
                                                                                            ({setItem.tieBreak.teamBScore})
                                                                                        </sup>
                                                                                    ) : null}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>

                                                                {/* Conditional Tie-Break Input UI when any set is tied in ONGOING mode */}
                                                                {isOngoing &&
                                                                    isAuthorizedAdmin &&
                                                                    activeSets.some(
                                                                        (s) => s.teamAScore === s.teamBScore
                                                                    ) && (
                                                                        <div className="pt-1 space-y-2">
                                                                            {activeSets.map((setItem, sIdx) => {
                                                                                if (setItem.teamAScore !== setItem.teamBScore) {
                                                                                    return null;
                                                                                }
                                                                                const tbOpen = Boolean(
                                                                                    ongoingDrafts[m.matchId]?.tieBreakOpen?.[
                                                                                        sIdx
                                                                                    ] || setItem.tieBreak
                                                                                );

                                                                                return (
                                                                                    <div
                                                                                        key={sIdx}
                                                                                        className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2"
                                                                                    >
                                                                                        <div className="flex items-center justify-between gap-2">
                                                                                            <span className="text-[11px] text-amber-200 font-semibold">
                                                                                                Set {setItem.setNumber} is tied ({setItem.teamAScore}-{setItem.teamBScore}). Optional Tie-Break:
                                                                                            </span>
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    handleToggleDraftTieBreak(
                                                                                                        m.matchId,
                                                                                                        sIdx
                                                                                                    )
                                                                                                }
                                                                                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                                                                                                    tbOpen
                                                                                                        ? "bg-amber-500 text-slate-950 border-amber-400"
                                                                                                        : "bg-slate-950 text-amber-300 border-amber-500/40 hover:bg-amber-500/20"
                                                                                                }`}
                                                                                            >
                                                                                                {tbOpen
                                                                                                    ? "Remove Tie-Break (Keep Draw)"
                                                                                                    : "+ Add Tie-Break Score"}
                                                                                            </button>
                                                                                        </div>

                                                                                        {tbOpen && (
                                                                                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20 text-xs">
                                                                                                <span className="text-[11px] text-slate-300 font-medium">
                                                                                                    Tie-Break Points (Set {setItem.setNumber}):
                                                                                                </span>
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        <span className="text-[10px] text-slate-400">
                                                                                                            A:
                                                                                                        </span>
                                                                                                        <input
                                                                                                            type="number"
                                                                                                            min={0}
                                                                                                            max={99}
                                                                                                            value={
                                                                                                                setItem.tieBreak
                                                                                                                    ?.teamAScore ?? 0
                                                                                                            }
                                                                                                            onChange={(e) =>
                                                                                                                handleUpdateDraftTieBreakScore(
                                                                                                                    m.matchId,
                                                                                                                    sIdx,
                                                                                                                    "A",
                                                                                                                    parseInt(
                                                                                                                        e.target
                                                                                                                            .value,
                                                                                                                        10
                                                                                                                    ) || 0
                                                                                                                )
                                                                                                            }
                                                                                                            className="w-12 h-7 text-center bg-slate-950 border border-amber-400 text-amber-300 font-bold text-xs rounded"
                                                                                                        />
                                                                                                    </div>
                                                                                                    <span className="text-slate-500 font-bold">
                                                                                                        :
                                                                                                    </span>
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        <span className="text-[10px] text-slate-400">
                                                                                                            B:
                                                                                                        </span>
                                                                                                        <input
                                                                                                            type="number"
                                                                                                            min={0}
                                                                                                            max={99}
                                                                                                            value={
                                                                                                                setItem.tieBreak
                                                                                                                    ?.teamBScore ?? 0
                                                                                                            }
                                                                                                            onChange={(e) =>
                                                                                                                handleUpdateDraftTieBreakScore(
                                                                                                                    m.matchId,
                                                                                                                    sIdx,
                                                                                                                    "B",
                                                                                                                    parseInt(
                                                                                                                        e.target
                                                                                                                            .value,
                                                                                                                        10
                                                                                                                    ) || 0
                                                                                                                )
                                                                                                            }
                                                                                                            className="w-12 h-7 text-center bg-slate-950 border border-amber-400 text-amber-300 font-bold text-xs rounded"
                                                                                                        />
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}

                                                                {/* Walkover & Quick Team Filter Footer */}
                                                                <div className="pt-1.5 flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-800/60">
                                                                    {isAuthorizedAdmin ? (
                                                                        <div className="flex gap-2 items-center">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleWalkover(m, "Team 1")
                                                                                }
                                                                                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 transition-colors border border-slate-800"
                                                                            >
                                                                                WO Team A
                                                                            </button>
                                                                            <span className="text-slate-600">•</span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleWalkover(m, "Team 2")
                                                                                }
                                                                                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 transition-colors border border-slate-800"
                                                                            >
                                                                                WO Team B
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <span>Click a team to filter their matches</span>
                                                                    )}

                                                                    <div className="flex items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setSelectedTeamIdForModal(sideATeamId)
                                                                            }
                                                                            className="text-amber-400/90 hover:text-amber-300 hover:underline font-medium"
                                                                        >
                                                                            Team A Record
                                                                        </button>
                                                                        <span className="text-slate-700">|</span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setSelectedTeamIdForModal(sideBTeamId)
                                                                            }
                                                                            className="text-amber-400/90 hover:text-amber-300 hover:underline font-medium"
                                                                        >
                                                                            Team B Record
                                                                        </button>
                                                                    </div>
                                                                </div>
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
                                <CardHeader className="p-4 border-b border-slate-800 flex flex-row items-center justify-between flex-wrap gap-2">
                                    <div>
                                        <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                            <Trophy className="w-4 h-4 text-amber-400" />
                                            Official Leaderboard
                                        </CardTitle>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Calculated automatically from CLOSED matches with multi-set & tie-break resolution. Click any competitor to view their matches.
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
                                                {numberOfSets > 1 && (
                                                    <th className="py-3 px-2 text-center">Sets</th>
                                                )}
                                                <th className="py-3 px-2 text-center">GF</th>
                                                <th className="py-3 px-2 text-center">GA</th>
                                                <th className="py-3 px-2 text-center">Diff</th>
                                                <th className="py-3 px-3 text-center font-bold text-amber-400">Pts</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/80">
                                            {activeStandings.map((row) => {
                                                const entityKey = String(row.entityId || row.id);
                                                const displayName = row.entityName || row.name || entityKey;
                                                const competitorPhotos: (string | null | undefined)[] = isTeamUnit
                                                    ? row.photoURLs && row.photoURLs.length > 0
                                                        ? row.photoURLs
                                                        : getPlayerPhotosForPair(entityKey)
                                                    : [row.photoURL || getPlayerPhoto(entityKey)];

                                                return (
                                                    <tr
                                                        key={entityKey}
                                                        onClick={() => setSelectedTeamIdForModal(entityKey)}
                                                        className={`cursor-pointer transition-colors ${
                                                            row.rank === 1
                                                                ? "bg-amber-500/10 hover:bg-amber-500/15"
                                                                : "hover:bg-slate-800/40"
                                                        }`}
                                                    >
                                                        <td className="py-3 px-3 text-center font-bold text-slate-300">
                                                            {row.rank === 1
                                                                ? "🥇 1"
                                                                : row.rank === 2
                                                                ? "🥈 2"
                                                                : row.rank === 3
                                                                ? "🥉 3"
                                                                : row.rank}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="flex items-center -space-x-2 shrink-0">
                                                                    {competitorPhotos.map((photo, pIdx) => (
                                                                        <Avatar
                                                                            key={pIdx}
                                                                            className="h-7 w-7 border-2 border-slate-900 z-10 shrink-0"
                                                                        >
                                                                            <AvatarImage
                                                                                src={photo || undefined}
                                                                                alt={displayName}
                                                                            />
                                                                            <AvatarFallback className="bg-slate-800 text-slate-300 text-[10px] font-bold">
                                                                                {displayName?.charAt(0) || "P"}
                                                                            </AvatarFallback>
                                                                        </Avatar>
                                                                    ))}
                                                                </div>
                                                                <span className="font-bold text-white hover:text-amber-300 underline-offset-2 hover:underline truncate max-w-[200px]">
                                                                    {displayName}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-2 text-center text-slate-400">
                                                            {row.played}
                                                        </td>
                                                        <td className="py-3 px-2 text-center text-emerald-400 font-semibold">
                                                            {row.wins}
                                                        </td>
                                                        <td className="py-3 px-2 text-center text-amber-300">
                                                            {row.draws}
                                                        </td>
                                                        <td className="py-3 px-2 text-center text-red-400">
                                                            {row.losses}
                                                        </td>
                                                        {numberOfSets > 1 && (
                                                            <td className="py-3 px-2 text-center text-slate-300 font-medium">
                                                                {row.setsWon ?? 0}-{row.setsLost ?? 0}
                                                            </td>
                                                        )}
                                                        <td className="py-3 px-2 text-center text-slate-400">
                                                            {row.gf}
                                                        </td>
                                                        <td className="py-3 px-2 text-center text-slate-400">
                                                            {row.ga}
                                                        </td>
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
                            {tourneyMode === "round_robin_knockout" && isAuthorizedAdmin && (
                                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between flex-wrap gap-3">
                                    <div>
                                        <span className="text-sm font-bold text-white block">
                                            Group Qualifiers Synchronization
                                        </span>
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
                                                    const pairA = tournament.pairs?.find(
                                                        (p) => p.pairId === slot.resolvedPairAId
                                                    );
                                                    const pairB = tournament.pairs?.find(
                                                        (p) => p.pairId === slot.resolvedPairBId
                                                    );
                                                    const isBye =
                                                        slot.winnerPairId &&
                                                        (!slot.resolvedPairAId || !slot.resolvedPairBId);

                                                    const matchObj = matches.find(
                                                        (m) => m.matchId === slot.matchId
                                                    );
                                                    const isWinnerA =
                                                        slot.winnerPairId &&
                                                        pairA &&
                                                        slot.winnerPairId === pairA.pairId;
                                                    const isWinnerB =
                                                        slot.winnerPairId &&
                                                        pairB &&
                                                        slot.winnerPairId === pairB.pairId;

                                                    return (
                                                        <div
                                                            key={slot.slotId}
                                                            className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs"
                                                        >
                                                            <div className="flex justify-between items-center text-[10px] text-slate-500 font-semibold">
                                                                <span>{slot.slotId}</span>
                                                                {isBye && (
                                                                    <Badge className="bg-slate-800 text-slate-400">
                                                                        BYE
                                                                    </Badge>
                                                                )}
                                                            </div>

                                                            <div
                                                                onClick={() => {
                                                                    if (pairA) {
                                                                        setSelectedTeamIdForModal(pairA.pairId);
                                                                    }
                                                                }}
                                                                className={`p-2 rounded-lg border flex items-center justify-between ${
                                                                    pairA ? "cursor-pointer" : ""
                                                                } ${
                                                                    isWinnerA
                                                                        ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300 font-bold"
                                                                        : "bg-slate-950 border-slate-800 text-slate-200"
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0 mr-2">
                                                                    {pairA && (
                                                                        <div className="flex items-center -space-x-1.5 shrink-0">
                                                                            {getPlayerPhotosForPair(pairA.pairId).map(
                                                                                (photo, pIdx) => (
                                                                                    <Avatar
                                                                                        key={pIdx}
                                                                                        className="h-6 w-6 border border-slate-900 z-10 shrink-0"
                                                                                    >
                                                                                        <AvatarImage
                                                                                            src={photo || undefined}
                                                                                            alt={pairA.pairName}
                                                                                        />
                                                                                        <AvatarFallback className="bg-slate-800 text-slate-300 text-[9px] font-bold">
                                                                                            {pairA.pairName?.charAt(0) ||
                                                                                                "P"}
                                                                                        </AvatarFallback>
                                                                                    </Avatar>
                                                                                )
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <span className="truncate">
                                                                        {pairA ? pairA.pairName : "TBD"}
                                                                    </span>
                                                                </div>
                                                                <span className="shrink-0">
                                                                    {matchObj ? matchObj.result.scoreA : 0}
                                                                </span>
                                                            </div>

                                                            <div
                                                                onClick={() => {
                                                                    if (pairB) {
                                                                        setSelectedTeamIdForModal(pairB.pairId);
                                                                    }
                                                                }}
                                                                className={`p-2 rounded-lg border flex items-center justify-between ${
                                                                    pairB ? "cursor-pointer" : ""
                                                                } ${
                                                                    isWinnerB
                                                                        ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300 font-bold"
                                                                        : "bg-slate-950 border-slate-800 text-slate-200"
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0 mr-2">
                                                                    {pairB && (
                                                                        <div className="flex items-center -space-x-1.5 shrink-0">
                                                                            {getPlayerPhotosForPair(pairB.pairId).map(
                                                                                (photo, pIdx) => (
                                                                                    <Avatar
                                                                                        key={pIdx}
                                                                                        className="h-6 w-6 border border-slate-900 z-10 shrink-0"
                                                                                    >
                                                                                        <AvatarImage
                                                                                            src={photo || undefined}
                                                                                            alt={pairB.pairName}
                                                                                        />
                                                                                        <AvatarFallback className="bg-slate-800 text-slate-300 text-[9px] font-bold">
                                                                                            {pairB.pairName?.charAt(0) ||
                                                                                                "P"}
                                                                                        </AvatarFallback>
                                                                                    </Avatar>
                                                                                )
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <span className="truncate">
                                                                        {pairB ? pairB.pairName : "TBD"}
                                                                    </span>
                                                                </div>
                                                                <span className="shrink-0">
                                                                    {matchObj ? matchObj.result.scoreB : 0}
                                                                </span>
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
                            {/* Export / Print Tournament Summary Card */}
                            <Card className="bg-slate-900 border-amber-500/30">
                                <CardHeader className="pb-3 border-b border-slate-800">
                                    <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                        <Printer className="w-4 h-4 text-amber-400" />
                                        Export / Print Tournament Summary (PDF)
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Generate a clean, vector-crisp A4 portrait tournament sheet with optional Live Standings and full Match Matrix.
                                    </p>
                                </CardHeader>
                                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="text-xs text-slate-300 space-y-1">
                                        <p>
                                            Includes tournament logo, venue/date snapshot, optional standings table, and round/court match matrix with current scores or score write-in boxes.
                                        </p>
                                    </div>
                                    <Button
                                        onClick={() => {
                                            setPrintTimestamp(new Date().toLocaleString());
                                            setPrintDialogOpen(true);
                                        }}
                                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0"
                                    >
                                        <Printer className="w-4 h-4 mr-1.5" /> Export / Print Tournament Summary
                                    </Button>
                                </CardContent>
                            </Card>

                            {/* Match Format (Number of Sets) Configuration */}
                            <Card className="bg-slate-900 border-slate-800">
                                <CardHeader className="pb-3 border-b border-slate-800">
                                    <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                        <Sliders className="w-4 h-4 text-amber-400" />
                                        Match Format (Number of Sets)
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Configure how many sets are played per match (1 Set default, Best of 3 Sets, or Best of 5 Sets).
                                    </p>
                                </CardHeader>
                                <CardContent className="p-4">
                                    <div className="grid grid-cols-3 gap-3">
                                        {([1, 3, 5] as const).map((setOpt) => (
                                            <button
                                                key={setOpt}
                                                type="button"
                                                disabled={actionLoading}
                                                onClick={() => handleUpdateNumberOfSets(setOpt)}
                                                className={`p-3 rounded-xl border text-xs font-bold transition-all ${
                                                    numberOfSets === setOpt
                                                        ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                                                }`}
                                            >
                                                {setOpt} {setOpt === 1 ? "Set (Default)" : "Sets"}
                                            </button>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

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
                                            <span className="text-sm font-semibold text-white block">
                                                Reset All Match Scores
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                Clears all recorded scores back to Not Started (0-0) and unlocks match regeneration.
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

                <BottomNav />
            </div>

            {/* PRINT-READY TOURNAMENT SUMMARY SHEET (A4 Portrait Vector-Crisp) */}
            <div
                id="tournament-print-summary"
                className={`hidden print:block w-full bg-white text-slate-950 ${
                    printGrayscaleMode ? "grayscale contrast-125" : ""
                }`}
            >
                {/* 1. Header */}
                <div className="border-b-2 border-slate-900 pb-4 mb-5 flex items-center justify-between gap-4 print-avoid-break">
                    <div className="flex items-center gap-3.5">
                        <img
                            src="/logo.png"
                            alt="Everywhere Padel Logo"
                            className="w-14 h-14 object-contain"
                        />
                        <div>
                            <h1 className="text-xl font-black tracking-tight text-slate-950">
                                {tournament.title}
                            </h1>
                            <p className="text-xs text-slate-700 font-medium">
                                {event?.eventName || "Tournament Event"} • {event?.locationName || "Padel Venue"}
                            </p>
                            <p className="text-[11px] text-slate-600 mt-0.5">
                                Format: {tourneyMode.replace(/_/g, " ").toUpperCase()} ({numberOfSets}{" "}
                                {numberOfSets === 1 ? "Set" : "Sets"}) • {totalCourts} Courts • {totalRounds} Rounds
                            </p>
                        </div>
                    </div>

                    <div className="text-right text-xs">
                        <div className="inline-block px-2.5 py-1 rounded border border-slate-900 font-bold uppercase text-[11px]">
                            Status: {tournament.status.toUpperCase()} ({closedMatchesCount}/{matches.length} Closed)
                        </div>
                        <p className="text-[10px] text-slate-600 mt-1">
                            Printed: {printTimestamp || new Date().toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* 2. Section 1: Live Standings (Optional via checkbox) */}
                {printIncludeStandings && (
                    <div className="mb-6 print-avoid-break">
                        <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 mb-2 border-b border-slate-300 pb-1">
                            Section 1: Live Standings
                        </h2>
                        <table className="w-full border-collapse text-xs border border-slate-800">
                            <thead>
                                <tr className="bg-slate-100 border-b border-slate-800 text-slate-900 font-bold">
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center w-12">Rank</th>
                                    <th className="py-1.5 px-2.5 border-r border-slate-400 text-left">Team / Competitor</th>
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center">Played</th>
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center">Won</th>
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center">Drawn</th>
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center">Lost</th>
                                    {numberOfSets > 1 && (
                                        <th className="py-1.5 px-2 border-r border-slate-400 text-center">Sets</th>
                                    )}
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center">GF / GA</th>
                                    <th className="py-1.5 px-2 border-r border-slate-400 text-center">Diff</th>
                                    <th className="py-1.5 px-2 text-center font-black">Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeStandings.map((row) => {
                                    const entityKey = String(row.entityId || row.id);
                                    const displayName = row.entityName || row.name || entityKey;
                                    return (
                                        <tr
                                            key={entityKey}
                                            className="border-b border-slate-300 print-avoid-break"
                                        >
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center font-bold">
                                                #{row.rank}
                                            </td>
                                            <td className="py-1.5 px-2.5 border-r border-slate-300 font-semibold">
                                                {displayName}
                                            </td>
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center">
                                                {row.played}
                                            </td>
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center font-semibold">
                                                {row.wins}
                                            </td>
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center">
                                                {row.draws}
                                            </td>
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center">
                                                {row.losses}
                                            </td>
                                            {numberOfSets > 1 && (
                                                <td className="py-1.5 px-2 border-r border-slate-300 text-center">
                                                    {row.setsWon ?? 0}-{row.setsLost ?? 0}
                                                </td>
                                            )}
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center">
                                                {row.gf} / {row.ga}
                                            </td>
                                            <td className="py-1.5 px-2 border-r border-slate-300 text-center font-semibold">
                                                {row.diff > 0 ? `+${row.diff}` : row.diff}
                                            </td>
                                            <td className="py-1.5 px-2 text-center font-black">
                                                {row.points}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* 3. Section 2: Match Matrix / Fixture List */}
                <div>
                    <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 mb-3 border-b border-slate-300 pb-1">
                        {printIncludeStandings
                            ? "Section 2: Match Matrix & Fixture List"
                            : "Match Matrix & Fixture List"}
                    </h2>

                    {printGroupBy === "round" ? (
                        <div className="space-y-4">
                            {Array.from({ length: totalRounds }).map((_, rIdx) => {
                                const rMatches = matches.filter((m) => m.roundIdx === rIdx);
                                if (rMatches.length === 0) return null;

                                return (
                                    <div key={rIdx} className="print-avoid-break border border-slate-800 rounded p-2.5">
                                        <div className="text-xs font-extrabold uppercase tracking-wider bg-slate-100 px-2 py-1 mb-2 border-b border-slate-300 flex justify-between">
                                            <span>Round {rIdx + 1}</span>
                                            <span>{rMatches.length} Match(es)</span>
                                        </div>
                                        <table className="w-full text-xs border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-400 text-[10px] uppercase text-slate-700">
                                                    <th className="py-1 px-2 text-left w-24">Court</th>
                                                    <th className="py-1 px-2 text-left">Team A</th>
                                                    <th className="py-1 px-2 text-center w-36">Score / Placeholder</th>
                                                    <th className="py-1 px-2 text-right">Team B</th>
                                                    <th className="py-1 px-2 text-center w-24">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rMatches.map((m) => {
                                                    const st = getEffectiveMatchStatus(m);
                                                    const mSets = getNormalizedMatchSets(m, numberOfSets);
                                                    const teamAName = m.team1Names ? m.team1Names.join(" & ") : "Team A";
                                                    const teamBName = m.team2Names ? m.team2Names.join(" & ") : "Team B";

                                                    const scoreText =
                                                        st === "NOT_STARTED"
                                                            ? Array.from({ length: numberOfSets })
                                                                  .map(() => "[ __ : __ ]")
                                                                  .join("  ")
                                                            : mSets
                                                                  .map((s) => {
                                                                      const tb =
                                                                          s.tieBreak &&
                                                                          (s.tieBreak.teamAScore > 0 ||
                                                                              s.tieBreak.teamBScore > 0)
                                                                              ? ` (${s.tieBreak.teamAScore}-${s.tieBreak.teamBScore})`
                                                                              : "";
                                                                      return `${s.teamAScore} - ${s.teamBScore}${tb}`;
                                                                  })
                                                                  .join(" , ");

                                                    return (
                                                        <tr
                                                            key={m.matchId}
                                                            className="border-b border-slate-200 last:border-b-0 print-avoid-break"
                                                        >
                                                            <td className="py-1.5 px-2 font-semibold">
                                                                {m.courtName || `Court ${m.courtIdx + 1}`}
                                                            </td>
                                                            <td className="py-1.5 px-2 font-semibold">{teamAName}</td>
                                                            <td className="py-1.5 px-2 text-center font-mono font-bold">
                                                                {scoreText}
                                                            </td>
                                                            <td className="py-1.5 px-2 text-right font-semibold">
                                                                {teamBName}
                                                            </td>
                                                            <td className="py-1.5 px-2 text-center text-[10px] font-bold">
                                                                {st.replace("_", " ")}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Array.from({ length: totalCourts }).map((_, cIdx) => {
                                const cMatches = matches
                                    .filter((m) => m.courtIdx === cIdx)
                                    .sort((a, b) => a.roundIdx - b.roundIdx);
                                if (cMatches.length === 0) return null;

                                return (
                                    <div key={cIdx} className="print-avoid-break border border-slate-800 rounded p-2.5">
                                        <div className="text-xs font-extrabold uppercase tracking-wider bg-slate-100 px-2 py-1 mb-2 border-b border-slate-300 flex justify-between">
                                            <span>Court {cIdx + 1}</span>
                                            <span>{cMatches.length} Match(es)</span>
                                        </div>
                                        <table className="w-full text-xs border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-400 text-[10px] uppercase text-slate-700">
                                                    <th className="py-1 px-2 text-left w-24">Round</th>
                                                    <th className="py-1 px-2 text-left">Team A</th>
                                                    <th className="py-1 px-2 text-center w-36">Score / Placeholder</th>
                                                    <th className="py-1 px-2 text-right">Team B</th>
                                                    <th className="py-1 px-2 text-center w-24">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {cMatches.map((m) => {
                                                    const st = getEffectiveMatchStatus(m);
                                                    const mSets = getNormalizedMatchSets(m, numberOfSets);
                                                    const teamAName = m.team1Names ? m.team1Names.join(" & ") : "Team A";
                                                    const teamBName = m.team2Names ? m.team2Names.join(" & ") : "Team B";

                                                    const scoreText =
                                                        st === "NOT_STARTED"
                                                            ? Array.from({ length: numberOfSets })
                                                                  .map(() => "[ __ : __ ]")
                                                                  .join("  ")
                                                            : mSets
                                                                  .map((s) => {
                                                                      const tb =
                                                                          s.tieBreak &&
                                                                          (s.tieBreak.teamAScore > 0 ||
                                                                              s.tieBreak.teamBScore > 0)
                                                                              ? ` (${s.tieBreak.teamAScore}-${s.tieBreak.teamBScore})`
                                                                              : "";
                                                                      return `${s.teamAScore} - ${s.teamBScore}${tb}`;
                                                                  })
                                                                  .join(" , ");

                                                    return (
                                                        <tr
                                                            key={m.matchId}
                                                            className="border-b border-slate-200 last:border-b-0 print-avoid-break"
                                                        >
                                                            <td className="py-1.5 px-2 font-semibold">
                                                                Round {m.roundIdx + 1}
                                                            </td>
                                                            <td className="py-1.5 px-2 font-semibold">{teamAName}</td>
                                                            <td className="py-1.5 px-2 text-center font-mono font-bold">
                                                                {scoreText}
                                                            </td>
                                                            <td className="py-1.5 px-2 text-right font-semibold">
                                                                {teamBName}
                                                            </td>
                                                            <td className="py-1.5 px-2 text-center text-[10px] font-bold">
                                                                {st.replace("_", " ")}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* INTERACTIVE TEAM FILTER MODAL (Scoped Strictly to Current Tournament) */}
            <Dialog
                open={Boolean(selectedTeamIdForModal)}
                onOpenChange={(open) => {
                    if (!open) setSelectedTeamIdForModal(null);
                }}
            >
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl max-h-[85vh] overflow-y-auto">
                    {selectedTeamSummary && (
                        <>
                            <DialogHeader className="border-b border-slate-800 pb-3">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center -space-x-2">
                                            {(selectedTeamSummary.playerPhotos.length > 0
                                                ? selectedTeamSummary.playerPhotos
                                                : [null]
                                            ).map((ph, idx) => (
                                                <Avatar
                                                    key={idx}
                                                    className="h-10 w-10 border-2 border-amber-500/40"
                                                >
                                                    <AvatarImage src={ph || undefined} />
                                                    <AvatarFallback className="bg-slate-800 text-amber-300 text-xs font-bold">
                                                        {selectedTeamSummary.teamName.charAt(0)}
                                                    </AvatarFallback>
                                                </Avatar>
                                            ))}
                                        </div>
                                        <div>
                                            <DialogTitle className="text-lg font-extrabold text-white flex items-center gap-2">
                                                {selectedTeamSummary.teamName}
                                                {selectedTeamSummary.rank && (
                                                    <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                                                        Rank #{selectedTeamSummary.rank}
                                                    </Badge>
                                                )}
                                            </DialogTitle>
                                            <DialogDescription className="text-xs text-slate-400">
                                                Tournament-scoped match history & performance in {tournament.title}
                                            </DialogDescription>
                                        </div>
                                    </div>

                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            const target = selectedTeamSummary.teamId;
                                            setSelectedTeamIdForModal(null);
                                            router.push(
                                                `/events/${eventId}/tournament/team/${encodeURIComponent(target)}`
                                            );
                                        }}
                                        className="bg-slate-950 border-amber-500/40 text-amber-300 hover:bg-amber-500/20 text-xs"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Dedicated Team View
                                    </Button>
                                </div>
                            </DialogHeader>

                            {/* Team Summary Stats Grid */}
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 py-2">
                                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-center">
                                    <span className="text-[10px] text-slate-400 uppercase block">Played</span>
                                    <span className="text-base font-extrabold text-white">
                                        {selectedTeamSummary.played}
                                    </span>
                                </div>
                                <div className="bg-emerald-950/25 p-2.5 rounded-xl border border-emerald-500/30 text-center">
                                    <span className="text-[10px] text-emerald-300 uppercase block">Won</span>
                                    <span className="text-base font-extrabold text-emerald-400">
                                        {selectedTeamSummary.wins}
                                    </span>
                                </div>
                                <div className="bg-amber-950/25 p-2.5 rounded-xl border border-amber-500/30 text-center">
                                    <span className="text-[10px] text-amber-300 uppercase block">Drawn</span>
                                    <span className="text-base font-extrabold text-amber-400">
                                        {selectedTeamSummary.draws}
                                    </span>
                                </div>
                                <div className="bg-red-950/25 p-2.5 rounded-xl border border-red-500/30 text-center">
                                    <span className="text-[10px] text-red-300 uppercase block">Lost</span>
                                    <span className="text-base font-extrabold text-red-400">
                                        {selectedTeamSummary.losses}
                                    </span>
                                </div>
                                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-center">
                                    <span className="text-[10px] text-slate-400 uppercase block">Diff</span>
                                    <span className="text-base font-extrabold text-slate-200">
                                        {selectedTeamSummary.diff > 0
                                            ? `+${selectedTeamSummary.diff}`
                                            : selectedTeamSummary.diff}
                                    </span>
                                </div>
                                <div className="bg-amber-500/15 p-2.5 rounded-xl border border-amber-500/30 text-center">
                                    <span className="text-[10px] text-amber-300 uppercase block font-bold">
                                        Points
                                    </span>
                                    <span className="text-base font-black text-amber-400">
                                        {selectedTeamSummary.points}
                                    </span>
                                </div>
                            </div>

                            {/* Filtered Matches List */}
                            <div className="space-y-2.5">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                    <Users className="w-3.5 h-3.5 text-amber-400" />
                                    All Tournament Matches ({selectedTeamSummary.matches.length})
                                </h4>
                                {selectedTeamSummary.matches.map((tm) => {
                                    const st = getEffectiveMatchStatus(tm);
                                    const mSets = getNormalizedMatchSets(tm, numberOfSets);
                                    const tA = tm.team1Names ? tm.team1Names.join(" & ") : "Team A";
                                    const tB = tm.team2Names ? tm.team2Names.join(" & ") : "Team B";

                                    return (
                                        <div
                                            key={tm.matchId}
                                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                                                st === "CLOSED"
                                                    ? "bg-emerald-950/15 border-emerald-500/30"
                                                    : st === "ONGOING"
                                                    ? "bg-amber-950/20 border-amber-500/40"
                                                    : "bg-red-950/15 border-red-500/25"
                                            }`}
                                        >
                                            <div className="space-y-1 min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <Badge className="bg-slate-950 border-slate-800 text-[10px] text-slate-300">
                                                        Round {tm.roundIdx + 1}
                                                    </Badge>
                                                    <Badge className="bg-slate-950 border-slate-800 text-[10px] text-amber-400">
                                                        {tm.courtName || `Court ${tm.courtIdx + 1}`}
                                                    </Badge>
                                                </div>
                                                <div className="font-bold text-white truncate">
                                                    {tA} <span className="text-slate-500 font-normal">vs</span> {tB}
                                                </div>
                                            </div>

                                            <div className="text-right shrink-0">
                                                <div className="font-extrabold text-sm text-white">
                                                    {st === "NOT_STARTED"
                                                        ? "— : —"
                                                        : mSets
                                                              .map((s) => `${s.teamAScore}-${s.teamBScore}`)
                                                              .join(", ")}
                                                </div>
                                                <span
                                                    className={`text-[10px] font-bold ${
                                                        st === "CLOSED"
                                                            ? "text-emerald-400"
                                                            : st === "ONGOING"
                                                            ? "text-amber-300"
                                                            : "text-red-300"
                                                    }`}
                                                >
                                                    {st.replace("_", " ")}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* EXPORT / PRINT TOURNAMENT SUMMARY OPTIONS DIALOG */}
            <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
                    <DialogHeader>
                        <DialogTitle className="text-amber-400 flex items-center gap-2">
                            <Printer className="w-5 h-5 text-amber-400" />
                            Export / Print Tournament Summary
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 text-xs pt-1">
                            Configure your A4 portrait PDF / print layout before launching the print preview.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2 text-xs">
                        {/* Optional Section 1: Live Standings Checkbox */}
                        <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={printIncludeStandings}
                                onChange={(e) => setPrintIncludeStandings(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-700 accent-amber-500"
                            />
                            <div>
                                <span className="font-bold text-white block">
                                    Include Section 1: Live Standings Table
                                </span>
                                <span className="text-slate-400 text-[11px]">
                                    Uncheck if you only want to print Section 2 (the Match Matrix / Fixture List).
                                </span>
                            </div>
                        </label>

                        {/* Fixture Grouping */}
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                            <span className="font-bold text-white block">
                                Section 2 Fixture Grouping
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPrintGroupBy("round")}
                                    className={`py-2 px-3 rounded-lg border font-bold transition-colors ${
                                        printGroupBy === "round"
                                            ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                            : "bg-slate-900 border-slate-800 text-slate-400"
                                    }`}
                                >
                                    Group by Round
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPrintGroupBy("court")}
                                    className={`py-2 px-3 rounded-lg border font-bold transition-colors ${
                                        printGroupBy === "court"
                                            ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                            : "bg-slate-900 border-slate-800 text-slate-400"
                                    }`}
                                >
                                    Group by Court
                                </button>
                            </div>
                        </div>

                        {/* Color Mode Toggle */}
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                            <span className="font-bold text-white block">Print Styling Mode</span>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPrintGrayscaleMode(false)}
                                    className={`py-2 px-3 rounded-lg border font-bold transition-colors ${
                                        !printGrayscaleMode
                                            ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                            : "bg-slate-900 border-slate-800 text-slate-400"
                                    }`}
                                >
                                    Full Color
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPrintGrayscaleMode(true)}
                                    className={`py-2 px-3 rounded-lg border font-bold transition-colors ${
                                        printGrayscaleMode
                                            ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                            : "bg-slate-900 border-slate-800 text-slate-400"
                                    }`}
                                >
                                    Black & White / Grayscale
                                </button>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button
                            variant="outline"
                            onClick={() => setPrintDialogOpen(false)}
                            className="bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleTriggerPrint}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                        >
                            <Printer className="w-4 h-4 mr-1.5" /> Print / Save as PDF
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
        </div>
    );
}

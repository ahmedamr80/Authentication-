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
    setDoc,
    serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { EventData, Registration, Team, User as FirestoreUser } from "@/types";
import {
    TournamentConfig,
    TournamentMode,
    TournamentPair,
    TournamentParticipant,
    TournamentTemplate,
} from "@/lib/tournaments/types";
import { generateTournamentSchedule } from "@/lib/tournaments/templateMatcher";
import { getTimestampMillis } from "@/lib/date-utils";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
    Trophy,
    ArrowLeft,
    CheckCircle2,
    Shuffle,
    AlertCircle,
    ArrowRight,
    ShieldAlert,
    Sliders,
    Sparkles,
    UserCheck,
    UserPlus,
    UserMinus,
    Check,
    Layers,
    Grid,
    Flame,
    Loader2,
} from "lucide-react";

interface UnifiedEntry {
    id: string;
    title: string;
    status: "CONFIRMED" | "WAITLIST";
    playerIds: string[];
    playerNames: string[];
    playerPhotos: (string | undefined)[];
    preferredSide?: "Left" | "Right" | "Both";
}

export default function TournamentCreatePage({
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
    const [saving, setSaving] = useState(false);
    const [event, setEvent] = useState<EventData | null>(null);

    // Registrations & Teams
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [userProfiles, setUserProfiles] = useState<Record<string, FirestoreUser>>({});

    // Wizard Steps (1: Review Event, 2: Mode, 3: Participants & Roster, 4: Config, 5: Preview & Generate)
    const [step, setStep] = useState<number>(1);

    // Wizard Form State
    const [mode, setMode] = useState<TournamentMode>("americano");
    const [tournamentTitle, setTournamentTitle] = useState("");
    const [numCourts, setNumCourts] = useState<number>(2);
    const [numRounds, setNumRounds] = useState<number>(7);
    const [cycles, setCycles] = useState<1 | 2>(1);
    const [numGroups, setNumGroups] = useState<number>(2);
    const [qualifiersPerGroup, setQualifiersPerGroup] = useState<number>(2);
    const [thirdPlacePlayoff, setThirdPlacePlayoff] = useState<boolean>(true);

    // Selected Participant IDs
    const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

    // Mixicano / Left-Right Pools
    const [leftPool, setLeftPool] = useState<TournamentParticipant[]>([]);
    const [rightPool, setRightPool] = useState<TournamentParticipant[]>([]);
    const [unassignedPool, setUnassignedPool] = useState<TournamentParticipant[]>([]);

    // Team Battle Pools
    const [teamAPool, setTeamAPool] = useState<TournamentParticipant[]>([]);
    const [teamBPool, setTeamBPool] = useState<TournamentParticipant[]>([]);

    // Firestore Tournament Templates
    const [templates, setTemplates] = useState<TournamentTemplate[]>([]);

    // Generated Schedule Preview
    const [previewResult, setPreviewResult] = useState<ReturnType<typeof generateTournamentSchedule> | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    // 1. Fetch Event, Check 1-to-1 constraint, and load participants
    useEffect(() => {
        let isMounted = true;

        async function init() {
            try {
                // Fetch Event Doc
                const eventRef = doc(db, "events", eventId);
                const eventSnap = await getDoc(eventRef);
                if (!eventSnap.exists()) {
                    showToast("Event not found", "error");
                    router.push("/events");
                    return;
                }

                const eventData = { eventId: eventSnap.id, ...eventSnap.data() } as EventData;
                if (isMounted) {
                    setEvent(eventData);
                    setTournamentTitle(`${eventData.eventName} Championship`);
                }

                // Check Strict 1-to-1 Cardinality (check if tournament already exists)
                const qTourney = query(
                    collection(db, "tournaments"),
                    where("eventId", "==", eventId)
                );
                const tourneySnap = await getDocs(qTourney);
                if (!tourneySnap.empty) {
                    showToast("Tournament already exists for this event. Redirecting to workspace...", "info");
                    router.replace(`/events/${eventId}/tournament`);
                    return;
                }

                // If Teams event, fetch Teams
                let loadedTeams: Team[] = [];
                let loadedRegs: Registration[] = [];
                const uids = new Set<string>();

                if (eventData.unitType === "Teams") {
                    const qTeams = query(collection(db, "teams"), where("eventId", "==", eventId));
                    const teamsSnap = await getDocs(qTeams);
                    loadedTeams = teamsSnap.docs.map((d) => ({ ...d.data(), teamId: d.id } as Team));
                    loadedTeams.forEach((t) => {
                        if (t.player1Id) uids.add(t.player1Id);
                        if (t.player2Id) uids.add(t.player2Id);
                    });
                } else {
                    const qRegs = query(collection(db, "registrations"), where("eventId", "==", eventId));
                    const regsSnap = await getDocs(qRegs);
                    loadedRegs = regsSnap.docs.map((d) => ({ ...d.data(), registrationId: d.id } as Registration));
                    loadedRegs.forEach((r) => {
                        if (r.playerId) uids.add(r.playerId);
                        if (r.player2Id) uids.add(r.player2Id);
                    });
                }

                // Fetch User Profiles for names and preferred court side
                const profilesMap: Record<string, FirestoreUser> = {};
                const uidsList = Array.from(uids);
                const chunks = [];
                for (let i = 0; i < uidsList.length; i += 10) {
                    chunks.push(uidsList.slice(i, i + 10));
                }

                for (const chunk of chunks) {
                    const qUsers = query(collection(db, "users"), where("__name__", "in", chunk));
                    const userDocs = await getDocs(qUsers);
                    userDocs.forEach((d) => {
                        profilesMap[d.id] = { uid: d.id, ...d.data() } as FirestoreUser;
                    });
                }

                if (isMounted) {
                    setTeams(loadedTeams);
                    setRegistrations(loadedRegs);
                    setUserProfiles(profilesMap);

                    // Pre-select all CONFIRMED entries
                    const initialSelected = new Set<string>();
                    if (eventData.unitType === "Teams") {
                        loadedTeams.forEach((t) => {
                            if (t.status === "CONFIRMED") initialSelected.add(t.teamId);
                        });
                        setMode("round_robin");
                    } else {
                        loadedRegs.forEach((r) => {
                            if (r.status === "CONFIRMED") initialSelected.add(r.registrationId);
                        });
                        setMode("americano");
                    }
                    setSelectedEntryIds(initialSelected);

                    // Fetch Active Tournament Templates
                    try {
                        const templatesSnap = await getDocs(
                            query(collection(db, "tournamentTemplates"), where("isActive", "==", true))
                        );
                        const loadedTemplates = templatesSnap.docs.map((d) => ({
                            templateId: d.id,
                            ...d.data(),
                        })) as TournamentTemplate[];
                        setTemplates(loadedTemplates);
                    } catch (tplErr) {
                        console.warn("Could not load tournament templates from Firestore:", tplErr);
                    }
                }
            } catch (err: any) {
                console.error("Error initializing tournament creation:", err);
                showToast("Failed to load tournament data.", "error");
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        init();

        return () => {
            isMounted = false;
        };
    }, [eventId, router, showToast]);

    // Calculate spots left and completion
    const spotsLeft = useMemo(() => {
        if (!event) return 0;
        const total = event.slotsAvailable || event.maxPlayers || 0;
        if (event.unitType === "Teams") {
            const confirmedCount = teams.filter((t) => t.status === "CONFIRMED").length;
            return Math.max(0, total - confirmedCount);
        }
        const confirmedCount = registrations.filter((r) => r.status === "CONFIRMED").length;
        return Math.max(0, total - confirmedCount);
    }, [event, teams, registrations]);

    const isEventCompleted = useMemo(() => {
        if (!event) return false;
        const isCancelled = event.status === "Cancelled" || event.status === "cancelled" || !!event.cancellationMessage;
        if (isCancelled) return false;
        const now = Date.now();
        const eventTime = getTimestampMillis(event.dateTime || event.eventDate);
        const isPast = eventTime ? eventTime <= now : false;
        return spotsLeft === 0 || isPast;
    }, [event, spotsLeft]);

    // Admin authorization
    const isAuthorizedAdmin = useMemo(() => {
        if (!user || !event) return false;
        return isAdmin || event.adminId === user.uid;
    }, [user, event, isAdmin]);

    // Build unified confirmed and waitlisted entries
    const { confirmedEntries, waitlistedEntries } = useMemo(() => {
        const confirmed: UnifiedEntry[] = [];
        const waitlisted: UnifiedEntry[] = [];

        if (event?.unitType === "Teams") {
            teams.forEach((t) => {
                const p1 = userProfiles[t.player1Id];
                const p2 = userProfiles[t.player2Id];
                const n1 = p1?.fullName || p1?.displayName || "Player 1";
                const n2 = p2?.fullName || p2?.displayName || "Player 2";
                const photo1 = p1?.photoUrl || p1?.photoURL;
                const photo2 = p2?.photoUrl || p2?.photoURL;
                const title = `${n1} & ${n2}`;

                const item: UnifiedEntry = {
                    id: t.teamId,
                    title,
                    status: t.status === "WAITLIST" ? "WAITLIST" : "CONFIRMED",
                    playerIds: [t.player1Id, t.player2Id],
                    playerNames: [n1, n2],
                    playerPhotos: [photo1, photo2],
                };

                if (t.status === "CONFIRMED") confirmed.push(item);
                else if (t.status === "WAITLIST") waitlisted.push(item);
            });
        } else {
            registrations.forEach((r) => {
                const profile = userProfiles[r.playerId];
                const playerName = r.fullName || profile?.fullName || profile?.displayName || "Player";
                const position = profile?.position as "Left" | "Right" | "Both" | undefined;
                const photo = profile?.photoUrl || profile?.photoURL;

                const item: UnifiedEntry = {
                    id: r.registrationId,
                    title: playerName,
                    status: r.status === "WAITLIST" ? "WAITLIST" : "CONFIRMED",
                    playerIds: [r.playerId],
                    playerNames: [playerName],
                    playerPhotos: [photo],
                    preferredSide: position,
                };

                if (r.status === "CONFIRMED") confirmed.push(item);
                else if (r.status === "WAITLIST") waitlisted.push(item);
            });
        }

        return { confirmedEntries: confirmed, waitlistedEntries: waitlisted };
    }, [event, teams, registrations, userProfiles]);

    // Active participants list based on selected entry IDs
    const activeParticipants = useMemo<TournamentParticipant[]>(() => {
        const allCandidates = [...confirmedEntries, ...waitlistedEntries];
        const list: TournamentParticipant[] = [];

        allCandidates.forEach((c) => {
            if (!selectedEntryIds.has(c.id)) return;
            list.push({
                id: c.id,
                name: c.title,
                uid: c.playerIds[0],
                photoURL: c.playerPhotos[0],
                preferredSide: c.preferredSide,
            });
        });

        return list;
    }, [confirmedEntries, waitlistedEntries, selectedEntryIds]);

    // Active Pairs list (for Teams modes: Round Robin, Knockout, Hybrid)
    const activePairs = useMemo<TournamentPair[]>(() => {
        if (event?.unitType !== "Teams") return [];
        const allCandidates = [...confirmedEntries, ...waitlistedEntries];
        const pairs: TournamentPair[] = [];
        let seedCounter = 1;

        allCandidates.forEach((c) => {
            if (!selectedEntryIds.has(c.id)) return;
            pairs.push({
                pairId: c.id,
                pairName: c.title,
                playerIds: c.playerIds,
                playerNames: c.playerNames,
                playerPhotos: c.playerPhotos,
                seed: seedCounter++,
            });
        });

        return pairs;
    }, [event, confirmedEntries, waitlistedEntries, selectedEntryIds]);

    // Auto-map Mixicano pools (Left vs Right)
    useEffect(() => {
        if (mode === "mixicano") {
            const left: TournamentParticipant[] = [];
            const right: TournamentParticipant[] = [];
            const unassigned: TournamentParticipant[] = [];

            activeParticipants.forEach((p) => {
                if (p.preferredSide === "Left") {
                    left.push(p);
                } else if (p.preferredSide === "Right") {
                    right.push(p);
                } else {
                    unassigned.push(p);
                }
            });

            setLeftPool(left);
            setRightPool(right);
            setUnassignedPool(unassigned);
        } else if (mode === "team_battle") {
            const mid = Math.ceil(activeParticipants.length / 2);
            setTeamAPool(activeParticipants.slice(0, mid));
            setTeamBPool(activeParticipants.slice(mid));
        }
    }, [mode, activeParticipants]);

    // Suggested defaults when active count changes
    useEffect(() => {
        const count =
            mode === "round_robin" || mode === "knockout" || mode === "round_robin_knockout"
                ? activePairs.length
                : activeParticipants.length;

        if (count > 0) {
            if (mode === "americano") {
                const suggestedCourts = Math.max(1, Math.floor(count / 4));
                setNumCourts(suggestedCourts);
                setNumRounds(count >= 8 ? Math.max(7, count - 1) : 5);
            } else if (mode === "mixicano" || mode === "team_battle") {
                const suggestedCourts = Math.max(1, Math.floor(count / 4));
                setNumCourts(suggestedCourts);
                setNumRounds(suggestedCourts * 2);
            } else if (mode === "round_robin" || mode === "knockout") {
                const suggestedCourts = Math.max(1, Math.min(4, Math.floor(count / 2)));
                setNumCourts(suggestedCourts);
            } else if (mode === "round_robin_knockout") {
                const suggestedCourts = Math.max(1, Math.min(4, Math.floor(count / 2)));
                setNumCourts(suggestedCourts);
                setNumGroups(Math.max(2, Math.floor(count / 4)));
            }
        }
    }, [mode, activeParticipants.length, activePairs.length]);

    // Generate Preview
    const generatePreview = () => {
        try {
            setPreviewError(null);

            let leftToUse = leftPool;
            let rightToUse = rightPool;
            let teamAToUse = teamAPool;
            let teamBToUse = teamBPool;

            if (mode === "mixicano") {
                const extraLeft = unassignedPool.slice(0, Math.ceil(unassignedPool.length / 2));
                const extraRight = unassignedPool.slice(Math.ceil(unassignedPool.length / 2));
                leftToUse = [...leftPool, ...extraLeft];
                rightToUse = [...rightPool, ...extraRight];

                const minCount = numCourts * 2;
                if (leftToUse.length < minCount || rightToUse.length < minCount) {
                    throw new Error(
                        `Mixicano requires at least ${minCount} Left players and ${minCount} Right players for ${numCourts} courts.`
                    );
                }
            }

            if (mode === "team_battle") {
                const reqPerTeam = numCourts * 2;
                if (teamAToUse.length < reqPerTeam || teamBToUse.length < reqPerTeam) {
                    throw new Error(
                        `Team Battle requires at least ${reqPerTeam} players in Team Alpha and ${reqPerTeam} in Team Beta for ${numCourts} courts.`
                    );
                }
            }

            if (mode === "americano" && activeParticipants.length < 4) {
                throw new Error("Americano requires at least 4 active players.");
            }

            if (
                (mode === "round_robin" || mode === "knockout" || mode === "round_robin_knockout") &&
                activePairs.length < 2
            ) {
                throw new Error("Team tournament formats require at least 2 teams.");
            }

            const result = generateTournamentSchedule({
                mode,
                title: tournamentTitle,
                numCourts,
                numRounds,
                cycles,
                numGroups,
                qualifiersPerGroup,
                thirdPlacePlayoff,
                participants: activeParticipants,
                pairs: activePairs,
                leftParticipants: leftToUse,
                rightParticipants: rightToUse,
                teamAParticipants: teamAToUse,
                teamBParticipants: teamBToUse,
                templates,
            });

            setPreviewResult(result);
            setStep(5);
        } catch (err: any) {
            console.error("Schedule generation error:", err);
            setPreviewError(err.message || "Failed to generate schedule.");
            showToast(err.message || "Schedule generation error", "error");
        }
    };

    // Commit Tournament to Firestore
    const handleCommitTournament = async (status: "draft" | "active") => {
        if (!previewResult || !event || !user) return;
        setSaving(true);

        try {
            const tournamentRef = doc(collection(db, "tournaments"));
            const tournamentId = tournamentRef.id;

            const config: TournamentConfig = {
                numCourts,
                numRounds: previewResult.numRounds,
                cycles,
                numGroups,
                qualifiersPerGroup,
                thirdPlacePlayoff,
            };

            const docData = {
                id: tournamentId,
                eventId,
                title: tournamentTitle,
                mode,
                unitType: event.unitType === "Teams" ? "teams" : "players",
                status,
                config,
                participants: previewResult.players,
                pairs: previewResult.pairs || [],
                groups: previewResult.groups || [],
                stages: previewResult.stages || [],
                bracketSlots: previewResult.bracketSlots || [],
                matches: previewResult.matches,
                templateId: previewResult.templateId || null,
                isFromTemplate: previewResult.isFromTemplate,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: user.uid,
            };

            await setDoc(tournamentRef, docData);

            showToast("Tournament created successfully!", "success");
            router.push(`/events/${eventId}/tournament`);
        } catch (err: any) {
            console.error("Error creating tournament:", err);
            showToast("Failed to save tournament. Please try again.", "error");
            setSaving(false);
        }
    };

    const toggleEntry = (id: string) => {
        setSelectedEntryIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAllConfirmed = () => {
        const allConfirmedIds = confirmedEntries.map((e) => e.id);
        const allSelected = allConfirmedIds.every((id) => selectedEntryIds.has(id));

        setSelectedEntryIds((prev) => {
            const next = new Set(prev);
            if (allSelected) {
                allConfirmedIds.forEach((id) => next.delete(id));
            } else {
                allConfirmedIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    // Promote waitlisted
    const promoteWaitlistEntry = (id: string) => {
        setSelectedEntryIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
        showToast("Waitlisted entry promoted into tournament roster.", "success");
    };

    if (loading || authLoading) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.back()} />
                <div className="flex-1 flex flex-col items-center justify-center p-6 pt-24 sm:pt-28 text-center">
                    <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
                    <p className="text-slate-400 font-medium">Loading tournament wizard...</p>
                </div>
                <BottomNav />
            </div>
        );
    }

    if (!isAuthorizedAdmin) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.back()} />
                <div className="flex-1 max-w-lg mx-auto p-6 pt-24 sm:pt-28 flex flex-col items-center justify-center text-center">
                    <ShieldAlert className="w-16 h-16 text-red-400 mb-4" />
                    <h1 className="text-2xl font-bold text-white mb-2">Access Restricted</h1>
                    <p className="text-slate-400 mb-6 text-sm">
                        Only the event organizer or an administrator has permission to create and manage tournaments for this event.
                    </p>
                    <Button
                        variant="outline"
                        className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        onClick={() => router.push(`/events/${eventId}`)}
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" /> Return to Event
                    </Button>
                </div>
                <BottomNav />
            </div>
        );
    }

    if (!isEventCompleted) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.back()} />
                <div className="flex-1 max-w-xl mx-auto p-6 pt-24 sm:pt-28 flex flex-col items-center justify-center text-center">
                    <AlertCircle className="w-14 h-14 text-amber-400 mb-4" />
                    <h1 className="text-2xl font-bold text-white mb-2">Event In Progress</h1>
                    <p className="text-slate-300 mb-4 text-sm leading-relaxed">
                        Tournament creation unlocks once all slots are full or when the scheduled match time has arrived.
                    </p>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 text-left w-full space-y-2 text-sm text-slate-400">
                        <div className="flex justify-between">
                            <span>Spots Remaining:</span>
                            <span className="text-white font-semibold">{spotsLeft} spots</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Confirmed Entries:</span>
                            <span className="text-white font-semibold">{confirmedEntries.length} confirmed</span>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        onClick={() => router.push(`/events/${eventId}`)}
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                </div>
                <BottomNav />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
            <Header user={user} showBack={true} onBack={() => (step > 1 ? setStep(step - 1) : router.push(`/events/${eventId}`))} />

            <main className="flex-1 max-w-4xl mx-auto w-full px-4 pt-24 sm:pt-28 pb-28">
                {/* Wizard Header */}
                <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => (step > 1 ? setStep(step - 1) : router.push(`/events/${eventId}`))}
                            className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition-colors"
                            aria-label="Back"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <div className="flex items-center gap-2">
                                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                                    Step {step} of 5
                                </Badge>
                                <span className="text-xs text-slate-400 font-medium">Tournament Builder</span>
                            </div>
                            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                                {step === 1 && "Event Overview"}
                                {step === 2 && "Choose Tournament Mode"}
                                {step === 3 && "Participant Roster & Mapping"}
                                {step === 4 && "Courts & Format Parameters"}
                                {step === 5 && "Review & Launch Tournament"}
                            </h1>
                        </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-400">
                        <Sparkles className="w-3.5 h-3.5" />
                        Strict 1-to-1 Verified
                    </div>
                </div>

                {/* STEP 1: EVENT OVERVIEW */}
                {step === 1 && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <Card className="bg-slate-900/90 border-slate-800 shadow-xl overflow-hidden">
                            <CardHeader className="bg-slate-900 border-b border-slate-800/80 pb-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                                            <Trophy className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-lg text-white font-bold">
                                                {event?.eventName}
                                            </CardTitle>
                                            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                                                <span>{event?.locationName}</span>
                                                <span>•</span>
                                                <span>{event?.unitType} Event</span>
                                            </p>
                                        </div>
                                    </div>
                                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                                        Completed
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                                        <span className="text-xs text-slate-400 block mb-1">Confirmed Entries</span>
                                        <span className="text-xl font-bold text-white">{confirmedEntries.length}</span>
                                    </div>
                                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                                        <span className="text-xs text-slate-400 block mb-1">Waitlist Replacements</span>
                                        <span className="text-xl font-bold text-amber-400">{waitlistedEntries.length}</span>
                                    </div>
                                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                                        <span className="text-xs text-slate-400 block mb-1">Unit Type</span>
                                        <span className="text-xl font-bold text-white">{event?.unitType}</span>
                                    </div>
                                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                                        <span className="text-xs text-slate-400 block mb-1">Status</span>
                                        <span className="text-xl font-bold text-emerald-400">Ready</span>
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">
                                        Tournament Title
                                    </label>
                                    <Input
                                        value={tournamentTitle}
                                        onChange={(e) => setTournamentTitle(e.target.value)}
                                        placeholder="e.g. Saturday Night Americano Championship"
                                        className="bg-slate-950 border-slate-800 text-white h-11 focus:border-amber-500"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <div className="flex justify-end pt-2">
                            <Button
                                onClick={() => setStep(2)}
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 h-11"
                            >
                                Continue to Mode Selection <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 2: MODE SELECTION */}
                {step === 2 && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {event?.unitType === "Players" ? (
                                <>
                                    <div
                                        onClick={() => setMode("americano")}
                                        className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                                            mode === "americano"
                                                ? "bg-slate-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                                                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">
                                                <Shuffle className="w-5 h-5" />
                                            </div>
                                            {mode === "americano" && (
                                                <Badge className="bg-amber-500 text-slate-950 font-bold">Selected</Badge>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-bold text-white mt-4">Americano (Social Rotation)</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                            Switch partners every round. All players play with and against each other, accumulating individual points on a unified leaderboard.
                                        </p>
                                    </div>

                                    <div
                                        onClick={() => setMode("mixicano")}
                                        className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                                            mode === "mixicano"
                                                ? "bg-slate-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                                                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold">
                                                <Layers className="w-5 h-5" />
                                            </div>
                                            {mode === "mixicano" && (
                                                <Badge className="bg-amber-500 text-slate-950 font-bold">Selected</Badge>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-bold text-white mt-4">Mixicano (Left vs Right)</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                            Pairs 1 Left-court player with 1 Right-court player every round. Profile court-side preferences are automatically pre-mapped.
                                        </p>
                                    </div>

                                    <div
                                        onClick={() => setMode("team_battle")}
                                        className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                                            mode === "team_battle"
                                                ? "bg-slate-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                                                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold">
                                                <Flame className="w-5 h-5" />
                                            </div>
                                            {mode === "team_battle" && (
                                                <Badge className="bg-amber-500 text-slate-950 font-bold">Selected</Badge>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-bold text-white mt-4">Team Battle (Alpha vs Beta)</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                            Two squads battle head-to-head across all courts. Individual scores sum towards each team’s grand victory.
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div
                                        onClick={() => setMode("round_robin")}
                                        className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                                            mode === "round_robin"
                                                ? "bg-slate-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                                                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">
                                                <Grid className="w-5 h-5" />
                                            </div>
                                            {mode === "round_robin" && (
                                                <Badge className="bg-amber-500 text-slate-950 font-bold">Selected</Badge>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-bold text-white mt-4">Round Robin (Groups)</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                            Fixed teams play against every other team in their group. Single-group mode preserves event registration order.
                                        </p>
                                    </div>

                                    <div
                                        onClick={() => setMode("knockout")}
                                        className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                                            mode === "knockout"
                                                ? "bg-slate-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                                                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold">
                                                <Trophy className="w-5 h-5" />
                                            </div>
                                            {mode === "knockout" && (
                                                <Badge className="bg-amber-500 text-slate-950 font-bold">Selected</Badge>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-bold text-white mt-4">Knockout Cup (Single Elimination)</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                            Single elimination bracket with standard seeding, automatic bye advances, and optional 3rd place playoff match.
                                        </p>
                                    </div>

                                    <div
                                        onClick={() => setMode("round_robin_knockout")}
                                        className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                                            mode === "round_robin_knockout"
                                                ? "bg-slate-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                                                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                                                <Sparkles className="w-5 h-5" />
                                            </div>
                                            {mode === "round_robin_knockout" && (
                                                <Badge className="bg-amber-500 text-slate-950 font-bold">Selected</Badge>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-bold text-white mt-4">Round Robin + Knockout (Hybrid)</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                            Group stage followed by bracket playoffs for top advancing teams. Automated qualifier synchronization.
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex justify-between pt-4">
                            <Button
                                variant="outline"
                                onClick={() => setStep(1)}
                                className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" /> Back
                            </Button>
                            <Button
                                onClick={() => setStep(3)}
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 h-11"
                            >
                                Configure Participants <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 3: PARTICIPANTS & MAPPING */}
                {step === 3 && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        {/* Confirmed Participants */}
                        <Card className="bg-slate-900 border-slate-800">
                            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-800">
                                <div>
                                    <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                        <UserCheck className="w-4 h-4 text-emerald-400" />
                                        Confirmed Participants ({confirmedEntries.filter((e) => selectedEntryIds.has(e.id)).length} / {confirmedEntries.length} Selected)
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Check or uncheck entries to choose the exact tournament roster.
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={toggleAllConfirmed}
                                    className="bg-slate-950 border-slate-700 text-xs text-slate-200 hover:bg-slate-800 hover:text-white h-8"
                                >
                                    Select / Deselect All
                                </Button>
                            </CardHeader>
                            <CardContent className="p-4 space-y-2">
                                {confirmedEntries.length === 0 ? (
                                    <p className="text-xs text-slate-500 text-center py-4">No confirmed participants found.</p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {confirmedEntries.map((entry) => {
                                            const isSelected = selectedEntryIds.has(entry.id);

                                            return (
                                                <div
                                                    key={entry.id}
                                                    onClick={() => toggleEntry(entry.id)}
                                                    className={`cursor-pointer p-3 rounded-xl border flex items-center justify-between transition-colors ${
                                                        isSelected
                                                            ? "bg-slate-950 border-emerald-500/40 text-white"
                                                            : "bg-slate-950/40 border-slate-800/80 text-slate-400 opacity-60"
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                                                        <div
                                                            className={`w-5 h-5 rounded-md flex items-center justify-center border text-xs font-bold shrink-0 ${
                                                                isSelected
                                                                    ? "bg-emerald-500 border-emerald-400 text-slate-950"
                                                                    : "border-slate-700 bg-slate-900"
                                                            }`}
                                                        >
                                                            {isSelected && <Check className="w-3.5 h-3.5 stroke-3" />}
                                                        </div>
                                                        <div className="flex items-center -space-x-2 shrink-0">
                                                            {entry.playerPhotos.map((photo, pIdx) => (
                                                                <Avatar key={pIdx} className="h-7 w-7 border-2 border-slate-900 z-10 shrink-0">
                                                                    <AvatarImage src={photo} />
                                                                    <AvatarFallback className="bg-slate-800 text-slate-300 text-[10px] font-bold">
                                                                        {entry.playerNames[pIdx]?.charAt(0) || "P"}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                            ))}
                                                        </div>
                                                        <div className="truncate flex-1 min-w-0">
                                                            <span className="text-sm font-semibold block truncate">
                                                                {entry.title}
                                                            </span>
                                                            {entry.preferredSide && (
                                                                <span className="text-[10px] text-slate-400 font-medium">
                                                                    Prefers: {entry.preferredSide} Side
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Badge className="bg-slate-900 border-slate-800 text-[10px] text-emerald-400 font-medium">
                                                        Confirmed
                                                    </Badge>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Available Replacements (Waitlist) */}
                        <Card className="bg-slate-900/60 border-slate-800/80">
                            <CardHeader className="pb-3 border-b border-slate-800/60">
                                <CardTitle className="text-sm font-bold text-amber-300 flex items-center gap-2">
                                    <UserPlus className="w-4 h-4 text-amber-400" />
                                    Available Replacements ({waitlistedEntries.length} Waitlisted)
                                </CardTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Promote or substitute someone in if a confirmed player did not show up.
                                </p>
                            </CardHeader>
                            <CardContent className="p-4 space-y-2">
                                {waitlistedEntries.length === 0 ? (
                                    <p className="text-xs text-slate-500 text-center py-2">No waitlisted entries for this event.</p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {waitlistedEntries.map((entry) => {
                                            const isSelected = selectedEntryIds.has(entry.id);

                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between"
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0 mr-2 flex-1">
                                                        <div className="flex items-center -space-x-2 shrink-0">
                                                            {entry.playerPhotos.map((photo, pIdx) => (
                                                                <Avatar key={pIdx} className="h-7 w-7 border-2 border-slate-900 z-10 shrink-0">
                                                                    <AvatarImage src={photo} />
                                                                    <AvatarFallback className="bg-slate-800 text-slate-300 text-[10px] font-bold">
                                                                        {entry.playerNames[pIdx]?.charAt(0) || "P"}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                            ))}
                                                        </div>
                                                        <div className="truncate flex-1 min-w-0">
                                                            <span className="text-sm font-semibold text-slate-200 block truncate">
                                                                {entry.title}
                                                            </span>
                                                            <span className="text-[10px] text-amber-400/80 font-medium">
                                                                Waitlisted
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {isSelected ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => toggleEntry(entry.id)}
                                                            className="bg-slate-950 border-red-500/40 text-red-400 hover:bg-red-500/20 hover:text-red-300 h-7 text-xs px-2.5"
                                                        >
                                                            <UserMinus className="w-3.5 h-3.5 mr-1" /> Remove
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => promoteWaitlistEntry(entry.id)}
                                                            className="bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 hover:text-amber-200 h-7 text-xs px-2.5 font-medium"
                                                        >
                                                            <UserPlus className="w-3.5 h-3.5 mr-1" /> Promote
                                                        </Button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Mixicano Left vs Right Pools */}
                        {mode === "mixicano" && (
                            <Card className="bg-slate-900 border-slate-800">
                                <CardHeader className="pb-3 border-b border-slate-800">
                                    <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-sky-400" />
                                        Mixicano Side Mapping (Left vs Right)
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Automatically mapped based on profile side preference. You can reassign players between Left and Right anytime.
                                    </p>
                                </CardHeader>
                                <CardContent className="p-4 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* Left Pool */}
                                        <div className="bg-slate-950 p-4 rounded-xl border border-sky-500/30">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="font-bold text-sky-400 text-sm">Left Pool ({leftPool.length})</span>
                                                <Badge className="bg-sky-500/20 text-sky-300 text-[10px]">Backhand Side</Badge>
                                            </div>
                                            <div className="space-y-1.5 min-h-[100px]">
                                                {leftPool.map((p) => (
                                                    <div
                                                        key={p.id}
                                                        className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs flex items-center justify-between"
                                                    >
                                                        <span className="text-slate-200 font-medium truncate">{p.name}</span>
                                                        <button
                                                            onClick={() => {
                                                                setLeftPool((l) => l.filter((x) => x.id !== p.id));
                                                                setRightPool((r) => [...r, p]);
                                                            }}
                                                            className="text-[10px] text-sky-400 hover:text-sky-300 ml-2"
                                                        >
                                                            Move Right →
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Right Pool */}
                                        <div className="bg-slate-950 p-4 rounded-xl border border-emerald-500/30">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="font-bold text-emerald-400 text-sm">Right Pool ({rightPool.length})</span>
                                                <Badge className="bg-emerald-500/20 text-emerald-300 text-[10px]">Forehand Side</Badge>
                                            </div>
                                            <div className="space-y-1.5 min-h-[100px]">
                                                {rightPool.map((p) => (
                                                    <div
                                                        key={p.id}
                                                        className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs flex items-center justify-between"
                                                    >
                                                        <span className="text-slate-200 font-medium truncate">{p.name}</span>
                                                        <button
                                                            onClick={() => {
                                                                setRightPool((r) => r.filter((x) => x.id !== p.id));
                                                                setLeftPool((l) => [...l, p]);
                                                            }}
                                                            className="text-[10px] text-emerald-400 hover:text-emerald-300 ml-2"
                                                        >
                                                            ← Move Left
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Unassigned Pool */}
                                    {unassignedPool.length > 0 && (
                                        <div className="bg-slate-950 p-4 rounded-xl border border-amber-500/30">
                                            <span className="font-bold text-amber-300 text-xs block mb-2">
                                                Unassigned / Flexible Players ({unassignedPool.length})
                                            </span>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {unassignedPool.map((p) => (
                                                    <div
                                                        key={p.id}
                                                        className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs flex items-center justify-between"
                                                    >
                                                        <span className="text-slate-300 truncate">{p.name}</span>
                                                        <div className="flex gap-1.5">
                                                            <button
                                                                onClick={() => {
                                                                    setUnassignedPool((u) => u.filter((x) => x.id !== p.id));
                                                                    setLeftPool((l) => [...l, p]);
                                                                }}
                                                                className="px-2 py-0.5 bg-sky-500/20 text-sky-300 rounded text-[10px]"
                                                            >
                                                                + Left
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setUnassignedPool((u) => u.filter((x) => x.id !== p.id));
                                                                    setRightPool((r) => [...r, p]);
                                                                }}
                                                                className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px]"
                                                            >
                                                                + Right
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <div className="flex justify-between pt-4">
                            <Button
                                variant="outline"
                                onClick={() => setStep(2)}
                                className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" /> Back
                            </Button>
                            <Button
                                onClick={() => setStep(4)}
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 h-11"
                            >
                                Configure Parameters <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 4: PARAMETERS & CAPACITY */}
                {step === 4 && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <Card className="bg-slate-900 border-slate-800">
                            <CardHeader className="pb-3 border-b border-slate-800">
                                <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                                    <Sliders className="w-4 h-4 text-amber-400" />
                                    Format Parameters & Court Scaling
                                </CardTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Fine-tune courts, rounds, cycles, and playoffs for optimum tournament flow.
                                </p>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                            Number of Courts
                                        </label>
                                        <span className="text-base font-bold text-amber-400">{numCourts} Courts</span>
                                    </div>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={12}
                                        value={numCourts}
                                        onChange={(e) => setNumCourts(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="bg-slate-950 border-slate-800 text-white h-11"
                                    />
                                </div>

                                {(mode === "americano" || mode === "mixicano" || mode === "team_battle") && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                                Total Rounds
                                            </label>
                                            <span className="text-base font-bold text-amber-400">{numRounds} Rounds</span>
                                        </div>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={30}
                                            value={numRounds}
                                            onChange={(e) => setNumRounds(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="bg-slate-950 border-slate-800 text-white h-11"
                                        />
                                    </div>
                                )}

                                {(mode === "round_robin" || mode === "round_robin_knockout") && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                                Round Robin Cycles
                                            </label>
                                            <span className="text-base font-bold text-amber-400">
                                                {cycles === 2 ? "Double Round Robin (2 Cycles)" : "Single Round Robin (1 Cycle)"}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setCycles(1)}
                                                className={`p-3 rounded-xl border text-xs font-semibold ${
                                                    cycles === 1
                                                        ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                                        : "bg-slate-950 border-slate-800 text-slate-400"
                                                }`}
                                            >
                                                Single Cycle (1 Match vs each)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setCycles(2)}
                                                className={`p-3 rounded-xl border text-xs font-semibold ${
                                                    cycles === 2
                                                        ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                                        : "bg-slate-950 border-slate-800 text-slate-400"
                                                }`}
                                            >
                                                Double Cycle (Home & Away)
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {(mode === "round_robin" || mode === "round_robin_knockout") && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                                Number of Groups
                                            </label>
                                            <span className="text-base font-bold text-amber-400">{numGroups} Groups</span>
                                        </div>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={8}
                                            value={numGroups}
                                            onChange={(e) => setNumGroups(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="bg-slate-950 border-slate-800 text-white h-11"
                                        />
                                    </div>
                                )}

                                {mode === "round_robin_knockout" && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                                Advancing Teams Per Group
                                            </label>
                                            <span className="text-base font-bold text-amber-400">
                                                Top {qualifiersPerGroup} from each group
                                            </span>
                                        </div>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={4}
                                            value={qualifiersPerGroup}
                                            onChange={(e) => setQualifiersPerGroup(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="bg-slate-950 border-slate-800 text-white h-11"
                                        />
                                    </div>
                                )}

                                {(mode === "knockout" || mode === "round_robin_knockout") && (
                                    <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
                                        <div>
                                            <span className="text-sm font-semibold text-white block">3rd Place Playoff</span>
                                            <span className="text-xs text-slate-400">
                                                Include a bronze medal match between semifinal losers.
                                            </span>
                                        </div>
                                        <Switch
                                            checked={thirdPlacePlayoff}
                                            onCheckedChange={setThirdPlacePlayoff}
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {previewError && (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span>{previewError}</span>
                            </div>
                        )}

                        <div className="flex justify-between pt-4">
                            <Button
                                variant="outline"
                                onClick={() => setStep(3)}
                                className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" /> Back
                            </Button>
                            <Button
                                onClick={generatePreview}
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 h-11"
                            >
                                Generate Schedule Preview <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 5: PREVIEW & LAUNCH */}
                {step === 5 && previewResult && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900 p-4 rounded-2xl border border-slate-800">
                            <div>
                                <span className="text-[11px] text-slate-400 block">Tournament Format</span>
                                <span className="text-sm font-bold text-white capitalize">{previewResult.mode.replace(/_/g, " ")}</span>
                            </div>
                            <div>
                                <span className="text-[11px] text-slate-400 block">Total Matches</span>
                                <span className="text-sm font-bold text-amber-400">{previewResult.matches.length} Matches</span>
                            </div>
                            <div>
                                <span className="text-[11px] text-slate-400 block">Total Rounds</span>
                                <span className="text-sm font-bold text-white">{previewResult.numRounds} Rounds</span>
                            </div>
                            <div>
                                <span className="text-[11px] text-slate-400 block">Engine Source</span>
                                <span className="text-sm font-bold text-emerald-400">
                                    {previewResult.isFromTemplate ? "Template Match (Instant)" : "Dynamic Solver"}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-base font-bold text-white flex items-center gap-2">
                                    <Trophy className="w-4 h-4 text-amber-400" />
                                    Match Schedule Preview
                                </h3>
                                <Badge className="bg-slate-900 border-slate-800 text-xs text-slate-300">
                                    {previewResult.numCourts} Courts Active
                                </Badge>
                            </div>

                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                                {Array.from({ length: previewResult.numRounds }).map((_, rIdx) => {
                                    const roundMatches = previewResult.matches.filter((m) => m.roundIdx === rIdx);
                                    if (roundMatches.length === 0) return null;

                                    return (
                                        <div key={rIdx} className="bg-slate-900/80 rounded-xl border border-slate-800 p-4">
                                            <div className="text-xs font-bold text-amber-400 mb-3 flex items-center justify-between">
                                                <span>ROUND {rIdx + 1}</span>
                                                <span className="text-slate-500 font-normal">{roundMatches.length} Match(es)</span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                                {roundMatches.map((m, mIdx) => (
                                                    <div
                                                        key={m.matchId || mIdx}
                                                        className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs gap-2"
                                                    >
                                                        <div className="flex-1 truncate space-y-1.5">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <div className="flex items-center -space-x-1.5 shrink-0">
                                                                    {m.team1Photos?.map((photo, idx) => (
                                                                        <Avatar key={idx} className="h-5 w-5 border border-slate-900 shrink-0">
                                                                            <AvatarImage src={photo} />
                                                                            <AvatarFallback className="text-[8px] bg-slate-800 text-slate-300 font-bold">
                                                                                {m.team1Names?.[idx]?.charAt(0) || "P"}
                                                                            </AvatarFallback>
                                                                        </Avatar>
                                                                    ))}
                                                                </div>
                                                                <span className="text-slate-200 font-semibold truncate">
                                                                    {m.team1Names ? m.team1Names.join(" & ") : "Team A"}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <div className="flex items-center -space-x-1.5 shrink-0">
                                                                    {m.team2Photos?.map((photo, idx) => (
                                                                        <Avatar key={idx} className="h-5 w-5 border border-slate-900 shrink-0">
                                                                            <AvatarImage src={photo} />
                                                                            <AvatarFallback className="text-[8px] bg-slate-800 text-slate-300 font-bold">
                                                                                {m.team2Names?.[idx]?.charAt(0) || "P"}
                                                                            </AvatarFallback>
                                                                        </Avatar>
                                                                    ))}
                                                                </div>
                                                                <span className="text-slate-200 font-semibold truncate">
                                                                    {m.team2Names ? m.team2Names.join(" & ") : "Team B"}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <Badge className="bg-slate-900 border-slate-800 text-[10px] text-slate-400 shrink-0 self-center">
                                                            {m.courtName || `Court ${m.courtIdx + 1}`}
                                                        </Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-slate-800">
                            <Button
                                variant="outline"
                                onClick={() => setStep(4)}
                                className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white w-full sm:w-auto"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" /> Modify Parameters
                            </Button>

                            <div className="flex items-center gap-3 w-full sm:w-auto">
                                <Button
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => handleCommitTournament("draft")}
                                    className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white flex-1 sm:flex-initial h-11"
                                >
                                    Save as Draft
                                </Button>
                                <Button
                                    disabled={saving}
                                    onClick={() => handleCommitTournament("active")}
                                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 flex-1 sm:flex-initial h-11"
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Launching...
                                        </>
                                    ) : (
                                        <>
                                            <Trophy className="w-4 h-4 mr-2" /> Launch Tournament
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <BottomNav />
        </div>
    );
}

"use client";

import { useState, useEffect, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Activity,
    ArrowLeft,
    Clock,
    Search,
    ShieldAlert,
    RefreshCw,
    UserCheck,
    UserMinus,
    TrendingUp,
    Users,
    CheckCircle2,
    XCircle,
    Copy,
    Check,
    Radio,
    Filter,
} from "lucide-react";
import { format } from "date-fns";
import { getTimestampMillis } from "@/lib/date-utils";

interface AuditLogEntry {
    auditId: string;
    eventId: string;
    entityType: "TEAM" | "REGISTRATION" | "EVENT";
    entityId: string;
    action: string;
    actorUid: string;
    actorName?: string | null;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
    correlationId?: string | null;
    reason?: string | null;
    timestamp: any;
}

export default function AdminActivityFeedPage({ params }: { params: Promise<{ eventId: string }> }) {
    const { eventId } = use(params);
    const router = useRouter();
    const { user, isAdmin, loading: authLoading } = useAuth();

    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [eventTitle, setEventTitle] = useState<string>("Event");
    const [filterCategory, setFilterCategory] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [selectedCorrelationId, setSelectedCorrelationId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Dynamic player & team name resolution
    const [userMap, setUserMap] = useState<Record<string, string>>({});
    const [teamMap, setTeamMap] = useState<
        Record<string, { player1Id?: string; player2Id?: string; fullNameP1?: string; fullNameP2?: string }>
    >({});

    // Fetch Event Basic Details
    useEffect(() => {
        if (!eventId) return;
        const fetchEvent = async () => {
            try {
                const eventSnap = await getDoc(doc(db, "events", eventId));
                if (eventSnap.exists()) {
                    const data = eventSnap.data();
                    setEventTitle(data.name || data.title || data.eventName || "Event");
                }
            } catch (err) {
                console.error("Failed to load event:", err);
            }
        };
        fetchEvent();
    }, [eventId]);

    // Live subscription to event registrations and teams to build local player name dictionary
    useEffect(() => {
        if (!eventId || authLoading || !user) return;

        const qRegs = query(collection(db, "registrations"), where("eventId", "==", eventId));
        const unsubRegs = onSnapshot(qRegs, (snap) => {
            const names: Record<string, string> = {};
            snap.forEach((d) => {
                const data = d.data();
                const pId = data.playerId;
                const name = data.fullName || data.fullNameP1 || data.displayName;
                if (pId && name) {
                    names[pId] = name;
                }
            });
            if (Object.keys(names).length > 0) {
                setUserMap((prev) => ({ ...prev, ...names }));
            }
        });

        const qTeams = query(collection(db, "teams"), where("eventId", "==", eventId));
        const unsubTeams = onSnapshot(qTeams, (snap) => {
            const teams: Record<string, { player1Id?: string; player2Id?: string; fullNameP1?: string; fullNameP2?: string }> = {};
            const names: Record<string, string> = {};
            snap.forEach((d) => {
                const data = d.data();
                teams[d.id] = {
                    player1Id: data.player1Id,
                    player2Id: data.player2Id,
                    fullNameP1: data.fullNameP1,
                    fullNameP2: data.fullNameP2,
                };
                if (data.player1Id && data.fullNameP1) names[data.player1Id] = data.fullNameP1;
                if (data.player2Id && data.fullNameP2) names[data.player2Id] = data.fullNameP2;
            });
            setTeamMap((prev) => ({ ...prev, ...teams }));
            if (Object.keys(names).length > 0) {
                setUserMap((prev) => ({ ...prev, ...names }));
            }
        });

        return () => {
            unsubRegs();
            unsubTeams();
        };
    }, [eventId, authLoading, user]);

    // Real-Time Audit Log Subscription with Server Fallback
    useEffect(() => {
        if (!eventId || authLoading || !user) return;

        setLoading(true);
        // Single field index to prevent FAILED_PRECONDITION 9 composite index errors
        const q = query(collection(db, "auditLogs"), where("eventId", "==", eventId));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const rawLogs: AuditLogEntry[] = [];
                snapshot.forEach((d) => {
                    rawLogs.push({ ...(d.data() as AuditLogEntry), auditId: d.id });
                });

                // In-memory sort by descending timestamp
                rawLogs.sort((a, b) => {
                    const timeA = getTimestampMillis(a.timestamp);
                    const timeB = getTimestampMillis(b.timestamp);
                    return timeB - timeA;
                });

                setLogs(rawLogs);
                setLoading(false);
            },
            async (err) => {
                console.warn("[AdminActivityFeed] Snapshot notice, attempting server API fallback:", err);
                try {
                    const token = await user.getIdToken();
                    const res = await fetch(`/api/admin/events/${eventId}/audit-logs`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const json = await res.json();
                    if (json.success && Array.isArray(json.logs)) {
                        const rawLogs: AuditLogEntry[] = json.logs;
                        rawLogs.sort((a, b) => {
                            const timeA = getTimestampMillis(a.timestamp);
                            const timeB = getTimestampMillis(b.timestamp);
                            return timeB - timeA;
                        });
                        setLogs(rawLogs);
                    }
                } catch (fallbackErr) {
                    console.error("[AdminActivityFeed] Server fallback failed:", fallbackErr);
                } finally {
                    setLoading(false);
                }
            }
        );

        return () => unsubscribe();
    }, [eventId, authLoading, user]);

    // Scan logs for missing UIDs (e.g. from reasons or target IDs) and fetch user profiles
    useEffect(() => {
        if (logs.length === 0 || !user) return;

        const candidateUids = new Set<string>();
        logs.forEach((log) => {
            if (log.actorUid && log.actorUid.length >= 20) {
                candidateUids.add(log.actorUid);
            }
            if (log.entityType === "REGISTRATION" && log.entityId) {
                const possibleUid = log.entityId.replace(`${eventId}_`, "");
                if (possibleUid && possibleUid.length >= 20) {
                    candidateUids.add(possibleUid);
                }
            }
            if (log.reason) {
                const matches = log.reason.match(/[a-zA-Z0-9]{20,36}/g);
                if (matches) {
                    matches.forEach((m) => {
                        if (!m.startsWith("corr_") && !m.startsWith("EVENT") && m.length >= 20) {
                            candidateUids.add(m);
                        }
                    });
                }
            }
        });

        const missingUids = Array.from(candidateUids).filter((uid) => !userMap[uid]);
        if (missingUids.length === 0) return;

        let isCancelled = false;
        Promise.all(
            missingUids.map(async (uid) => {
                try {
                    const uSnap = await getDoc(doc(db, "users", uid));
                    if (uSnap.exists()) {
                        const uData = uSnap.data();
                        const name = uData.displayName || uData.fullName || uData.name;
                        if (name) return { uid, name };
                    }
                } catch (err) {
                    // Ignore individual user fetch error
                }
                return null;
            })
        ).then((results) => {
            if (isCancelled) return;
            const newNames: Record<string, string> = {};
            results.forEach((res) => {
                if (res) newNames[res.uid] = res.name;
            });
            if (Object.keys(newNames).length > 0) {
                setUserMap((prev) => ({ ...prev, ...newNames }));
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [logs, userMap, eventId, user]);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // Helper to resolve player name for log header
    const getLogPlayerName = (entry: AuditLogEntry): string | null => {
        if (entry.actorName && entry.actorName.trim()) {
            return entry.actorName;
        }

        // For FREE_AGENT_REVERTED: the entity is the registration that was reverted to free agent
        if (entry.action === "FREE_AGENT_REVERTED") {
            if (entry.entityType === "REGISTRATION") {
                const targetPlayerId = entry.entityId.replace(`${eventId}_`, "");
                if (userMap[targetPlayerId]) return userMap[targetPlayerId];
            }
            if (entry.actorUid && userMap[entry.actorUid]) return userMap[entry.actorUid];
        }

        // For WITHDRAWN: check actor, registration target, or team members
        if (entry.action === "WITHDRAWN") {
            if (entry.actorUid && userMap[entry.actorUid]) {
                return userMap[entry.actorUid];
            }
            if (entry.entityType === "REGISTRATION") {
                const targetPlayerId = entry.entityId.replace(`${eventId}_`, "");
                if (userMap[targetPlayerId]) return userMap[targetPlayerId];
            }
            if (entry.entityType === "TEAM" && teamMap[entry.entityId]) {
                const team = teamMap[entry.entityId];
                if (entry.actorUid === team.player1Id && team.fullNameP1) return team.fullNameP1;
                if (entry.actorUid === team.player2Id && team.fullNameP2) return team.fullNameP2;
            }
        }

        // For CANCELLED / REJECTED: check actor or registration target
        if (entry.action === "CANCELLED" || entry.action === "REJECTED") {
            if (entry.actorUid && userMap[entry.actorUid]) {
                return userMap[entry.actorUid];
            }
            if (entry.entityType === "REGISTRATION") {
                const targetPlayerId = entry.entityId.replace(`${eventId}_`, "");
                if (userMap[targetPlayerId]) return userMap[targetPlayerId];
            }
        }

        // General fallback
        if (entry.actorUid && userMap[entry.actorUid]) {
            return userMap[entry.actorUid];
        }
        if (entry.entityType === "REGISTRATION") {
            const targetPlayerId = entry.entityId.replace(`${eventId}_`, "");
            if (userMap[targetPlayerId]) return userMap[targetPlayerId];
        }

        return null;
    };

    // Helper to format audit log reason by replacing raw UIDs and enriching text with player names
    const formatLogReason = (entry: AuditLogEntry): string => {
        if (!entry.reason) return "";
        let formatted = entry.reason;

        // Replace any raw UIDs in reason with resolved user names
        Object.entries(userMap).forEach(([uid, name]) => {
            if (uid && name && formatted.includes(uid)) {
                formatted = formatted.split(uid).join(name);
            }
        });

        const playerName = getLogPlayerName(entry);

        if (entry.action === "WITHDRAWN") {
            if (formatted === "Withdrew from waitlisted team" || formatted === "Player withdrew from waitlisted team") {
                return playerName ? `${playerName} withdrew from waitlisted team` : formatted;
            }
            if (formatted === "PLAYER_WITHDREW_FROM_WAITLIST") {
                return playerName ? `${playerName} withdrew from waitlist` : "Player withdrew from waitlist";
            }
            if (formatted === "PLAYER_WITHDREW_FROM_PENDING" || formatted === "Free agent withdrew from event") {
                return playerName ? `${playerName} withdrew from free agent pool` : "Withdrew from free agent pool";
            }
            if (formatted === "Confirmed player standard withdrawal" || formatted === "Standard withdrawal confirmed") {
                return playerName ? `${playerName} withdrew from confirmed team` : "Player withdrew from confirmed team";
            }
            if (formatted === "Confirmed player late withdrawal" || formatted === "Late withdrawal confirmed") {
                return playerName ? `${playerName} withdrew late from confirmed team` : "Player withdrew late from confirmed team";
            }
        }

        if (entry.action === "FREE_AGENT_REVERTED") {
            const targetPlayerId = entry.entityId?.replace(`${eventId}_`, "");
            const targetName = userMap[targetPlayerId] || (entry.entityType === "REGISTRATION" ? playerName : null);
            const actorName = entry.actorName || (entry.actorUid && userMap[entry.actorUid] ? userMap[entry.actorUid] : null);

            if (formatted === "Partner withdrew from waitlist; returned to free agent pool") {
                if (actorName && targetName && actorName !== targetName) {
                    return `${actorName} withdrew from waitlist; ${targetName} returned to free agent pool`;
                } else if (targetName) {
                    return `Partner withdrew from waitlist; ${targetName} returned to free agent pool`;
                }
            }
            if (formatted === "Partner declined invitation; returned to free agent") {
                if (actorName && targetName && actorName !== targetName) {
                    return `${actorName} declined invitation; ${targetName} returned to free agent pool`;
                } else if (targetName) {
                    return `Partner declined invitation; ${targetName} returned to free agent pool`;
                }
            }
            if (formatted === "Cancelled outgoing invitation; returned to free agent") {
                return playerName ? `${playerName} cancelled invitation and returned to free agent pool` : formatted;
            }
        }

        return formatted;
    };

    // Filter Logic
    const filteredLogs = useMemo(() => {
        return logs.filter((log) => {
            // Correlation filter
            if (selectedCorrelationId && log.correlationId !== selectedCorrelationId) {
                return false;
            }

            // Category filter
            if (filterCategory === "registrations") {
                if (log.action !== "REGISTERED") return false;
            } else if (filterCategory === "withdrawals") {
                if (!["WITHDRAWN", "CANCELLED"].includes(log.action)) return false;
            } else if (filterCategory === "promotions") {
                if (!["PROMOTED", "DEMOTED"].includes(log.action)) return false;
            } else if (filterCategory === "teams") {
                if (
                    ![
                        "INVITED",
                        "ACCEPTED",
                        "REJECTED",
                        "SUPERSEDED",
                        "FREE_AGENT_REVERTED",
                    ].includes(log.action)
                ) {
                    return false;
                }
            }

            // Search query filter
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const resolvedName = getLogPlayerName(log) || "";
                const formattedReason = formatLogReason(log);
                const matchAction = log.action.toLowerCase().includes(q);
                const matchActor = (log.actorName || "").toLowerCase().includes(q) || resolvedName.toLowerCase().includes(q);
                const matchReason = (log.reason || "").toLowerCase().includes(q) || formattedReason.toLowerCase().includes(q);
                const matchCorr = (log.correlationId || "").toLowerCase().includes(q);
                const matchEntityId = (log.entityId || "").toLowerCase().includes(q);
                if (!matchAction && !matchActor && !matchReason && !matchCorr && !matchEntityId) {
                    return false;
                }
            }

            return true;
        });
    }, [logs, selectedCorrelationId, filterCategory, searchQuery, userMap, teamMap]);

    const getActionBadgeColor = (action: string) => {
        switch (action) {
            case "PROMOTED":
                return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
            case "ACCEPTED":
                return "bg-blue-500/10 text-blue-400 border-blue-500/30";
            case "REGISTERED":
                return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
            case "WITHDRAWN":
                return "bg-red-500/10 text-red-400 border-red-500/30";
            case "CANCELLED":
            case "REJECTED":
                return "bg-amber-500/10 text-amber-400 border-amber-500/30";
            case "SUPERSEDED":
                return "bg-purple-500/10 text-purple-400 border-purple-500/30";
            case "FREE_AGENT_REVERTED":
                return "bg-orange-500/10 text-orange-400 border-orange-500/30";
            case "DEMOTED":
                return "bg-rose-500/10 text-rose-400 border-rose-500/30";
            case "CAPACITY_CHANGED":
                return "bg-indigo-500/10 text-indigo-400 border-indigo-500/30";
            default:
                return "bg-gray-800 text-gray-300 border-gray-700";
        }
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case "PROMOTED":
                return <TrendingUp className="w-4 h-4 text-emerald-400" />;
            case "ACCEPTED":
                return <CheckCircle2 className="w-4 h-4 text-blue-400" />;
            case "REGISTERED":
                return <UserCheck className="w-4 h-4 text-cyan-400" />;
            case "WITHDRAWN":
                return <UserMinus className="w-4 h-4 text-red-400" />;
            case "CANCELLED":
            case "REJECTED":
                return <XCircle className="w-4 h-4 text-amber-400" />;
            case "SUPERSEDED":
                return <Users className="w-4 h-4 text-purple-400" />;
            case "FREE_AGENT_REVERTED":
                return <RefreshCw className="w-4 h-4 text-orange-400" />;
            default:
                return <Activity className="w-4 h-4 text-gray-400" />;
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
                <ShieldAlert className="w-16 h-16 text-red-500 mb-4 animate-bounce" />
                <h1 className="text-2xl font-bold mb-2">Admin Access Required</h1>
                <p className="text-gray-400 mb-6 text-center max-w-md">
                    The Event Activity Feed is restricted to tournament directors and administrators.
                </p>
                <Button onClick={() => router.push(`/events/${eventId}`)}>
                    Return to Event
                </Button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white selection:bg-orange-500 selection:text-white pb-24">
            <Header user={user} showBack={true} onBack={() => router.push(`/events/${eventId}`)} />

            <main className="container max-w-6xl mx-auto px-4 pt-24">
                {/* Header Navigation */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-white hover:bg-gray-800"
                            onClick={() => router.push(`/events/${eventId}`)}
                        >
                            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Event
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                            <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
                            <span>Live Firestore Stream</span>
                        </div>
                    </div>
                </div>

                {/* Title & Stats */}
                <div className="bg-linear-to-br from-gray-900/90 to-gray-950/90 border border-gray-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl mb-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <div className="flex items-center gap-2.5 text-orange-400 text-sm font-semibold tracking-wider uppercase mb-2">
                                <Activity className="w-4 h-4" />
                                <span>Audit Trail & Cascade Tracing</span>
                            </div>
                            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
                                {eventTitle}
                            </h1>
                            <p className="text-gray-400 text-sm max-w-xl">
                                Real-time append-only transaction ledger showing state transitions, waitlist promotions, partner proposals, and correlation IDs.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div className="bg-gray-950/60 border border-gray-800/80 rounded-2xl p-4 text-center">
                                <div className="text-2xl font-bold text-white">{logs.length}</div>
                                <div className="text-xs text-gray-400 font-medium mt-0.5">Total Logs</div>
                            </div>
                            <div className="bg-gray-950/60 border border-gray-800/80 rounded-2xl p-4 text-center">
                                <div className="text-2xl font-bold text-emerald-400">
                                    {logs.filter((l) => l.action === "PROMOTED").length}
                                </div>
                                <div className="text-xs text-gray-400 font-medium mt-0.5">Promotions</div>
                            </div>
                            <div className="bg-gray-950/60 border border-gray-800/80 rounded-2xl p-4 text-center col-span-2 sm:col-span-1">
                                <div className="text-2xl font-bold text-red-400">
                                    {logs.filter((l) => l.action === "WITHDRAWN").length}
                                </div>
                                <div className="text-xs text-gray-400 font-medium mt-0.5">Withdrawals</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filter Toolbar */}
                <div className="space-y-4 mb-6">
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                        {/* Search Bar */}
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Filter by player, reason, correlation ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-gray-900/80 border-gray-800 text-white rounded-xl placeholder:text-gray-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery("")}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* Correlation ID Active Filter Banner */}
                        {selectedCorrelationId && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs">
                                <Filter className="w-3.5 h-3.5" />
                                <span>Filtering Cascade: </span>
                                <code className="font-mono bg-orange-500/20 px-1 py-0.5 rounded">
                                    {selectedCorrelationId}
                                </code>
                                <button
                                    onClick={() => setSelectedCorrelationId(null)}
                                    className="ml-1 text-orange-300 hover:text-white underline text-xs"
                                >
                                    Clear
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Category Tabs */}
                    <Tabs
                        value={filterCategory}
                        onValueChange={setFilterCategory}
                        className="w-full"
                    >
                        <TabsList className="bg-gray-900/90 border border-gray-800 p-1 rounded-2xl flex flex-wrap h-auto gap-1">
                            <TabsTrigger
                                value="all"
                                className="rounded-xl data-[state=active]:bg-orange-500 data-[state=active]:text-white text-xs sm:text-sm py-2 px-3 sm:px-4"
                            >
                                All Activities ({logs.length})
                            </TabsTrigger>
                            <TabsTrigger
                                value="registrations"
                                className="rounded-xl data-[state=active]:bg-orange-500 data-[state=active]:text-white text-xs sm:text-sm py-2 px-3 sm:px-4"
                            >
                                Registrations
                            </TabsTrigger>
                            <TabsTrigger
                                value="withdrawals"
                                className="rounded-xl data-[state=active]:bg-orange-500 data-[state=active]:text-white text-xs sm:text-sm py-2 px-3 sm:px-4"
                            >
                                Withdrawals
                            </TabsTrigger>
                            <TabsTrigger
                                value="promotions"
                                className="rounded-xl data-[state=active]:bg-orange-500 data-[state=active]:text-white text-xs sm:text-sm py-2 px-3 sm:px-4"
                            >
                                Promotions & Capacity
                            </TabsTrigger>
                            <TabsTrigger
                                value="teams"
                                className="rounded-xl data-[state=active]:bg-orange-500 data-[state=active]:text-white text-xs sm:text-sm py-2 px-3 sm:px-4"
                            >
                                Teams & Proposals
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                {/* Timeline Feed */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center p-12 text-gray-400">
                        <RefreshCw className="w-8 h-8 text-orange-500 animate-spin mb-3" />
                        <p className="text-sm">Streaming audit trail...</p>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="bg-gray-900/40 border border-gray-800/80 rounded-3xl p-12 text-center text-gray-400">
                        <Activity className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                        <h3 className="text-lg font-semibold text-white mb-1">No Activity Found</h3>
                        <p className="text-sm text-gray-500 max-w-sm mx-auto">
                            {searchQuery || selectedCorrelationId || filterCategory !== "all"
                                ? "No audit log entries match your active filters."
                                : "No registration or team events have been recorded for this tournament yet."}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3 relative before:absolute before:inset-0 before:left-5 sm:before:left-8 before:w-0.5 before:bg-gray-800/60">
                        {filteredLogs.map((entry) => {
                            const date = entry.timestamp ? new Date(getTimestampMillis(entry.timestamp)) : new Date();
                            const formattedDate = format(date, "MMM d, yyyy · h:mm:ss a");

                            return (
                                <div
                                    key={entry.auditId}
                                    className="relative flex items-start gap-4 sm:gap-6 group"
                                >
                                    {/* Timeline Marker */}
                                    <div className="relative z-10 w-10 sm:w-16 flex justify-center pt-3 shrink-0">
                                        <div className="p-2 sm:p-2.5 rounded-full bg-gray-900 border border-gray-700/80 shadow-md group-hover:border-orange-500/60 transition-colors">
                                            {getActionIcon(entry.action)}
                                        </div>
                                    </div>

                                    {/* Event Card */}
                                    <div className="flex-1 bg-gray-900/70 hover:bg-gray-900/90 border border-gray-800 hover:border-gray-700/80 rounded-2xl p-4 sm:p-5 transition-all shadow-lg backdrop-blur-md">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge
                                                    variant="outline"
                                                    className={`px-2.5 py-0.5 rounded-full font-bold text-xs uppercase tracking-wide border ${getActionBadgeColor(
                                                        entry.action
                                                    )}`}
                                                >
                                                    {entry.action}
                                                </Badge>

                                                <Badge
                                                    variant="outline"
                                                    className="border-gray-800 bg-gray-950/80 text-gray-400 text-xs"
                                                >
                                                    {entry.entityType}
                                                </Badge>

                                                {getLogPlayerName(entry) && (
                                                    <span className="text-sm font-semibold text-white">
                                                        {getLogPlayerName(entry)}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
                                                <Clock className="w-3.5 h-3.5" />
                                                <span>{formattedDate}</span>
                                            </div>
                                        </div>

                                        {/* Reason or Description */}
                                        {entry.reason && (
                                            <p className="text-sm text-gray-300 font-medium mb-3">
                                                {formatLogReason(entry)}
                                            </p>
                                        )}

                                        {/* State Transition Diff */}
                                        {(entry.previousState || entry.newState) && (
                                            <div className="bg-gray-950/80 border border-gray-800/80 rounded-xl p-3 mb-3 text-xs flex flex-wrap items-center gap-2 sm:gap-3">
                                                <span className="text-gray-500 font-medium">Transition:</span>
                                                <div className="flex items-center gap-2 font-mono">
                                                    <span className="text-gray-400 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
                                                        {entry.previousState?.status
                                                            ? String(entry.previousState.status)
                                                            : "NEW"}
                                                    </span>
                                                    <span className="text-orange-400">→</span>
                                                    <span className="text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30 font-semibold">
                                                        {entry.newState?.status
                                                            ? String(entry.newState.status)
                                                            : "UPDATED"}
                                                    </span>
                                                </div>
                                                {entry.newState?.waitlistSequence !== undefined && (
                                                    <span className="text-gray-400 text-[11px]">
                                                        (Waitlist #{String(entry.newState.waitlistSequence)})
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Correlation ID & Metadata Footer */}
                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-800/50 text-xs">
                                            <div className="flex items-center gap-2 font-mono text-gray-400">
                                                <span className="text-gray-500">Target ID:</span>
                                                <span className="text-gray-300 truncate max-w-[120px] sm:max-w-[200px]">
                                                    {entry.entityId}
                                                </span>
                                            </div>

                                            {entry.correlationId && (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-gray-500 text-[11px]">Batch:</span>
                                                    <button
                                                        onClick={() => setSelectedCorrelationId(entry.correlationId || null)}
                                                        className="font-mono text-[11px] bg-gray-950 hover:bg-orange-500/10 hover:text-orange-400 text-gray-400 px-2 py-0.5 rounded border border-gray-800 transition-colors"
                                                        title="Filter cascade by this correlation ID"
                                                    >
                                                        {entry.correlationId}
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            handleCopy(entry.correlationId || "", entry.auditId)
                                                        }
                                                        className="text-gray-500 hover:text-white p-1 rounded transition-colors"
                                                        title="Copy correlation ID"
                                                    >
                                                        {copiedId === entry.auditId ? (
                                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-3.5 h-3.5" />
                                                        )}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            <BottomNav />
        </div>
    );
}

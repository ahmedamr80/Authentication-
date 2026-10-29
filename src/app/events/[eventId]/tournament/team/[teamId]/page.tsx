"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import {
    TournamentDocument,
    TournamentMatch,
    evaluateMatchSets,
    normalizeMatchStatus,
} from "@/lib/tournaments/types";
import {
    buildTeamTournamentSummary,
    resolveMatchSideTeamId,
} from "@/lib/tournaments/teamMatchesQuery";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ArrowLeft,
    Calendar,
    CheckCircle2,
    Clock,
    Flame,
    Loader2,
    Trophy,
    Users,
} from "lucide-react";

export default function TournamentTeamFilterPage({
    params,
}: {
    params: Promise<{ eventId: string; teamId: string }>;
}) {
    const { eventId, teamId } = use(params);
    const decodedTeamId = decodeURIComponent(teamId);
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);
    const [tournament, setTournament] = useState<TournamentDocument | null>(null);
    const [statusFilter, setStatusFilter] = useState<"ALL" | "CLOSED" | "ONGOING" | "NOT_STARTED">("ALL");

    useEffect(() => {
        const q = query(collection(db, "tournaments"), where("eventId", "==", eventId));
        const unsubscribe = onSnapshot(
            q,
            (snap) => {
                if (snap.empty) {
                    setTournament(null);
                    setLoading(false);
                    return;
                }
                const docSnap = snap.docs[0];
                const data = docSnap.data();
                const merged: TournamentDocument = {
                    ...(data as any),
                    id: docSnap.id,
                    config: {
                        ...(data.config || {}),
                        mode: data.config?.mode || data.mode || "americano",
                        unitType: data.config?.unitType || data.unitType || "players",
                        numCourts: data.config?.numCourts || 2,
                        numRounds: data.config?.numRounds || 7,
                        numberOfSets:
                            data.config?.numberOfSets ||
                            data.config?.matchFormat?.numberOfSets ||
                            data.matchFormat?.numberOfSets ||
                            1,
                    },
                };
                setTournament(merged);
                setLoading(false);
            },
            (err) => {
                console.error("Failed to load tournament for team view:", err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [eventId]);

    const summary = useMemo(() => {
        if (!tournament) return null;
        return buildTeamTournamentSummary(tournament, decodedTeamId);
    }, [tournament, decodedTeamId]);

    const visibleMatches = useMemo(() => {
        if (!summary) return [];
        if (statusFilter === "CLOSED") return summary.closedMatches;
        if (statusFilter === "ONGOING") return summary.ongoingMatches;
        if (statusFilter === "NOT_STARTED") return summary.upcomingMatches;
        return summary.matches;
    }, [summary, statusFilter]);

    if (loading || authLoading) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.push(`/events/${eventId}/tournament`)} />
                <div className="flex-1 flex flex-col items-center justify-center p-6 pt-24 text-center">
                    <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
                    <p className="text-slate-400 font-medium">Loading team tournament record...</p>
                </div>
                <BottomNav />
            </div>
        );
    }

    if (!tournament || !summary) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} showBack={true} onBack={() => router.push(`/events/${eventId}/tournament`)} />
                <div className="flex-1 max-w-lg mx-auto p-6 pt-24 flex flex-col items-center justify-center text-center">
                    <Users className="w-12 h-12 text-slate-500 mb-3" />
                    <h1 className="text-xl font-bold text-white mb-2">Team Record Not Found</h1>
                    <p className="text-sm text-slate-400 mb-6">
                        Could not find tournament matches for this team in the current event.
                    </p>
                    <Button
                        variant="outline"
                        className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
                        onClick={() => router.push(`/events/${eventId}/tournament`)}
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Tournament
                    </Button>
                </div>
                <BottomNav />
            </div>
        );
    }

    const renderMatchCard = (m: TournamentMatch) => {
        const canonicalStatus = normalizeMatchStatus(m.status ?? m.result?.status);
        const sideAId = resolveMatchSideTeamId(m, "A", tournament);
        const sideBId = resolveMatchSideTeamId(m, "B", tournament);
        const isTeamSideA =
            sideAId === summary.teamId ||
            m.teamAId === summary.teamId ||
            (m.team1PlayerIds || []).includes(decodedTeamId);

        const evalRes = evaluateMatchSets(
            m.sets ?? m.result?.sets,
            m.result?.scoreA ?? 0,
            m.result?.scoreB ?? 0
        );
        const isClosed = canonicalStatus === "CLOSED";
        const isOngoing = canonicalStatus === "ONGOING";
        const isDraw = isClosed && (evalRes.isDraw || m.isDraw || m.result?.isDraw || m.result?.winner === "Draw");
        const isSideAWinner = isClosed && !isDraw && (evalRes.winnerSide === "Team 1" || m.result?.winner === "Team 1");
        const isSideBWinner = isClosed && !isDraw && (evalRes.winnerSide === "Team 2" || m.result?.winner === "Team 2");

        const sideABorderStyle = isClosed
            ? isDraw
                ? { border: "2px solid #f59e0b" }
                : isSideAWinner
                ? { border: "2px solid #22c55e" }
                : { border: "2px solid #ef4444" }
            : undefined;

        const sideBBorderStyle = isClosed
            ? isDraw
                ? { border: "2px solid #f59e0b" }
                : isSideBWinner
                ? { border: "2px solid #22c55e" }
                : { border: "2px solid #ef4444" }
            : undefined;

        const setsToShow = m.sets && m.sets.length > 0 ? m.sets : m.result?.sets || [];

        return (
            <div
                key={m.matchId}
                className={`rounded-2xl border p-4 transition-all ${
                    isClosed
                        ? "bg-emerald-950/15 border-emerald-500/30"
                        : isOngoing
                        ? "bg-amber-950/20 border-amber-500/40"
                        : "bg-red-950/15 border-red-500/30"
                }`}
            >
                <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                        <Badge className="bg-slate-900 border-slate-700 text-slate-200 text-[11px]">
                            Round {m.roundIdx + 1}
                        </Badge>
                        <Badge className="bg-slate-900 border-slate-800 text-amber-400 text-[11px]">
                            {m.courtName || `Court ${m.courtIdx + 1}`}
                        </Badge>
                    </div>

                    {isClosed ? (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[11px] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Closed
                        </Badge>
                    ) : isOngoing ? (
                        <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[11px] flex items-center gap-1">
                            <Flame className="w-3 h-3" /> Ongoing
                        </Badge>
                    ) : (
                        <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[11px] flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Not Started
                        </Badge>
                    )}
                </div>

                <div className="space-y-2.5">
                    {/* Side A */}
                    <div
                        style={sideABorderStyle}
                        onClick={() => {
                            if (sideAId) {
                                router.push(
                                    `/events/${eventId}/tournament/team/${encodeURIComponent(sideAId)}`
                                );
                            }
                        }}
                        className={`cursor-pointer p-3 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                            isTeamSideA ? "bg-slate-900/95" : "bg-slate-950/80 hover:bg-slate-900"
                        } ${!isClosed ? "border border-slate-800" : ""}`}
                    >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="flex items-center -space-x-2 shrink-0">
                                {(m.team1Photos && m.team1Photos.length > 0 ? m.team1Photos : [null]).map(
                                    (photo, idx) => (
                                        <Avatar key={idx} className="h-7 w-7 border-2 border-slate-900">
                                            <AvatarImage src={photo || undefined} />
                                            <AvatarFallback className="bg-slate-800 text-[10px] font-bold text-slate-200">
                                                {m.team1Names?.[idx]?.charAt(0) || "A"}
                                            </AvatarFallback>
                                        </Avatar>
                                    )
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <span className="text-sm font-bold text-white truncate block hover:text-amber-300 transition-colors">
                                    {m.team1Names && m.team1Names.length > 0
                                        ? m.team1Names.join(" & ")
                                        : "Team A"}
                                </span>
                                {isTeamSideA && (
                                    <span className="text-[10px] text-amber-400 font-semibold">
                                        Viewing Team
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                            {setsToShow.length > 1 ? (
                                setsToShow.map((s, idx) => (
                                    <span
                                        key={idx}
                                        className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-extrabold text-white"
                                    >
                                        {canonicalStatus === "NOT_STARTED" ? "-" : s.teamAScore}
                                        {s.tieBreak &&
                                        (s.tieBreak.teamAScore > 0 || s.tieBreak.teamBScore > 0) ? (
                                            <sup className="text-[9px] text-amber-400 ml-0.5">
                                                ({s.tieBreak.teamAScore})
                                            </sup>
                                        ) : null}
                                    </span>
                                ))
                            ) : (
                                <span className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-sm font-extrabold text-white">
                                    {canonicalStatus === "NOT_STARTED"
                                        ? "-"
                                        : setsToShow[0]?.teamAScore ?? m.result?.scoreA ?? 0}
                                    {setsToShow[0]?.tieBreak &&
                                    (setsToShow[0].tieBreak.teamAScore > 0 ||
                                        setsToShow[0].tieBreak.teamBScore > 0) ? (
                                        <sup className="text-[10px] text-amber-400 ml-0.5">
                                            ({setsToShow[0].tieBreak.teamAScore})
                                        </sup>
                                    ) : null}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Side B */}
                    <div
                        style={sideBBorderStyle}
                        onClick={() => {
                            if (sideBId) {
                                router.push(
                                    `/events/${eventId}/tournament/team/${encodeURIComponent(sideBId)}`
                                );
                            }
                        }}
                        className={`cursor-pointer p-3 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                            !isTeamSideA ? "bg-slate-900/95" : "bg-slate-950/80 hover:bg-slate-900"
                        } ${!isClosed ? "border border-slate-800" : ""}`}
                    >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="flex items-center -space-x-2 shrink-0">
                                {(m.team2Photos && m.team2Photos.length > 0 ? m.team2Photos : [null]).map(
                                    (photo, idx) => (
                                        <Avatar key={idx} className="h-7 w-7 border-2 border-slate-900">
                                            <AvatarImage src={photo || undefined} />
                                            <AvatarFallback className="bg-slate-800 text-[10px] font-bold text-slate-200">
                                                {m.team2Names?.[idx]?.charAt(0) || "B"}
                                            </AvatarFallback>
                                        </Avatar>
                                    )
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <span className="text-sm font-bold text-white truncate block hover:text-amber-300 transition-colors">
                                    {m.team2Names && m.team2Names.length > 0
                                        ? m.team2Names.join(" & ")
                                        : "Team B"}
                                </span>
                                {!isTeamSideA && (
                                    <span className="text-[10px] text-amber-400 font-semibold">
                                        Viewing Team
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                            {setsToShow.length > 1 ? (
                                setsToShow.map((s, idx) => (
                                    <span
                                        key={idx}
                                        className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-extrabold text-white"
                                    >
                                        {canonicalStatus === "NOT_STARTED" ? "-" : s.teamBScore}
                                        {s.tieBreak &&
                                        (s.tieBreak.teamAScore > 0 || s.tieBreak.teamBScore > 0) ? (
                                            <sup className="text-[9px] text-amber-400 ml-0.5">
                                                ({s.tieBreak.teamBScore})
                                            </sup>
                                        ) : null}
                                    </span>
                                ))
                            ) : (
                                <span className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-sm font-extrabold text-white">
                                    {canonicalStatus === "NOT_STARTED"
                                        ? "-"
                                        : setsToShow[0]?.teamBScore ?? m.result?.scoreB ?? 0}
                                    {setsToShow[0]?.tieBreak &&
                                    (setsToShow[0].tieBreak.teamAScore > 0 ||
                                        setsToShow[0].tieBreak.teamBScore > 0) ? (
                                        <sup className="text-[10px] text-amber-400 ml-0.5">
                                            ({setsToShow[0].tieBreak.teamBScore})
                                        </sup>
                                    ) : null}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
            <Header
                user={user}
                showBack={true}
                onBack={() => router.push(`/events/${eventId}/tournament`)}
            />

            <main className="flex-1 max-w-4xl mx-auto w-full px-4 pt-24 sm:pt-28 pb-28 space-y-6">
                {/* Back & Tournament Context Bar */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/events/${eventId}/tournament`)}
                        className="bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800 hover:text-white"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Tournament Workspace
                    </Button>
                    <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-xs">
                        <Trophy className="w-3.5 h-3.5 mr-1.5" />
                        {tournament.title}
                    </Badge>
                </div>

                {/* Team Summary Hero Card */}
                <Card className="bg-slate-900 border-slate-800 overflow-hidden shadow-xl">
                    <CardHeader className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 border-b border-slate-800 pb-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3.5">
                                <div className="flex items-center -space-x-3 shrink-0">
                                    {(summary.playerPhotos.length > 0 ? summary.playerPhotos : [null]).map(
                                        (photo, idx) => (
                                            <Avatar
                                                key={idx}
                                                className="h-14 w-14 border-2 border-amber-500/50 shadow-md"
                                            >
                                                <AvatarImage src={photo || undefined} />
                                                <AvatarFallback className="bg-slate-800 text-amber-300 text-base font-bold">
                                                    {summary.playerNames[idx]?.charAt(0) ||
                                                        summary.teamName.charAt(0) ||
                                                        "T"}
                                                </AvatarFallback>
                                            </Avatar>
                                        )
                                    )}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {summary.rank && (
                                            <Badge className="bg-amber-500 text-slate-950 font-extrabold text-xs">
                                                Rank #{summary.rank}
                                            </Badge>
                                        )}
                                        <span className="text-xs text-slate-400 font-medium">
                                            Tournament Scoped Record
                                        </span>
                                    </div>
                                    <CardTitle className="text-xl sm:text-2xl font-extrabold text-white mt-1">
                                        {summary.teamName}
                                    </CardTitle>
                                    {summary.subtitle && (
                                        <p className="text-xs text-slate-400 mt-0.5">{summary.subtitle}</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-center">
                                <div className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-center">
                                    <span className="text-[10px] uppercase tracking-wider text-amber-300 block font-semibold">
                                        Points
                                    </span>
                                    <span className="text-2xl font-black text-amber-400">
                                        {summary.points}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="p-5">
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                                    Played
                                </span>
                                <span className="text-lg font-extrabold text-white">{summary.played}</span>
                            </div>
                            <div className="bg-emerald-950/25 p-3 rounded-xl border border-emerald-500/30 text-center">
                                <span className="text-[10px] text-emerald-300 uppercase font-semibold block">
                                    Won
                                </span>
                                <span className="text-lg font-extrabold text-emerald-400">
                                    {summary.wins}
                                </span>
                            </div>
                            <div className="bg-amber-950/25 p-3 rounded-xl border border-amber-500/30 text-center">
                                <span className="text-[10px] text-amber-300 uppercase font-semibold block">
                                    Drawn
                                </span>
                                <span className="text-lg font-extrabold text-amber-400">
                                    {summary.draws}
                                </span>
                            </div>
                            <div className="bg-red-950/25 p-3 rounded-xl border border-red-500/30 text-center">
                                <span className="text-[10px] text-red-300 uppercase font-semibold block">
                                    Lost
                                </span>
                                <span className="text-lg font-extrabold text-red-400">
                                    {summary.losses}
                                </span>
                            </div>
                            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                                    Games (GF/GA)
                                </span>
                                <span className="text-sm font-bold text-slate-200 mt-0.5 block">
                                    {summary.gf} / {summary.ga}
                                </span>
                            </div>
                            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                                    Game Diff
                                </span>
                                <span
                                    className={`text-lg font-extrabold ${
                                        summary.diff > 0
                                            ? "text-emerald-400"
                                            : summary.diff < 0
                                            ? "text-red-400"
                                            : "text-slate-300"
                                    }`}
                                >
                                    {summary.diff > 0 ? `+${summary.diff}` : summary.diff}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Status Filter Pills */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-amber-400" />
                        Team Matches ({visibleMatches.length})
                    </h2>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {(
                            [
                                { id: "ALL", label: `All (${summary.matches.length})` },
                                { id: "ONGOING", label: `Ongoing (${summary.ongoingMatches.length})` },
                                { id: "NOT_STARTED", label: `Not Started (${summary.upcomingMatches.length})` },
                                { id: "CLOSED", label: `Closed (${summary.closedMatches.length})` },
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setStatusFilter(tab.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                                    statusFilter === tab.id
                                        ? "bg-amber-500 text-slate-950 border-amber-400"
                                        : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Matches List */}
                {visibleMatches.length === 0 ? (
                    <Card className="bg-slate-900 border-slate-800 p-8 text-center">
                        <p className="text-sm text-slate-400">
                            No matches found matching the selected status filter.
                        </p>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {visibleMatches.map((m) => renderMatchCard(m))}
                    </div>
                )}
            </main>

            <BottomNav />
        </div>
    );
}

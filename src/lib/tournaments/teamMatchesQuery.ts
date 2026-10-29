import {
    and,
    collection,
    doc,
    getDoc,
    getDocs,
    or,
    query,
    where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    TournamentDocument,
    TournamentMatch,
    TournamentStandingsEntry,
    evaluateMatchSets,
    isMatchClosed,
    isMatchOngoing,
    normalizeMatchStatus,
} from "./types";
import { calculatePairStandings, calculatePlayerStandings } from "./standingsCalculator";

export interface TeamTournamentSummary {
    teamId: string;
    teamName: string;
    subtitle?: string;
    playerIds: string[];
    playerNames: string[];
    playerPhotos: (string | null)[];
    isPairEntity: boolean;
    rank: number | null;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    points: number;
    gf: number;
    ga: number;
    diff: number;
    setsWon: number;
    setsLost: number;
    setsDiff: number;
    matches: TournamentMatch[];
    closedMatches: TournamentMatch[];
    ongoingMatches: TournamentMatch[];
    upcomingMatches: TournamentMatch[];
}

/**
 * Resolves the canonical team identifier for Side A or Side B of a match.
 */
export function resolveMatchSideTeamId(
    match: TournamentMatch,
    side: "A" | "B",
    tournament?: TournamentDocument | null
): string {
    if (side === "A") {
        if (match.teamAId) return match.teamAId;
        if (match.pairAId) return match.pairAId;
        const pIds = (match.team1PlayerIds || []).map((pid) => String(pid));
        if (tournament?.pairs && tournament.pairs.length > 0 && pIds.length > 0) {
            const foundPair = tournament.pairs.find((pair) =>
                pair.playerIds.some((pid) => pIds.includes(String(pid)))
            );
            if (foundPair) return foundPair.pairId;
        }
        return pIds.length === 1 ? pIds[0] : pIds.join("__");
    } else {
        if (match.teamBId) return match.teamBId;
        if (match.pairBId) return match.pairBId;
        const pIds = (match.team2PlayerIds || []).map((pid) => String(pid));
        if (tournament?.pairs && tournament.pairs.length > 0 && pIds.length > 0) {
            const foundPair = tournament.pairs.find((pair) =>
                pair.playerIds.some((pid) => pIds.includes(String(pid)))
            );
            if (foundPair) return foundPair.pairId;
        }
        return pIds.length === 1 ? pIds[0] : pIds.join("__");
    }
}

/**
 * Checks whether a match involves the specified targetTeamId (as a pairId, composite side key, or individual playerId).
 */
export function doesMatchInvolveTeam(
    match: TournamentMatch,
    targetTeamId: string,
    tournament?: TournamentDocument | null
): boolean {
    if (!targetTeamId) return false;
    const decodedId = decodeURIComponent(targetTeamId);
    const sideAId = resolveMatchSideTeamId(match, "A", tournament);
    const sideBId = resolveMatchSideTeamId(match, "B", tournament);

    if (
        match.teamAId === decodedId ||
        match.teamBId === decodedId ||
        match.pairAId === decodedId ||
        match.pairBId === decodedId ||
        sideAId === decodedId ||
        sideBId === decodedId
    ) {
        return true;
    }

    const sideAStrIds = (match.team1PlayerIds || []).map((pid) => String(pid));
    const sideBStrIds = (match.team2PlayerIds || []).map((pid) => String(pid));

    if (sideAStrIds.includes(decodedId) || sideBStrIds.includes(decodedId)) {
        return true;
    }

    if (tournament?.pairs && tournament.pairs.length > 0) {
        const pair = tournament.pairs.find((p) => p.pairId === decodedId);
        if (pair) {
            const inSideA = pair.playerIds.some((pid) => sideAStrIds.includes(String(pid)));
            const inSideB = pair.playerIds.some((pid) => sideBStrIds.includes(String(pid)));
            if (inSideA || inSideB) return true;
        }
    }

    return false;
}

/**
 * Filters all matches in a tournament document that involve `targetTeamId`.
 */
export function filterTeamMatches(
    tournament: TournamentDocument,
    targetTeamId: string
): TournamentMatch[] {
    const matches = tournament.matches || [];
    return matches
        .filter((m) => doesMatchInvolveTeam(m, targetTeamId, tournament))
        .sort((a, b) => a.roundIdx - b.roundIdx || a.courtIdx - b.courtIdx);
}

/**
 * Executes the indexed Firestore query:
 * WHERE (teamAId == targetTeamId OR teamBId == targetTeamId) AND tournamentId == currentTournamentId
 * Falls back to the tournament document's embedded `matches` array when matches are stored inline.
 */
export async function queryTeamMatchesFromFirestore(
    currentTournamentId: string,
    targetTeamId: string
): Promise<{ tournament: TournamentDocument | null; matches: TournamentMatch[] }> {
    const decodedTeamId = decodeURIComponent(targetTeamId);

    // 1. Load the tournament document
    const tourneyRef = doc(db, "tournaments", currentTournamentId);
    const tourneySnap = await getDoc(tourneyRef);
    const tournament = tourneySnap.exists()
        ? ({ id: tourneySnap.id, ...tourneySnap.data() } as TournamentDocument)
        : null;

    // 2. Query indexed `matches` collection where (teamAId == targetTeamId OR teamBId == targetTeamId) AND tournamentId == currentTournamentId
    try {
        const matchesRef = collection(db, "matches");
        const q = query(
            matchesRef,
            and(
                where("tournamentId", "==", currentTournamentId),
                or(
                    where("teamAId", "==", decodedTeamId),
                    where("teamBId", "==", decodedTeamId)
                )
            )
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
            const indexedMatches = snap.docs
                .map((d) => d.data() as TournamentMatch)
                .sort((a, b) => a.roundIdx - b.roundIdx || a.courtIdx - b.courtIdx);
            return { tournament, matches: indexedMatches };
        }
    } catch {
        // Fallback to embedded tournament.matches below if collection is empty or rules restrict direct collection read
    }

    if (!tournament) {
        return { tournament: null, matches: [] };
    }

    return {
        tournament,
        matches: filterTeamMatches(tournament, decodedTeamId),
    };
}

/**
 * Computes full tournament-scoped summary and match breakdown for a team/competitor.
 */
export function buildTeamTournamentSummary(
    tournament: TournamentDocument,
    targetTeamId: string
): TeamTournamentSummary {
    const decodedId = decodeURIComponent(targetTeamId);
    const matches = filterTeamMatches(tournament, decodedId);

    const tourneyMode = tournament.mode || tournament.config?.mode || "americano";
    const isPairMode = Boolean(
        tournament.pairs &&
            tournament.pairs.length > 0 &&
            (tourneyMode === "round_robin" ||
                tourneyMode === "knockout" ||
                tourneyMode === "round_robin_knockout" ||
                tournament.pairs.some((p) => p.pairId === decodedId))
    );

    const matchedPair = tournament.pairs?.find(
        (p) => p.pairId === decodedId || p.playerIds.map((pid) => String(pid)).includes(decodedId)
    );
    const matchedParticipant = tournament.participants?.find((p) => String(p.id) === decodedId);

    const standings: TournamentStandingsEntry[] =
        isPairMode && tournament.pairs
            ? calculatePairStandings(tournament.pairs, tournament.matches || [])
            : calculatePlayerStandings(tournament.participants || [], tournament.matches || []);

    const standingEntry = standings.find((s) => {
        const sId = String(s.entityId ?? s.id);
        return sId === decodedId || (matchedPair && sId === matchedPair.pairId);
    });

    let teamName = standingEntry?.entityName || standingEntry?.name || "";
    let subtitle: string | undefined;
    let playerIds: string[] = [];
    let playerNames: string[] = [];
    let playerPhotos: (string | null)[] = [];

    if (matchedPair) {
        teamName = matchedPair.pairName || matchedPair.playerNames.filter(Boolean).join(" & ");
        subtitle = matchedPair.playerNames.filter(Boolean).join(" • ");
        playerIds = (matchedPair.playerIds || []).map((pid) => String(pid));
        playerNames = matchedPair.playerNames || [];
        playerPhotos = (matchedPair.playerPhotos || []).map((ph) => ph || null);
    } else if (matchedParticipant) {
        teamName = matchedParticipant.name;
        subtitle = matchedParticipant.group ? `Group: ${matchedParticipant.group}` : "Individual Competitor";
        playerIds = [String(matchedParticipant.id)];
        playerNames = [matchedParticipant.name];
        playerPhotos = [matchedParticipant.photoURL || null];
    } else if (decodedId.includes("__")) {
        const splitIds = decodedId.split("__");
        const resolvedParticipants = splitIds
            .map((pid) => tournament.participants?.find((p) => String(p.id) === pid))
            .filter(Boolean);
        playerIds = splitIds;
        playerNames = resolvedParticipants.map((p) => p!.name);
        playerPhotos = resolvedParticipants.map((p) => p?.photoURL || null);
        teamName = playerNames.length > 0 ? playerNames.join(" & ") : decodedId;
        subtitle = "Pair Side";
    } else {
        teamName = standingEntry?.entityName || standingEntry?.name || decodedId;
        playerIds = [decodedId];
        playerNames = [teamName];
        playerPhotos = standingEntry?.playerPhotos
            ? standingEntry.playerPhotos.map((ph) => ph || null)
            : [standingEntry?.photoURL || null];
    }

    let played = standingEntry?.played ?? 0;
    let wins = standingEntry?.wins ?? 0;
    let draws = standingEntry?.draws ?? 0;
    let losses = standingEntry?.losses ?? 0;
    let points = standingEntry?.points ?? 0;
    let gf = standingEntry?.gf ?? 0;
    let ga = standingEntry?.ga ?? 0;
    let setsWon = standingEntry?.setsWon ?? 0;
    let setsLost = standingEntry?.setsLost ?? 0;

    if (!standingEntry) {
        matches.forEach((m) => {
            if (!isMatchClosed(m.status ?? m.result?.status)) return;
            const sideAId = resolveMatchSideTeamId(m, "A", tournament);
            const isSideA =
                sideAId === decodedId ||
                m.teamAId === decodedId ||
                m.pairAId === decodedId ||
                (m.team1PlayerIds || []).map((pid) => String(pid)).includes(decodedId);

            const evalRes = evaluateMatchSets(
                m.sets ?? m.result?.sets,
                m.result?.scoreA ?? 0,
                m.result?.scoreB ?? 0
            );

            played += 1;
            const myGames = isSideA ? evalRes.totalGamesA : evalRes.totalGamesB;
            const oppGames = isSideA ? evalRes.totalGamesB : evalRes.totalGamesA;
            const mySets = isSideA ? evalRes.setsWonA : evalRes.setsWonB;
            const oppSets = isSideA ? evalRes.setsWonB : evalRes.setsWonA;

            gf += myGames;
            ga += oppGames;
            setsWon += mySets;
            setsLost += oppSets;

            if (evalRes.isDraw || m.isDraw || m.result?.isDraw || m.result?.winner === "Draw") {
                draws += 1;
                points += 1;
            } else if (
                (isSideA && evalRes.winnerSide === "Team 1") ||
                (!isSideA && evalRes.winnerSide === "Team 2")
            ) {
                wins += 1;
                points += 3;
            } else {
                losses += 1;
            }
        });
    }

    const closedMatches = matches.filter((m) => isMatchClosed(m.status ?? m.result?.status));
    const ongoingMatches = matches.filter((m) => isMatchOngoing(m.status ?? m.result?.status));
    const upcomingMatches = matches.filter(
        (m) => normalizeMatchStatus(m.status ?? m.result?.status) === "NOT_STARTED"
    );

    return {
        teamId: matchedPair?.pairId || decodedId,
        teamName,
        subtitle,
        playerIds,
        playerNames,
        playerPhotos,
        isPairEntity: Boolean(matchedPair || decodedId.includes("__")),
        rank: standingEntry?.rank ?? null,
        played,
        wins,
        draws,
        losses,
        points,
        gf,
        ga,
        diff: gf - ga,
        setsWon,
        setsLost,
        setsDiff: setsWon - setsLost,
        matches,
        closedMatches,
        ongoingMatches,
        upcomingMatches,
    };
}

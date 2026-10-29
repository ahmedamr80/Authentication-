export type TournamentMode =
    | "americano"
    | "mixicano"
    | "team_battle"
    | "round_robin"
    | "knockout"
    | "round_robin_knockout";

export type TournamentStatus = "draft" | "active" | "completed" | "cancelled";

export type CanonicalMatchStatus = "NOT_STARTED" | "ONGOING" | "CLOSED";

export type MatchStatus =
    | CanonicalMatchStatus
    | "not_started"
    | "in_progress"
    | "completed"
    | "walkover";

export interface SetScore {
    setNumber: number;
    teamAScore: number;
    teamBScore: number;
    tieBreak?: {
        teamAScore: number;
        teamBScore: number;
    } | null;
}

export interface MatchFormatConfig {
    numberOfSets: 1 | 3 | 5;
    setsToWin: 1 | 2 | 3;
}

export interface TournamentConfig {
    mode?: TournamentMode;
    unitType?: "players" | "teams";
    numCourts: number;
    numRounds: number;
    cycles?: 1 | 2;
    numGroups?: number;
    qualifiersPerGroup?: number;
    thirdPlacePlayoff?: boolean;
    pointsPerWin?: number;
    pointsPerDraw?: number;
    pointsPerLoss?: number;
    numberOfSets?: 1 | 3 | 5;
    matchFormat?: MatchFormatConfig;
}

export interface TournamentParticipant {
    id: string | number;
    name: string;
    uid?: string | null;
    photoURL?: string | null;
    seed?: number | null;
    group?: string | null; // e.g. "ALL", "L", "R", "Alpha", "Beta", "Group A"
    preferredSide?: "Left" | "Right" | "Both" | null;
}

/**
 * Normalizes court side / position strings (case-insensitive, trims whitespace, handles variations like "left", "Right", "l", "r", "both", etc.)
 */
export function normalizePreferredSide(value: any): "Left" | "Right" | "Both" | null {
    if (!value || typeof value !== "string") return null;
    const s = value.trim().toLowerCase();
    if (!s) return null;
    if (s === "left" || s.startsWith("left") || s === "l" || s.includes("backhand")) return "Left";
    if (s === "right" || s.startsWith("right") || s === "r" || s.includes("forehand")) return "Right";
    if (s === "both" || s.includes("both") || s === "either" || s === "any") return "Both";
    return null;
}

/**
 * Normalizes legacy and canonical match status values to 'NOT_STARTED' | 'ONGOING' | 'CLOSED'.
 */
export function normalizeMatchStatus(status?: string | null): CanonicalMatchStatus {
    if (!status) return "NOT_STARTED";
    const upper = status.toUpperCase();
    if (upper === "CLOSED" || upper === "COMPLETED" || upper === "WALKOVER") {
        return "CLOSED";
    }
    if (upper === "ONGOING" || upper === "IN_PROGRESS") {
        return "ONGOING";
    }
    return "NOT_STARTED";
}

export function isMatchClosed(status?: string | null): boolean {
    return normalizeMatchStatus(status) === "CLOSED";
}

export function isMatchOngoing(status?: string | null): boolean {
    return normalizeMatchStatus(status) === "ONGOING";
}

export function createInitialSets(numberOfSets: 1 | 3 | 5 = 1): SetScore[] {
    return Array.from({ length: numberOfSets }, (_, idx) => ({
        setNumber: idx + 1,
        teamAScore: 0,
        teamBScore: 0,
        tieBreak: null,
    }));
}

/**
 * Resolves the winner of a single set (returns 'A' | 'B' | 'DRAW' | 'UNPLAYED').
 */
export function resolveSetOutcome(set: SetScore): "A" | "B" | "DRAW" | "UNPLAYED" {
    const a = Number(set.teamAScore) || 0;
    const b = Number(set.teamBScore) || 0;
    const tbA = set.tieBreak ? Number(set.tieBreak.teamAScore) || 0 : 0;
    const tbB = set.tieBreak ? Number(set.tieBreak.teamBScore) || 0 : 0;

    if (a === 0 && b === 0 && tbA === 0 && tbB === 0) {
        return "UNPLAYED";
    }
    if (a > b) return "A";
    if (b > a) return "B";
    // Scores in the set are equal -> check optional tie-break
    if (set.tieBreak && tbA !== tbB) {
        return tbA > tbB ? "A" : "B";
    }
    return "DRAW";
}

/**
 * Evaluates all sets of a match and computes aggregate scores, sets won, and winner/loser/draw flags.
 */
export function evaluateMatchSets(
    sets: SetScore[] | undefined,
    numberOfSetsOrFallbackA: number = 1,
    teamAIdOrFallbackB?: string | number | null,
    teamBId?: string | null
): {
    sets: SetScore[];
    setsWonA: number;
    setsWonB: number;
    totalGamesA: number;
    totalGamesB: number;
    scoreA: number;
    scoreB: number;
    winner: "Side A" | "Side B" | "Draw" | null;
    winnerSide: "Team 1" | "Team 2" | "Draw" | null;
    winnerTeamId: string | null;
    loserTeamId: string | null;
    isDraw: boolean;
} {
    const isLegacyScoreCall = typeof teamAIdOrFallbackB === "number";
    const resolvedNumberOfSets: 1 | 3 | 5 =
        sets && sets.length === 5
            ? 5
            : sets && sets.length === 3
            ? 3
            : !isLegacyScoreCall && (numberOfSetsOrFallbackA === 3 || numberOfSetsOrFallbackA === 5)
            ? numberOfSetsOrFallbackA
            : 1;

    const teamAId = typeof teamAIdOrFallbackB === "string" ? teamAIdOrFallbackB : null;

    const normalizedSets: SetScore[] =
        sets && sets.length > 0
            ? sets.slice(0, resolvedNumberOfSets).map((s, idx) => ({
                  setNumber: idx + 1,
                  teamAScore: Math.max(0, Number(s.teamAScore) || 0),
                  teamBScore: Math.max(0, Number(s.teamBScore) || 0),
                  tieBreak: s.tieBreak
                      ? {
                            teamAScore: Math.max(0, Number(s.tieBreak.teamAScore) || 0),
                            teamBScore: Math.max(0, Number(s.tieBreak.teamBScore) || 0),
                        }
                      : null,
              }))
            : isLegacyScoreCall
            ? [
                  {
                      setNumber: 1,
                      teamAScore: Math.max(0, Number(numberOfSetsOrFallbackA) || 0),
                      teamBScore: Math.max(0, Number(teamAIdOrFallbackB) || 0),
                      tieBreak: null,
                  },
              ]
            : createInitialSets(resolvedNumberOfSets);

    while (normalizedSets.length < resolvedNumberOfSets) {
        normalizedSets.push({
            setNumber: normalizedSets.length + 1,
            teamAScore: 0,
            teamBScore: 0,
            tieBreak: null,
        });
    }

    let setsWonA = 0;
    let setsWonB = 0;
    let totalGamesA = 0;
    let totalGamesB = 0;

    for (const s of normalizedSets) {
        totalGamesA += s.teamAScore;
        totalGamesB += s.teamBScore;
        const outcome = resolveSetOutcome(s);
        if (outcome === "A") setsWonA++;
        else if (outcome === "B") setsWonB++;
    }

    let winner: "Side A" | "Side B" | "Draw" | null = null;
    let winnerSide: "Team 1" | "Team 2" | "Draw" | null = null;
    let winnerTeamId: string | null = null;
    let loserTeamId: string | null = null;
    let isDraw = false;

    if (resolvedNumberOfSets === 1) {
        const s1 = normalizedSets[0];
        const outcome = resolveSetOutcome(s1);
        if (outcome === "A") {
            winner = "Side A";
            winnerSide = "Team 1";
            winnerTeamId = teamAId || "Side A";
            loserTeamId = teamBId || "Side B";
        } else if (outcome === "B") {
            winner = "Side B";
            winnerSide = "Team 2";
            winnerTeamId = teamBId || "Side B";
            loserTeamId = teamAId || "Side A";
        } else {
            winner = "Draw";
            winnerSide = "Draw";
            isDraw = true;
        }
    } else {
        if (setsWonA > setsWonB) {
            winner = "Side A";
            winnerSide = "Team 1";
            winnerTeamId = teamAId || "Side A";
            loserTeamId = teamBId || "Side B";
        } else if (setsWonB > setsWonA) {
            winner = "Side B";
            winnerSide = "Team 2";
            winnerTeamId = teamBId || "Side B";
            loserTeamId = teamAId || "Side A";
        } else {
            winner = "Draw";
            winnerSide = "Draw";
            isDraw = true;
        }
    }

    const scoreA = resolvedNumberOfSets === 1 ? normalizedSets[0].teamAScore : totalGamesA;
    const scoreB = resolvedNumberOfSets === 1 ? normalizedSets[0].teamBScore : totalGamesB;

    return {
        sets: normalizedSets,
        setsWonA,
        setsWonB,
        totalGamesA,
        totalGamesB,
        scoreA,
        scoreB,
        winner,
        winnerSide,
        winnerTeamId,
        loserTeamId,
        isDraw,
    };
}

export interface TournamentPair {
    pairId: string;
    pairName: string;
    playerIds: (string | number)[];
    playerNames: string[];
    playerPhotos?: (string | null | undefined)[];
    seed?: number;
    groupId?: string;
}

export interface TournamentMatchResult {
    scoreA: number;
    scoreB: number;
    status: MatchStatus;
    winner: "Side A" | "Side B" | "Team 1" | "Team 2" | "Draw" | null;
    walkoverWinner?: "Side A" | "Side B" | "Team 1" | "Team 2" | null;
    sets?: SetScore[];
    setsWonA?: number;
    setsWonB?: number;
    winnerTeamId?: string | null;
    loserTeamId?: string | null;
    isDraw?: boolean;
    completedAt?: number;
    notes?: string;
}

export interface TournamentMatch {
    matchId: string;
    tournamentId?: string;
    roundIdx: number;
    courtIdx: number;
    courtName?: string;
    stageId?: string;
    bracketSlotId?: string;
    status?: MatchStatus;
    pairAId?: string | null;
    pairBId?: string | null;
    teamAId?: string | null;
    teamBId?: string | null;
    sets?: SetScore[];
    winnerTeamId?: string | null;
    loserTeamId?: string | null;
    isDraw?: boolean;
    team1PlayerIds: (string | number)[];
    team2PlayerIds: (string | number)[];
    team1Names?: string[];
    team2Names?: string[];
    team1Photos?: (string | null | undefined)[];
    team2Photos?: (string | null | undefined)[];
    result: TournamentMatchResult;
}

export interface TournamentStandingsEntry {
    id: string | number;
    entityId?: string | number;
    name: string;
    entityName?: string;
    photoURL?: string;
    photoURLs?: (string | null | undefined)[];
    playerPhotos?: (string | undefined)[];
    pairId?: string;
    pairName?: string;
    groupId?: string;
    points: number;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    gf: number;
    ga: number;
    diff: number;
    setsWon?: number;
    setsLost?: number;
    setsDiff?: number;
    walkoversConceded: number;
    rank: number;
}

export interface TournamentDocument {
    id: string;
    eventId: string;
    title: string;
    mode: TournamentMode;
    unitType: "players" | "teams";
    status: TournamentStatus;
    config: TournamentConfig;
    matchFormat?: MatchFormatConfig;
    participants: TournamentParticipant[];
    pairs?: TournamentPair[];
    matches?: TournamentMatch[];
    templateId?: string;
    createdAt?: any;
    updatedAt?: any;
    createdBy: string;
}

export interface TournamentTemplate {
    templateId: string;
    version: number;
    title: string;
    mode: TournamentMode;
    pairMode?: boolean;
    pairCount?: number;
    participantCount: number;
    courtCount: number;
    roundCount: number;
    slots: (string | number)[];
    matches: Array<{
        matchId?: number | string;
        roundIdx: number;
        courtIdx: number;
        sideASlots: (string | number)[];
        sideBSlots: (string | number)[];
    }>;
    isActive: boolean;
    createdAt?: any;
    createdBy?: string;
}

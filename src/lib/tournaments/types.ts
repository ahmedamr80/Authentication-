export type TournamentMode =
    | "americano"
    | "mixicano"
    | "team_battle"
    | "round_robin"
    | "knockout"
    | "round_robin_knockout";

export type TournamentStatus = "draft" | "active" | "completed" | "cancelled";

export interface TournamentConfig {
    numCourts: number;
    numRounds: number;
    cycles?: 1 | 2;
    numGroups?: number;
    qualifiersPerGroup?: number;
    thirdPlacePlayoff?: boolean;
    pointsPerWin?: number;
    pointsPerDraw?: number;
    pointsPerLoss?: number;
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
    status: "not_started" | "in_progress" | "completed" | "walkover";
    winner: "Side A" | "Side B" | "Draw" | null;
    walkoverWinner?: "Side A" | "Side B" | null;
    notes?: string;
}

export interface TournamentMatch {
    matchId: string;
    roundIdx: number;
    courtIdx: number;
    courtName?: string;
    stageId?: string;
    bracketSlotId?: string;
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
    name: string;
    photoURL?: string;
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
    participants: TournamentParticipant[];
    pairs?: TournamentPair[];
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

import {
    TournamentMatch,
    TournamentMode,
    TournamentPair,
    TournamentParticipant,
    TournamentTemplate,
    createInitialSets,
} from "./types";
import { solveAmericano } from "./engines/americanoEngine";
import { solveMixicano } from "./engines/mixicanoEngine";
import { solveTeamBattle } from "./engines/teamBattleEngine";
import { solveRoundRobin } from "./engines/roundRobinEngine";
import { solveKnockout, BracketSlot } from "./engines/knockoutEngine";
import { solveRoundRobinKnockout } from "./engines/hybridEngine";
import { solveCrossGroup } from "./engines/crossGroupEngine";

export interface TournamentGenerationParams {
    mode: TournamentMode;
    title: string;
    numCourts: number;
    numRounds?: number;
    numberOfSets?: 1 | 3 | 5;
    cycles?: 1 | 2;
    numGroups?: number;
    qualifiersPerGroup?: number;
    thirdPlacePlayoff?: boolean;
    participants?: TournamentParticipant[];
    pairs?: TournamentPair[];
    leftParticipants?: TournamentParticipant[];
    rightParticipants?: TournamentParticipant[];
    teamAParticipants?: TournamentParticipant[];
    teamBParticipants?: TournamentParticipant[];
    templates?: TournamentTemplate[];
}

export interface GeneratedTournamentResult {
    tournamentId: string;
    title: string;
    mode: TournamentMode;
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    pairs?: TournamentPair[];
    groups?: Array<{ groupId: string; pairIds: string[] }>;
    matches: TournamentMatch[];
    stages?: Array<{
        stageId: string;
        stageType: string;
        stageOrder: number;
        groupIds: string[];
        status: string;
    }>;
    bracketSlots?: BracketSlot[];
    templateId?: string;
    isFromTemplate: boolean;
    classification?: string;
    metrics?: Record<string, any>;
}

/**
 * Resolves a deterministic team ID for a match side using the pair list (if pair mode)
 * or fallback to the player IDs on that side.
 */
function resolveSideTeamId(
    sidePlayerIds: (string | number)[],
    explicitPairId: string | null | undefined,
    pairs?: TournamentPair[]
): string | null {
    if (explicitPairId) return explicitPairId;
    const normalizedSideIds = sidePlayerIds.map((pid) => String(pid));
    if (pairs && pairs.length > 0 && normalizedSideIds.length > 0) {
        const matchedPair = pairs.find((pair) =>
            pair.playerIds.some((pid) => normalizedSideIds.includes(String(pid)))
        );
        if (matchedPair) return matchedPair.pairId;
    }
    if (normalizedSideIds.length === 1) return normalizedSideIds[0];
    if (normalizedSideIds.length >= 2) return normalizedSideIds.join("__");
    return null;
}

/**
 * Enriches generated matches with tournamentId, teamAId, teamBId, and initial sets.
 */
function enrichGeneratedMatches(
    result: GeneratedTournamentResult,
    numberOfSets: 1 | 3 | 5 = 1
): GeneratedTournamentResult {
    const pairs = result.pairs;
    const enrichedMatches: TournamentMatch[] = result.matches.map((m) => {
        const teamAId = resolveSideTeamId(m.team1PlayerIds || [], m.pairAId || m.teamAId, pairs);
        const teamBId = resolveSideTeamId(m.team2PlayerIds || [], m.pairBId || m.teamBId, pairs);
        const initialSets = createInitialSets(numberOfSets);
        return {
            ...m,
            tournamentId: result.tournamentId,
            teamAId,
            teamBId,
            sets: m.sets && m.sets.length > 0 ? m.sets : initialSets,
            winnerTeamId: m.winnerTeamId ?? null,
            loserTeamId: m.loserTeamId ?? null,
            isDraw: m.isDraw ?? false,
            result: {
                ...m.result,
                status: m.result?.status || "NOT_STARTED",
                sets: m.result?.sets && m.result.sets.length > 0 ? m.result.sets : initialSets,
                winnerTeamId: m.result?.winnerTeamId ?? null,
                loserTeamId: m.result?.loserTeamId ?? null,
                isDraw: m.result?.isDraw ?? false,
            },
        };
    });

    return {
        ...result,
        matches: enrichedMatches,
    };
}

/**
 * Standard pre-computed templates from americano_mix for instant, mathematically perfect schedules.
 * Format: [roundIdx][courtIdx][p1, p2, p3, p4] where [p1, p2] = Side A, [p3, p4] = Side B
 */
const BUILTIN_TEMPLATES: Record<string, number[][][]> = {
    // 4 players, 1 court, 3 rounds
    "americano_4_1_3": [
        [[2, 3, 1, 0]],
        [[1, 2, 3, 0]],
        [[3, 1, 0, 2]],
    ],
    // 6 players, 1 court, 8 rounds
    "americano_6_1_8": [
        [[5, 3, 2, 1]],
        [[2, 0, 1, 4]],
        [[5, 3, 4, 0]],
        [[5, 1, 0, 2]],
        [[3, 2, 5, 4]],
        [[4, 2, 1, 3]],
        [[5, 4, 3, 0]],
        [[0, 1, 4, 2]],
    ],
    // 8 players, 2 courts, 7 rounds: Classic round-robin, exact 4/3 court split, 0 unpartnered, 0 unopposed
    "americano_8_2_7": [
        [[0, 7, 5, 6], [1, 4, 2, 3]],
        [[1, 5, 4, 6], [0, 3, 2, 7]],
        [[1, 2, 3, 6], [0, 5, 4, 7]],
        [[0, 4, 1, 3], [2, 6, 5, 7]],
        [[1, 7, 2, 4], [0, 6, 3, 5]],
        [[0, 2, 3, 7], [1, 6, 4, 5]],
        [[2, 5, 3, 4], [0, 1, 6, 7]],
    ],
    // 10 players, 2 courts, 12 rounds
    "americano_10_2_12": [
        [[0, 9, 6, 3], [2, 7, 8, 4]],
        [[7, 6, 2, 5], [9, 3, 1, 8]],
        [[1, 3, 4, 5], [9, 8, 0, 2]],
        [[1, 7, 0, 5], [3, 8, 6, 4]],
        [[8, 2, 3, 7], [5, 6, 0, 1]],
        [[2, 4, 5, 1], [6, 8, 9, 7]],
        [[4, 7, 1, 6], [3, 5, 2, 9]],
        [[0, 8, 7, 4], [9, 6, 2, 1]],
        [[3, 4, 9, 0], [7, 5, 8, 6]],
        [[9, 5, 8, 7], [4, 0, 3, 2]],
        [[5, 8, 1, 9], [0, 6, 4, 2]],
        [[4, 9, 0, 7], [6, 2, 1, 3]],
    ],
    // 12 players, 3 courts, 11 rounds
    "americano_12_3_11": [
        [[3, 6, 7, 11], [9, 1, 5, 0], [2, 4, 8, 10]],
        [[7, 0, 8, 11], [6, 4, 9, 10], [3, 5, 2, 1]],
        [[10, 1, 2, 11], [8, 9, 7, 4], [5, 6, 3, 0]],
        [[4, 5, 8, 0], [10, 11, 1, 6], [9, 2, 7, 3]],
        [[7, 10, 9, 3], [0, 6, 4, 11], [8, 1, 5, 2]],
        [[6, 7, 1, 4], [3, 2, 10, 0], [11, 5, 8, 9]],
        [[8, 2, 10, 6], [1, 5, 4, 3], [11, 9, 7, 0]],
        [[4, 0, 11, 1], [5, 7, 6, 2], [10, 3, 8, 9]],
        [[11, 3, 5, 10], [2, 0, 7, 1], [9, 4, 6, 8]],
        [[2, 7, 0, 8], [11, 6, 3, 1], [5, 10, 9, 4]],
        [[9, 0, 1, 10], [4, 2, 11, 7], [8, 3, 5, 6]],
    ],
    // Mixicano 8 Left + 8 Right (16 players), 4 courts, 8 rounds
    "mixicano_16_4_8": [
        [[0, 10, 1, 11], [2, 8, 3, 9], [4, 14, 5, 15], [6, 12, 7, 13]],
        [[4, 8, 6, 10], [5, 9, 7, 11], [0, 12, 2, 14], [1, 13, 3, 15]],
        [[5, 11, 6, 8], [0, 14, 3, 13], [1, 15, 2, 12], [4, 10, 7, 9]],
        [[3, 8, 7, 12], [0, 11, 4, 15], [1, 10, 5, 14], [2, 9, 6, 13]],
        [[0, 9, 5, 12], [1, 8, 4, 13], [2, 11, 7, 14], [3, 10, 6, 15]],
        [[2, 13, 4, 11], [3, 12, 5, 10], [0, 15, 6, 9], [1, 14, 7, 8]],
        [[2, 15, 5, 8], [0, 13, 7, 10], [1, 12, 6, 11], [3, 14, 4, 9]],
        [[6, 14, 7, 15], [4, 12, 5, 13], [2, 10, 3, 11], [0, 8, 1, 9]],
    ],
};

export const BUILTIN_TOURNAMENT_TEMPLATES: TournamentTemplate[] = [
    {
        templateId: "americano_fixed_pairs_8p_4c_7r",
        version: 1,
        title: "Americano Fixed Pairs 8 Pairs 4 Courts (7 Rounds)",
        mode: "americano",
        pairMode: true,
        participantCount: 16,
        pairCount: 8,
        courtCount: 4,
        roundCount: 7,
        slots: [0, 1, 2, 3, 4, 5, 6, 7],
        matches: [
            { roundIdx: 0, courtIdx: 0, sideASlots: [0], sideBSlots: [6] },
            { roundIdx: 0, courtIdx: 1, sideASlots: [2], sideBSlots: [4] },
            { roundIdx: 0, courtIdx: 2, sideASlots: [3], sideBSlots: [7] },
            { roundIdx: 0, courtIdx: 3, sideASlots: [1], sideBSlots: [5] },

            { roundIdx: 1, courtIdx: 0, sideASlots: [1], sideBSlots: [3] },
            { roundIdx: 1, courtIdx: 1, sideASlots: [0], sideBSlots: [7] },
            { roundIdx: 1, courtIdx: 2, sideASlots: [4], sideBSlots: [6] },
            { roundIdx: 1, courtIdx: 3, sideASlots: [2], sideBSlots: [5] },

            { roundIdx: 2, courtIdx: 0, sideASlots: [5], sideBSlots: [7] },
            { roundIdx: 2, courtIdx: 1, sideASlots: [1], sideBSlots: [4] },
            { roundIdx: 2, courtIdx: 2, sideASlots: [3], sideBSlots: [6] },
            { roundIdx: 2, courtIdx: 3, sideASlots: [0], sideBSlots: [2] },

            { roundIdx: 3, courtIdx: 0, sideASlots: [5], sideBSlots: [6] },
            { roundIdx: 3, courtIdx: 1, sideASlots: [0], sideBSlots: [3] },
            { roundIdx: 3, courtIdx: 2, sideASlots: [1], sideBSlots: [2] },
            { roundIdx: 3, courtIdx: 3, sideASlots: [4], sideBSlots: [7] },

            { roundIdx: 4, courtIdx: 0, sideASlots: [6], sideBSlots: [7] },
            { roundIdx: 4, courtIdx: 1, sideASlots: [4], sideBSlots: [5] },
            { roundIdx: 4, courtIdx: 2, sideASlots: [0], sideBSlots: [1] },
            { roundIdx: 4, courtIdx: 3, sideASlots: [2], sideBSlots: [3] },

            { roundIdx: 5, courtIdx: 0, sideASlots: [0], sideBSlots: [4] },
            { roundIdx: 5, courtIdx: 1, sideASlots: [1], sideBSlots: [7] },
            { roundIdx: 5, courtIdx: 2, sideASlots: [3], sideBSlots: [5] },
            { roundIdx: 5, courtIdx: 3, sideASlots: [2], sideBSlots: [6] },

            { roundIdx: 6, courtIdx: 0, sideASlots: [2], sideBSlots: [7] },
            { roundIdx: 6, courtIdx: 1, sideASlots: [1], sideBSlots: [6] },
            { roundIdx: 6, courtIdx: 2, sideASlots: [0], sideBSlots: [5] },
            { roundIdx: 6, courtIdx: 3, sideASlots: [3], sideBSlots: [4] },
        ],
        isActive: true,
    },
    {
        templateId: "round_robin_8p_4c_7r",
        version: 1,
        title: "Round Robin 8 Pairs 4 Courts (7 Rounds)",
        mode: "round_robin",
        pairMode: true,
        participantCount: 8,
        pairCount: 8,
        courtCount: 4,
        roundCount: 7,
        slots: [0, 1, 2, 3, 4, 5, 6, 7],
        matches: [
            { roundIdx: 0, courtIdx: 0, sideASlots: [0], sideBSlots: [6] },
            { roundIdx: 0, courtIdx: 1, sideASlots: [2], sideBSlots: [4] },
            { roundIdx: 0, courtIdx: 2, sideASlots: [3], sideBSlots: [7] },
            { roundIdx: 0, courtIdx: 3, sideASlots: [1], sideBSlots: [5] },

            { roundIdx: 1, courtIdx: 0, sideASlots: [1], sideBSlots: [3] },
            { roundIdx: 1, courtIdx: 1, sideASlots: [0], sideBSlots: [7] },
            { roundIdx: 1, courtIdx: 2, sideASlots: [4], sideBSlots: [6] },
            { roundIdx: 1, courtIdx: 3, sideASlots: [2], sideBSlots: [5] },

            { roundIdx: 2, courtIdx: 0, sideASlots: [5], sideBSlots: [7] },
            { roundIdx: 2, courtIdx: 1, sideASlots: [1], sideBSlots: [4] },
            { roundIdx: 2, courtIdx: 2, sideASlots: [3], sideBSlots: [6] },
            { roundIdx: 2, courtIdx: 3, sideASlots: [0], sideBSlots: [2] },

            { roundIdx: 3, courtIdx: 0, sideASlots: [5], sideBSlots: [6] },
            { roundIdx: 3, courtIdx: 1, sideASlots: [0], sideBSlots: [3] },
            { roundIdx: 3, courtIdx: 2, sideASlots: [1], sideBSlots: [2] },
            { roundIdx: 3, courtIdx: 3, sideASlots: [4], sideBSlots: [7] },

            { roundIdx: 4, courtIdx: 0, sideASlots: [6], sideBSlots: [7] },
            { roundIdx: 4, courtIdx: 1, sideASlots: [4], sideBSlots: [5] },
            { roundIdx: 4, courtIdx: 2, sideASlots: [0], sideBSlots: [1] },
            { roundIdx: 4, courtIdx: 3, sideASlots: [2], sideBSlots: [3] },

            { roundIdx: 5, courtIdx: 0, sideASlots: [0], sideBSlots: [4] },
            { roundIdx: 5, courtIdx: 1, sideASlots: [1], sideBSlots: [7] },
            { roundIdx: 5, courtIdx: 2, sideASlots: [3], sideBSlots: [5] },
            { roundIdx: 5, courtIdx: 3, sideASlots: [2], sideBSlots: [6] },

            { roundIdx: 6, courtIdx: 0, sideASlots: [2], sideBSlots: [7] },
            { roundIdx: 6, courtIdx: 1, sideASlots: [1], sideBSlots: [6] },
            { roundIdx: 6, courtIdx: 2, sideASlots: [0], sideBSlots: [5] },
            { roundIdx: 6, courtIdx: 3, sideASlots: [3], sideBSlots: [4] },
        ],
        isActive: true,
    },
];

/**
 * Generates tournament matches using either pre-computed matrix templates or the dynamic solver.
 */
export function generateTournamentSchedule(
    params: TournamentGenerationParams
): GeneratedTournamentResult {
    const {
        mode,
        title,
        numCourts,
        numRounds,
        numberOfSets = 1,
        cycles,
        numGroups,
        qualifiersPerGroup,
        thirdPlacePlayoff,
        participants = [],
        pairs = [],
        leftParticipants = [],
        rightParticipants = [],
        teamAParticipants = [],
        teamBParticipants = [],
        templates = [],
    } = params;

    // 1. Check participant count based on tournament format
    const participantCount =
        mode === "round_robin" || mode === "knockout" || mode === "round_robin_knockout" || mode === "group_vs_group"
            ? pairs.length
            : mode === "mixicano"
            ? (leftParticipants.length + rightParticipants.length || participants.length)
            : mode === "team_battle"
            ? (teamAParticipants.length + teamBParticipants.length || participants.length)
            : participants.length;

    // Merge active Firestore templates with Builtin Tournament Templates
    // Prioritize templates with exact mode match first
    const allTemplates = [...templates, ...BUILTIN_TOURNAMENT_TEMPLATES].sort((a, b) => {
        const aExact = a.mode === mode ? 1 : 0;
        const bExact = b.mode === mode ? 1 : 0;
        return bExact - aExact;
    });

    const matchedFirestoreTemplate = allTemplates.find((t) => {
        if (!t.isActive) return false;
        if (t.courtCount !== numCourts) return false;
        if (numRounds && t.roundCount !== numRounds) return false;

        const isPairModeTemplate = Boolean(
            t.pairMode ||
            t.mode === "round_robin" ||
            (t.slots && t.slots.length === 8 && t.matches[0]?.sideASlots?.length === 1)
        );

        if (mode === "round_robin") {
            if (t.mode === "round_robin" || isPairModeTemplate) {
                const reqPairs = t.pairCount || (t.participantCount === 16 ? 8 : t.participantCount);
                if (pairs.length === reqPairs) return true;
            }
        } else if (mode === "americano") {
            if (isPairModeTemplate && (pairs.length === (t.pairCount || 8) || participants.length === t.participantCount)) {
                return true;
            }
            if (t.mode === "americano" && t.participantCount === participantCount) {
                return true;
            }
        } else if (t.mode === mode) {
            if (t.participantCount === participantCount) return true;
            if (mode === "mixicano" && (t.participantCount === 8 || t.participantCount === 16) && (participantCount === 8 || participantCount === 16)) return true;
        }

        return false;
    });

    if (matchedFirestoreTemplate) {
        const isPairTemplate = Boolean(
            matchedFirestoreTemplate.pairMode ||
            mode === "round_robin" ||
            (matchedFirestoreTemplate.matches[0]?.sideASlots?.length === 1 && (pairs.length > 0 || participants.length >= 16))
        );

        if (isPairTemplate) {
            // Build / resolve pairs
            const resolvedPairs: TournamentPair[] = pairs.length >= (matchedFirestoreTemplate.pairCount || 8)
                ? pairs.map((p: any, idx) => ({
                    pairId: p.pairId || p.id || `pair_${idx + 1}`,
                    pairName: p.pairName || p.name || `Team ${idx + 1}`,
                    playerIds: p.playerIds || (p.player1 && p.player2 ? [p.player1.id, p.player2.id] : [`p${idx * 2 + 1}`, `p${idx * 2 + 2}`]),
                    playerNames: p.playerNames || (p.player1 && p.player2 ? [p.player1.name, p.player2.name] : [`Player ${idx * 2 + 1}`, `Player ${idx * 2 + 2}`]),
                    playerPhotos: p.playerPhotos || [p.player1?.photoURL || null, p.player2?.photoURL || null],
                    seed: p.seed ?? idx + 1,
                    groupId: p.groupId,
                }))
                : Array.from({ length: matchedFirestoreTemplate.pairCount || 8 }, (_, idx) => {
                    const p1 = participants[idx * 2];
                    const p2 = participants[idx * 2 + 1];
                    return {
                        pairId: `pair_${idx + 1}`,
                        pairName: `${p1?.name || `Player ${idx * 2 + 1}`} & ${p2?.name || `Player ${idx * 2 + 2}`}`,
                        playerIds: [p1?.id ?? `p${idx * 2 + 1}`, p2?.id ?? `p${idx * 2 + 2}`],
                        playerNames: [p1?.name ?? `Player ${idx * 2 + 1}`, p2?.name ?? `Player ${idx * 2 + 2}`],
                        playerPhotos: [p1?.photoURL || null, p2?.photoURL || null],
                        seed: idx + 1,
                    };
                });

            const scheduleMatches: TournamentMatch[] = matchedFirestoreTemplate.matches.map((m, idx) => {
                const pAIndex = Number(m.sideASlots[0]);
                const pBIndex = Number(m.sideBSlots[0]);
                const pairA = resolvedPairs[pAIndex];
                const pairB = resolvedPairs[pBIndex];

                return {
                    matchId: `template_m_${idx + 1}`,
                    roundIdx: m.roundIdx,
                    courtIdx: m.courtIdx,
                    courtName: `Court ${m.courtIdx + 1}`,
                    stageId: "group",
                    pairAId: pairA?.pairId ?? null,
                    pairBId: pairB?.pairId ?? null,
                    teamAId: pairA?.pairId ?? null,
                    teamBId: pairB?.pairId ?? null,
                    team1PlayerIds: pairA && Array.isArray(pairA.playerIds) ? pairA.playerIds : [m.sideASlots[0]],
                    team2PlayerIds: pairB && Array.isArray(pairB.playerIds) ? pairB.playerIds : [m.sideBSlots[0]],
                    team1Names: pairA && Array.isArray(pairA.playerNames) ? pairA.playerNames : [`Pair ${pAIndex + 1}`],
                    team2Names: pairB && Array.isArray(pairB.playerNames) ? pairB.playerNames : [`Pair ${pBIndex + 1}`],
                    team1Photos: pairA && Array.isArray(pairA.playerPhotos) ? pairA.playerPhotos.map((ph) => ph || null) : [],
                    team2Photos: pairB && Array.isArray(pairB.playerPhotos) ? pairB.playerPhotos.map((ph) => ph || null) : [],
                    result: {
                        scoreA: 0,
                        scoreB: 0,
                        status: "NOT_STARTED",
                        winner: null,
                    },
                };
            });

            const groupList = [{
                groupId: "group_1",
                pairIds: resolvedPairs.map((p) => p.pairId),
            }];

            const groupStage = {
                stageId: "group",
                stageType: "group",
                stageOrder: 1,
                groupIds: ["group_1"],
                status: "active",
            };

            const playersList: TournamentParticipant[] = [];
            resolvedPairs.forEach((p) => {
                if (p.playerIds && Array.isArray(p.playerIds)) {
                    p.playerIds.forEach((pid, pIdx) => {
                        playersList.push({
                            id: pid,
                            name: p.playerNames?.[pIdx] || `Player ${pid}`,
                            photoURL: p.playerPhotos?.[pIdx] || null,
                            group: "ALL",
                        });
                    });
                }
            });

            return enrichGeneratedMatches(
                {
                    tournamentId: Math.random().toString(36).substring(2, 10),
                    title,
                    mode: mode === "round_robin" ? "round_robin" : mode,
                    numCourts,
                    numRounds: matchedFirestoreTemplate.roundCount,
                    players: participants.length > 0 ? participants : playersList,
                    pairs: resolvedPairs,
                    groups: groupList,
                    stages: [groupStage],
                    matches: scheduleMatches,
                    templateId: matchedFirestoreTemplate.templateId,
                    isFromTemplate: true,
                    classification: "PERFECT",
                },
                numberOfSets
            );
        }

        const activePlayers =
            mode === "mixicano" && leftParticipants.length > 0
                ? [...leftParticipants, ...rightParticipants]
                : mode === "team_battle" && teamAParticipants.length > 0
                ? [...teamAParticipants, ...teamBParticipants]
                : participants;

        const scheduleMatches: TournamentMatch[] = matchedFirestoreTemplate.matches.map((m, idx) => {
            const sideAPlayers = m.sideASlots.map((slotIdx) => activePlayers[Number(slotIdx)]?.id ?? slotIdx);
            const sideBPlayers = m.sideBSlots.map((slotIdx) => activePlayers[Number(slotIdx)]?.id ?? slotIdx);
            const sideANames = m.sideASlots.map((slotIdx) => activePlayers[Number(slotIdx)]?.name ?? `Slot ${slotIdx}`);
            const sideBNames = m.sideBSlots.map((slotIdx) => activePlayers[Number(slotIdx)]?.name ?? `Slot ${slotIdx}`);
            const sideAPhotos = m.sideASlots.map((slotIdx) => activePlayers[Number(slotIdx)]?.photoURL || null);
            const sideBPhotos = m.sideBSlots.map((slotIdx) => activePlayers[Number(slotIdx)]?.photoURL || null);

            return {
                matchId: `template_m_${idx + 1}`,
                roundIdx: m.roundIdx,
                courtIdx: m.courtIdx,
                courtName: `Court ${m.courtIdx + 1}`,
                team1PlayerIds: sideAPlayers,
                team2PlayerIds: sideBPlayers,
                team1Names: sideANames,
                team2Names: sideBNames,
                team1Photos: sideAPhotos,
                team2Photos: sideBPhotos,
                result: {
                    scoreA: 0,
                    scoreB: 0,
                    status: "NOT_STARTED",
                    winner: null,
                },
            };
        });

        return enrichGeneratedMatches(
            {
                tournamentId: Math.random().toString(36).substring(2, 10),
                title,
                mode,
                numCourts,
                numRounds: matchedFirestoreTemplate.roundCount,
                players: activePlayers,
                matches: scheduleMatches,
                templateId: matchedFirestoreTemplate.templateId,
                isFromTemplate: true,
                classification: "PERFECT",
            },
            numberOfSets
        );
    }

    // Try Builtin Templates (e.g. Americano 8p 2c 7r, Mixicano 16p 4c 8r)
    if (mode === "americano" || mode === "mixicano") {
        const defaultRounds =
            mode === "mixicano"
                ? (participantCount === 16 || participantCount === 8) ? 8 : 0
                : participantCount === 8 ? 7 : participantCount === 4 ? 3 : participantCount === 6 ? 8 : participantCount === 10 ? 12 : participantCount === 12 ? 11 : 0;
        const normalizedParticipantCount = mode === "mixicano" && participantCount === 8 ? 16 : participantCount;
        const builtinKey = `${mode}_${normalizedParticipantCount}_${numCourts}_${numRounds || defaultRounds}`;
        const activePlayers =
            mode === "mixicano" && leftParticipants.length > 0
                ? [...leftParticipants, ...rightParticipants]
                : participants;

        if (BUILTIN_TEMPLATES[builtinKey] && activePlayers.length >= normalizedParticipantCount) {
            const matrix = BUILTIN_TEMPLATES[builtinKey];
            const scheduleMatches: TournamentMatch[] = [];

            matrix.forEach((round, rIdx) => {
                round.forEach((courtSlots, cIdx) => {
                    const [p1, p2, p3, p4] = courtSlots;
                    scheduleMatches.push({
                        matchId: `r${rIdx}_c${cIdx}_${Math.random().toString(36).substring(2, 8)}`,
                        roundIdx: rIdx,
                        courtIdx: cIdx,
                        courtName: `Court ${cIdx + 1}`,
                        team1PlayerIds: [activePlayers[p1].id, activePlayers[p2].id],
                        team2PlayerIds: [activePlayers[p3].id, activePlayers[p4].id],
                        team1Names: [activePlayers[p1].name, activePlayers[p2].name],
                        team2Names: [activePlayers[p3].name, activePlayers[p4].name],
                        team1Photos: [activePlayers[p1]?.photoURL || null, activePlayers[p2]?.photoURL || null],
                        team2Photos: [activePlayers[p3]?.photoURL || null, activePlayers[p4]?.photoURL || null],
                        result: {
                            scoreA: 0,
                            scoreB: 0,
                            status: "NOT_STARTED",
                            winner: null,
                        },
                    });
                });
            });

            return enrichGeneratedMatches(
                {
                    tournamentId: Math.random().toString(36).substring(2, 10),
                    title,
                    mode,
                    numCourts,
                    numRounds: matrix.length,
                    players: activePlayers,
                    matches: scheduleMatches,
                    templateId: `builtin_${builtinKey}`,
                    isFromTemplate: true,
                    classification: "PERFECT",
                },
                numberOfSets
            );
        }
    }

    // 2. Fallback to Dynamic Solvers
    switch (mode) {
        case "americano": {
            const res = solveAmericano(participants.length, numCourts, numRounds, title, participants);
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        case "mixicano": {
            const res = solveMixicano(numCourts, numRounds, title, leftParticipants, rightParticipants);
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        case "team_battle": {
            const res = solveTeamBattle(numCourts, numRounds, title, teamAParticipants, teamBParticipants);
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        case "round_robin": {
            const res = solveRoundRobin(pairs, numCourts, numGroups, cycles, title);
            if (!res) throw new Error("Could not solve Round Robin tournament with given pairs.");
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        case "knockout": {
            const res = solveKnockout(pairs, numCourts, thirdPlacePlayoff, title);
            if (!res) throw new Error("Could not solve Knockout tournament with given pairs.");
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        case "round_robin_knockout": {
            const res = solveRoundRobinKnockout(
                pairs,
                numCourts,
                numGroups,
                cycles,
                qualifiersPerGroup,
                thirdPlacePlayoff,
                title
            );
            if (!res) throw new Error("Could not solve Round Robin + Knockout tournament with given pairs.");
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        case "group_vs_group": {
            const res = solveCrossGroup(
                pairs,
                numCourts,
                cycles,
                qualifiersPerGroup,
                thirdPlacePlayoff,
                title
            );
            if (!res) throw new Error("Could not solve Group A vs Group B tournament with given pairs.");
            return enrichGeneratedMatches(
                {
                    ...res,
                    isFromTemplate: false,
                },
                numberOfSets
            );
        }

        default:
            throw new Error(`Unsupported tournament mode: ${mode}`);
    }
}

import { TournamentMatch, TournamentMode, TournamentPair, TournamentParticipant, TournamentTemplate } from "./types";
import { solveAmericano } from "./engines/americanoEngine";
import { solveMixicano } from "./engines/mixicanoEngine";
import { solveTeamBattle } from "./engines/teamBattleEngine";
import { solveRoundRobin } from "./engines/roundRobinEngine";
import { solveKnockout, BracketSlot } from "./engines/knockoutEngine";
import { solveRoundRobinKnockout } from "./engines/hybridEngine";

export interface TournamentGenerationParams {
    mode: TournamentMode;
    title: string;
    numCourts: number;
    numRounds?: number;
    cycles?: 1 | 2;
    numGroups?: number;
    qualifiersPerGroup?: number;
    thirdPlacePlayoff?: boolean;
    participants: TournamentParticipant[];
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
}

/**
 * Standard pre-computed Americano templates for instant, mathematically perfect schedules.
 */
const BUILTIN_TEMPLATES: Record<string, number[][][]> = {
    // 8 players, 2 courts, 7 rounds: [round][court][p1, p2, p3, p4]
    "americano_8_2_7": [
        [[0, 1, 2, 3], [4, 5, 6, 7]],
        [[0, 2, 4, 6], [1, 3, 5, 7]],
        [[0, 3, 5, 6], [1, 2, 4, 7]],
        [[0, 4, 1, 5], [2, 6, 3, 7]],
        [[0, 5, 2, 7], [1, 6, 3, 4]],
        [[0, 6, 1, 7], [2, 4, 3, 5]],
        [[0, 7, 3, 4], [1, 4, 2, 5]],
    ],
};

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
        cycles,
        numGroups,
        qualifiersPerGroup,
        thirdPlacePlayoff,
        participants,
        pairs = [],
        leftParticipants = [],
        rightParticipants = [],
        teamAParticipants = [],
        teamBParticipants = [],
        templates = [],
    } = params;

    // 1. Check if a pre-computed template matches
    const participantCount = mode === "round_robin" || mode === "knockout" || mode === "round_robin_knockout"
        ? pairs.length
        : participants.length;

    // Try Firestore templates first
    const matchedFirestoreTemplate = templates.find(
        (t) =>
            t.mode === mode &&
            t.participantCount === participantCount &&
            t.courtCount === numCourts &&
            (!numRounds || t.roundCount === numRounds) &&
            t.isActive
    );

    if (matchedFirestoreTemplate) {
        const scheduleMatches: TournamentMatch[] = matchedFirestoreTemplate.matches.map((m, idx) => {
            const sideAPlayers = m.sideASlots.map((slotIdx) => participants[Number(slotIdx)]?.id ?? slotIdx);
            const sideBPlayers = m.sideBSlots.map((slotIdx) => participants[Number(slotIdx)]?.id ?? slotIdx);
            const sideANames = m.sideASlots.map((slotIdx) => participants[Number(slotIdx)]?.name ?? `Slot ${slotIdx}`);
            const sideBNames = m.sideBSlots.map((slotIdx) => participants[Number(slotIdx)]?.name ?? `Slot ${slotIdx}`);
            const sideAPhotos = m.sideASlots.map((slotIdx) => participants[Number(slotIdx)]?.photoURL);
            const sideBPhotos = m.sideBSlots.map((slotIdx) => participants[Number(slotIdx)]?.photoURL);

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
                    status: "not_started",
                    winner: null,
                },
            };
        });

        return {
            tournamentId: Math.random().toString(36).substring(2, 10),
            title,
            mode,
            numCourts,
            numRounds: matchedFirestoreTemplate.roundCount,
            players: participants,
            matches: scheduleMatches,
            templateId: matchedFirestoreTemplate.templateId,
            isFromTemplate: true,
        };
    }

    // Try Builtin Templates (e.g. Americano 8p 2c 7r)
    const builtinKey = `${mode}_${participantCount}_${numCourts}_${numRounds || 7}`;
    if (BUILTIN_TEMPLATES[builtinKey] && participants.length >= 8) {
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
                    team1PlayerIds: [participants[p1].id, participants[p2].id],
                    team2PlayerIds: [participants[p3].id, participants[p4].id],
                    team1Names: [participants[p1].name, participants[p2].name],
                    team2Names: [participants[p3].name, participants[p4].name],
                    team1Photos: [participants[p1]?.photoURL, participants[p2]?.photoURL],
                    team2Photos: [participants[p3]?.photoURL, participants[p4]?.photoURL],
                    result: {
                        scoreA: 0,
                        scoreB: 0,
                        status: "not_started",
                        winner: null,
                    },
                });
            });
        });

        return {
            tournamentId: Math.random().toString(36).substring(2, 10),
            title,
            mode,
            numCourts,
            numRounds: matrix.length,
            players: participants,
            matches: scheduleMatches,
            templateId: `builtin_${builtinKey}`,
            isFromTemplate: true,
        };
    }

    // 2. Fallback to Dynamic Solvers
    switch (mode) {
        case "americano": {
            const res = solveAmericano(participants.length, numCourts, numRounds, title, participants);
            return {
                ...res,
                isFromTemplate: false,
            };
        }

        case "mixicano": {
            const res = solveMixicano(numCourts, numRounds, title, leftParticipants, rightParticipants);
            return {
                ...res,
                isFromTemplate: false,
            };
        }

        case "team_battle": {
            const res = solveTeamBattle(numCourts, numRounds, title, teamAParticipants, teamBParticipants);
            return {
                ...res,
                isFromTemplate: false,
            };
        }

        case "round_robin": {
            const res = solveRoundRobin(pairs, numCourts, numGroups, cycles, title);
            if (!res) throw new Error("Could not solve Round Robin tournament with given pairs.");
            return {
                ...res,
                isFromTemplate: false,
            };
        }

        case "knockout": {
            const res = solveKnockout(pairs, numCourts, thirdPlacePlayoff, title);
            if (!res) throw new Error("Could not solve Knockout tournament with given pairs.");
            return {
                ...res,
                isFromTemplate: false,
            };
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
            return {
                ...res,
                isFromTemplate: false,
            };
        }

        default:
            throw new Error(`Unsupported tournament mode: ${mode}`);
    }
}

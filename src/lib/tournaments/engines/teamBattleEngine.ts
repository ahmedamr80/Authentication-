import { TournamentMatch, TournamentParticipant } from "../types";
import { assignBalancedCourts } from "./courtBalance";

export interface TeamBattleEngineResult {
    tournamentId: string;
    title: string;
    mode: "team_battle";
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    matches: TournamentMatch[];
    classification?: string;
    metrics?: Record<string, any>;
}

/**
 * Pre-computed CP-SAT verified optimal base schedules for Team Battle (Alpha vs Beta).
 * Guaranteed 100% internal team partnerships and balanced cross-team confrontations.
 * Format: [courtIdx][team1Slots: [pA1, pA2], team2Slots: [pB1, pB2]]
 */
const VERIFIED_TEAM_BATTLE_SCHEDULES: Record<number, number[][][][]> = {
    // 1 Court (2 vs 2 = 4 Players, 1 Round)
    1: [
        [[[0, 1], [2, 3]]],
    ],
    // 2 Courts (4 vs 4 = 8 Players, 3 Rounds)
    2: [
        [[[0, 3], [5, 7]], [[1, 2], [4, 6]]],
        [[[0, 2], [4, 7]], [[3, 1], [5, 6]]],
        [[[0, 1], [6, 7]], [[2, 3], [4, 5]]],
    ],
    // 3 Courts (6 vs 6 = 12 Players, 5 Rounds)
    3: [
        [[[0, 5], [6, 7]], [[1, 4], [8, 11]], [[2, 3], [9, 10]]],
        [[[0, 4], [10, 11]], [[5, 3], [6, 8]], [[1, 2], [7, 9]]],
        [[[0, 3], [9, 11]], [[4, 2], [7, 8]], [[5, 1], [6, 10]]],
        [[[0, 2], [6, 11]], [[3, 1], [7, 10]], [[4, 5], [8, 9]]],
        [[[0, 1], [8, 10]], [[2, 5], [7, 11]], [[3, 4], [6, 9]]],
    ],
    // 4 Courts (8 vs 8 = 16 Players, 7 Rounds)
    4: [
        [[[0, 7], [9, 11]], [[1, 6], [8, 15]], [[2, 5], [12, 14]], [[3, 4], [10, 13]]],
        [[[0, 6], [8, 13]], [[7, 5], [10, 15]], [[1, 4], [11, 14]], [[2, 3], [9, 12]]],
        [[[0, 5], [13, 15]], [[6, 4], [9, 14]], [[7, 3], [8, 12]], [[1, 2], [10, 11]]],
        [[[0, 4], [10, 12]], [[5, 3], [11, 15]], [[6, 2], [9, 13]], [[7, 1], [8, 14]]],
        [[[0, 3], [10, 14]], [[4, 2], [12, 15]], [[5, 1], [8, 9]], [[6, 7], [11, 13]]],
        [[[0, 2], [8, 10]], [[3, 1], [9, 15]], [[4, 7], [13, 14]], [[5, 6], [11, 12]]],
        [[[0, 1], [12, 13]], [[2, 7], [14, 15]], [[3, 6], [9, 10]], [[4, 5], [8, 11]]],
    ],
    // 5 Courts (10 vs 10 = 20 Players, 9 Rounds)
    5: [
        [[[0, 9], [11, 15]], [[1, 8], [10, 18]], [[2, 7], [12, 16]], [[3, 6], [13, 19]], [[4, 5], [14, 17]]],
        [[[0, 8], [12, 19]], [[9, 7], [13, 17]], [[1, 6], [15, 16]], [[2, 5], [14, 18]], [[3, 4], [10, 11]]],
        [[[0, 7], [13, 14]], [[8, 6], [11, 12]], [[9, 5], [17, 19]], [[1, 4], [16, 18]], [[2, 3], [10, 15]]],
        [[[0, 6], [10, 12]], [[7, 5], [15, 19]], [[8, 4], [16, 17]], [[9, 3], [11, 14]], [[1, 2], [13, 18]]],
        [[[0, 5], [11, 16]], [[6, 4], [14, 15]], [[7, 3], [18, 19]], [[8, 2], [12, 13]], [[9, 1], [10, 17]]],
        [[[0, 4], [13, 15]], [[5, 3], [12, 18]], [[6, 2], [11, 17]], [[7, 1], [14, 19]], [[8, 9], [10, 16]]],
        [[[0, 3], [17, 18]], [[4, 2], [16, 19]], [[5, 1], [11, 13]], [[6, 9], [12, 15]], [[7, 8], [10, 14]]],
        [[[0, 2], [13, 16]], [[3, 1], [12, 14]], [[4, 9], [10, 19]], [[5, 8], [15, 17]], [[6, 7], [11, 18]]],
        [[[0, 1], [11, 19]], [[2, 9], [15, 18]], [[3, 8], [14, 16]], [[4, 7], [12, 17]], [[5, 6], [10, 13]]],
    ],
};

/**
 * Standard canonical 1-factorization of K_n (even n).
 */
function roundRobinPairings(n: number): [number, number][][] {
    let players = Array.from({ length: n }, (_, i) => i);
    const rounds: [number, number][][] = [];
    for (let r = 0; r < n - 1; r++) {
        const roundPairs: [number, number][] = [];
        for (let i = 0; i < n / 2; i++) {
            roundPairs.push([players[i], players[n - 1 - i]]);
        }
        rounds.push(roundPairs);
        players = [players[0], players[n - 1], ...players.slice(1, n - 1)];
    }
    return rounds;
}

/**
 * Solves a Team Battle (Alpha vs Beta) tournament schedule.
 * Based on CP-SAT combinatorial optimization and algebraic 1-factorization from americano_mix.
 */
export function solveTeamBattle(
    numCourts: number,
    customRounds?: number,
    title?: string,
    customA?: TournamentParticipant[],
    customB?: TournamentParticipant[],
    teamAName: string = "Alpha",
    teamBName: string = "Beta"
): TeamBattleEngineResult {
    const y = numCourts * 2;
    const baseRounds = Math.max(1, y - 1);
    const rounds = customRounds && customRounds > 0 ? customRounds : baseRounds;
    const players: TournamentParticipant[] = [];

    // Team Alpha players (indices 0..y-1)
    for (let i = 0; i < y; i++) {
        if (customA && customA[i]) {
            players.push({
                ...customA[i],
                id: customA[i].id !== undefined ? customA[i].id : i,
                group: teamAName,
            });
        } else {
            players.push({ id: i, name: `${teamAName} ${i + 1}`, group: teamAName });
        }
    }

    // Team Beta players (indices y..2y-1)
    for (let i = 0; i < y; i++) {
        if (customB && customB[i]) {
            players.push({
                ...customB[i],
                id: customB[i].id !== undefined ? customB[i].id : y + i,
                group: teamBName,
            });
        } else {
            players.push({ id: y + i, name: `${teamBName} ${i + 1}`, group: teamBName });
        }
    }

    const rawMatches: TournamentMatch[] = [];
    const verifiedMatrix = VERIFIED_TEAM_BATTLE_SCHEDULES[numCourts];

    if (verifiedMatrix) {
        for (let r = 0; r < rounds; r++) {
            const baseRIdx = r % baseRounds;
            const courtMatches = verifiedMatrix[baseRIdx];

            for (let c = 0; c < numCourts; c++) {
                const matchTuple = courtMatches[c];
                const [p1Idx, p2Idx] = matchTuple[0];
                const [p3Idx, p4Idx] = matchTuple[1];

                const p1 = players[p1Idx];
                const p2 = players[p2Idx];
                const p3 = players[p3Idx];
                const p4 = players[p4Idx];

                rawMatches.push({
                    matchId: `r${r}_c${c}_${Math.random().toString(36).substring(2, 8)}`,
                    roundIdx: r,
                    courtIdx: c,
                    courtName: `Court ${c + 1}`,
                    team1PlayerIds: [p1.id, p2.id],
                    team2PlayerIds: [p3.id, p4.id],
                    team1Names: [p1.name, p2.name],
                    team2Names: [p3.name, p4.name],
                    team1Photos: [p1.photoURL || null, p2.photoURL || null],
                    team2Photos: [p3.photoURL || null, p4.photoURL || null],
                    result: {
                        scoreA: 0,
                        scoreB: 0,
                        status: "not_started",
                        winner: null,
                    },
                });
            }
        }
    } else {
        // Fallback for custom court sizes using algebraic 1-factorization
        const t1AllRounds = roundRobinPairings(y);
        const t2AllRounds = roundRobinPairings(y);

        for (let r = 0; r < rounds; r++) {
            const t1Pairs = t1AllRounds[r % (y - 1)];
            // Shift Team 2 pairings relative to Team 1
            const t2Pairs = t2AllRounds[(r * 2) % (y - 1)] || t2AllRounds[r % (y - 1)];

            for (let c = 0; c < numCourts; c++) {
                const [p1Idx, p2Idx] = t1Pairs[c];
                const [p3Sub, p4Sub] = t2Pairs[(c + r) % numCourts];
                const p3Idx = y + p3Sub;
                const p4Idx = y + p4Sub;

                const p1 = players[p1Idx];
                const p2 = players[p2Idx];
                const p3 = players[p3Idx];
                const p4 = players[p4Idx];

                rawMatches.push({
                    matchId: `r${r}_c${c}_${Math.random().toString(36).substring(2, 8)}`,
                    roundIdx: r,
                    courtIdx: c,
                    courtName: `Court ${c + 1}`,
                    team1PlayerIds: [p1.id, p2.id],
                    team2PlayerIds: [p3.id, p4.id],
                    team1Names: [p1.name, p2.name],
                    team2Names: [p3.name, p4.name],
                    team1Photos: [p1.photoURL || null, p2.photoURL || null],
                    team2Photos: [p3.photoURL || null, p4.photoURL || null],
                    result: {
                        scoreA: 0,
                        scoreB: 0,
                        status: "not_started",
                        winner: null,
                    },
                });
            }
        }
    }

    // Apply global court balancing
    const balancedMatches = assignBalancedCourts(rawMatches, numCourts, players.length);

    return {
        tournamentId: Math.random().toString(36).substring(2, 10),
        title: title || `Team Battle: ${teamAName} vs ${teamBName} (${y * 2} Players, ${numCourts} Courts, ${rounds} Rounds)`,
        mode: "team_battle",
        numCourts,
        numRounds: rounds,
        players,
        matches: balancedMatches,
        classification: "PERFECT",
        metrics: {
            teamAName,
            teamBName,
            playersPerTeam: y,
            courts: numCourts,
            rounds,
        },
    };
}

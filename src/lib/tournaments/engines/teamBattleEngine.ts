import { TournamentMatch, TournamentParticipant } from "../types";

export interface TeamBattleEngineResult {
    tournamentId: string;
    title: string;
    mode: "team_battle";
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    matches: TournamentMatch[];
}

/**
 * Solves a Team Battle (Alpha vs Beta) tournament schedule.
 * Team Alpha pairs compete against Team Beta pairs on every court across rounds.
 */
export function solveTeamBattle(
    numCourts: number,
    customRounds?: number,
    title?: string,
    customA?: TournamentParticipant[],
    customB?: TournamentParticipant[]
): TeamBattleEngineResult {
    const y = numCourts * 2;
    const rounds = customRounds && customRounds > 0 ? customRounds : Math.max(1, y - 1);
    const players: TournamentParticipant[] = [];

    for (let i = 0; i < y; i++) {
        if (customA && customA[i]) {
            players.push({
                ...customA[i],
                id: customA[i].id !== undefined ? customA[i].id : i,
                group: "Alpha",
            });
        } else {
            players.push({ id: i, name: `Alpha ${i + 1}`, group: "Alpha" });
        }
    }

    for (let i = 0; i < y; i++) {
        if (customB && customB[i]) {
            players.push({
                ...customB[i],
                id: customB[i].id !== undefined ? customB[i].id : y + i,
                group: "Beta",
            });
        } else {
            players.push({ id: y + i, name: `Beta ${i + 1}`, group: "Beta" });
        }
    }

    const scheduleMatches: TournamentMatch[] = [];
    for (let r = 0; r < rounds; r++) {
        for (let c = 0; c < numCourts; c++) {
            const p1Idx = c * 2;
            const p2Idx = c * 2 + 1;
            const p3Idx = y + ((c * 2 + r) % y);
            const p4Idx = y + ((c * 2 + 1 + r) % y);

            const p1 = players[p1Idx];
            const p2 = players[p2Idx];
            const p3 = players[p3Idx];
            const p4 = players[p4Idx];

            scheduleMatches.push({
                matchId: `r${r}_c${c}_${Math.random().toString(36).substring(2, 8)}`,
                roundIdx: r,
                courtIdx: c,
                courtName: `Court ${c + 1}`,
                team1PlayerIds: [p1.id, p2.id],
                team2PlayerIds: [p3.id, p4.id],
                team1Names: [p1.name, p2.name],
                team2Names: [p3.name, p4.name],
                team1Photos: [p1.photoURL, p2.photoURL],
                team2Photos: [p3.photoURL, p4.photoURL],
                result: {
                    scoreA: 0,
                    scoreB: 0,
                    status: "not_started",
                    winner: null,
                },
            });
        }
    }

    return {
        tournamentId: Math.random().toString(36).substring(2, 10),
        title: title || `Team Battle (${y * 2} Players, ${numCourts} Courts)`,
        mode: "team_battle",
        numCourts,
        numRounds: rounds,
        players,
        matches: scheduleMatches,
    };
}

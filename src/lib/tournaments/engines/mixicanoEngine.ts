import { TournamentMatch, TournamentParticipant } from "../types";

export interface MixicanoEngineResult {
    tournamentId: string;
    title: string;
    mode: "mixicano";
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    matches: TournamentMatch[];
}

/**
 * Solves a Mixicano (Left vs Right) tournament schedule.
 * Each court features 2 Left players and 2 Right players, paired (L1+R1) vs (L2+R2).
 */
export function solveMixicano(
    numCourts: number,
    customRounds?: number,
    title?: string,
    customL?: TournamentParticipant[],
    customR?: TournamentParticipant[]
): MixicanoEngineResult {
    const x = numCourts * 2;
    const rounds = customRounds && customRounds > 0 ? customRounds : x;
    const players: TournamentParticipant[] = [];

    for (let i = 0; i < x; i++) {
        if (customL && customL[i]) {
            players.push({
                ...customL[i],
                id: customL[i].id !== undefined ? customL[i].id : i,
                group: "L",
                preferredSide: "Left",
            });
        } else {
            players.push({ id: i, name: `Player ${i + 1}L`, group: "L", preferredSide: "Left" });
        }
    }

    for (let i = 0; i < x; i++) {
        if (customR && customR[i]) {
            players.push({
                ...customR[i],
                id: customR[i].id !== undefined ? customR[i].id : x + i,
                group: "R",
                preferredSide: "Right",
            });
        } else {
            players.push({ id: x + i, name: `Player ${i + 1}R`, group: "R", preferredSide: "Right" });
        }
    }

    const scheduleMatches: TournamentMatch[] = [];
    for (let r = 0; r < rounds; r++) {
        const teams: { lIdx: number; rIdx: number }[] = [];
        for (let i = 0; i < x; i++) {
            const l = i;
            const rightIdx = (i + r) % x;
            teams.push({ lIdx: l, rIdx: x + rightIdx });
        }

        for (let c = 0; c < numCourts; c++) {
            const t1 = teams[c * 2];
            const t2 = teams[c * 2 + 1];

            const p1 = players[t1.lIdx];
            const p2 = players[t1.rIdx];
            const p3 = players[t2.lIdx];
            const p4 = players[t2.rIdx];

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
        title: title || `Mixicano (${x * 2} Players, ${numCourts} Courts)`,
        mode: "mixicano",
        numCourts,
        numRounds: rounds,
        players,
        matches: scheduleMatches,
    };
}

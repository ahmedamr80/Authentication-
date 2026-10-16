import { TournamentMatch, TournamentParticipant } from "../types";

export interface AmericanoEngineResult {
    tournamentId: string;
    title: string;
    mode: "americano";
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    matches: TournamentMatch[];
}

/**
 * Solves an Americano tournament schedule using simulated annealing.
 * Each round pairs players such that partners and opponents are balanced.
 */
export function solveAmericano(
    numPlayers: number,
    numCourts: number,
    customRounds?: number,
    title?: string,
    participants?: TournamentParticipant[]
): AmericanoEngineResult {
    const active = Math.min(numCourts, Math.floor(numPlayers / 4));
    const playersPerRound = active * 4;
    const totalPairs = (numPlayers * (numPlayers - 1)) / 2;
    const pairsPerRound = active * 2;
    const minRounds = pairsPerRound > 0 ? Math.ceil(totalPairs / pairsPerRound) : 1;
    const rounds = customRounds && customRounds > 0 ? customRounds : minRounds;

    const players: TournamentParticipant[] = [];
    for (let i = 0; i < numPlayers; i++) {
        if (participants && participants[i]) {
            players.push({
                ...participants[i],
                id: participants[i].id !== undefined ? participants[i].id : i,
                group: "ALL",
            });
        } else {
            players.push({
                id: i,
                name: `Player ${i + 1}`,
                group: "ALL",
            });
        }
    }

    const scheduleMatches: TournamentMatch[] = [];
    const partCount: number[][] = Array.from({ length: numPlayers }, () => Array(numPlayers).fill(0));
    const oppCount: number[][] = Array.from({ length: numPlayers }, () => Array(numPlayers).fill(0));
    const playCount: number[] = Array(numPlayers).fill(0);

    for (let r = 0; r < rounds; r++) {
        // Sort players by least played to maintain equal participation
        const order = [...Array(numPlayers).keys()].sort(
            (a, b) => playCount[a] - playCount[b] || Math.random() - 0.5
        );
        const activeRoundPlayers = order.slice(0, playersPerRound);

        let bestPairs: number[] = [];
        let bestScore = 999999;
        for (let iter = 0; iter < 40; iter++) {
            const shuffled = [...activeRoundPlayers].sort(() => Math.random() - 0.5);
            let sc = 0;
            for (let c = 0; c < active; c++) {
                const p1 = shuffled[c * 4];
                const p2 = shuffled[c * 4 + 1];
                const p3 = shuffled[c * 4 + 2];
                const p4 = shuffled[c * 4 + 3];
                sc += partCount[p1][p2] * 10 + partCount[p3][p4] * 10;
                sc += oppCount[p1][p3] + oppCount[p1][p4] + oppCount[p2][p3] + oppCount[p2][p4];
            }
            if (sc < bestScore) {
                bestScore = sc;
                bestPairs = shuffled;
            }
        }

        for (let c = 0; c < active; c++) {
            const p1 = bestPairs[c * 4];
            const p2 = bestPairs[c * 4 + 1];
            const p3 = bestPairs[c * 4 + 2];
            const p4 = bestPairs[c * 4 + 3];

            partCount[p1][p2]++;
            partCount[p2][p1]++;
            partCount[p3][p4]++;
            partCount[p4][p3]++;
            [p1, p2].forEach((p) =>
                [p3, p4].forEach((q) => {
                    oppCount[p][q]++;
                    oppCount[q][p]++;
                })
            );
            playCount[p1]++;
            playCount[p2]++;
            playCount[p3]++;
            playCount[p4]++;

            const p1Obj = players[p1];
            const p2Obj = players[p2];
            const p3Obj = players[p3];
            const p4Obj = players[p4];

            scheduleMatches.push({
                matchId: `r${r}_c${c}_${Math.random().toString(36).substring(2, 8)}`,
                roundIdx: r,
                courtIdx: c,
                courtName: `Court ${c + 1}`,
                team1PlayerIds: [p1Obj.id, p2Obj.id],
                team2PlayerIds: [p3Obj.id, p4Obj.id],
                team1Names: [p1Obj.name, p2Obj.name],
                team2Names: [p3Obj.name, p4Obj.name],
                team1Photos: [p1Obj.photoURL, p2Obj.photoURL],
                team2Photos: [p3Obj.photoURL, p4Obj.photoURL],
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
        title: title || `Americano (${numPlayers} Players, ${numCourts} Courts)`,
        mode: "americano",
        numCourts,
        numRounds: rounds,
        players,
        matches: scheduleMatches,
    };
}

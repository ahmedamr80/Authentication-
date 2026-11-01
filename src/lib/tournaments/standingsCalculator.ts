import {
    TournamentMatch,
    TournamentPair,
    TournamentParticipant,
    TournamentStandingsEntry,
    evaluateMatchSets,
    isMatchClosed,
} from "./types";

function normalizeWinnerSide(w?: string | null): "Side A" | "Side B" | "Draw" | null {
    if (!w) return null;
    if (w === "Side A" || w === "Team 1") return "Side A";
    if (w === "Side B" || w === "Team 2") return "Side B";
    if (w === "Draw") return "Draw";
    return null;
}

/**
 * Helper to extract effective match games, sets won, and winner for a closed match.
 */
function extractClosedMatchMetrics(m: TournamentMatch) {
    const res = m.result;
    const hasCustomSets = Array.isArray(res?.sets) && res.sets.length > 0;

    if (hasCustomSets) {
        const numSets = (res.sets!.length === 5 ? 5 : res.sets!.length === 3 ? 3 : 1) as 1 | 3 | 5;
        const evalRes = evaluateMatchSets(res.sets, numSets, m.teamAId, m.teamBId);
        const winner = normalizeWinnerSide(res.winner) || normalizeWinnerSide(evalRes.winner);
        const isDraw = res.isDraw !== undefined ? res.isDraw : winner === "Draw";
        return {
            gamesA: evalRes.totalGamesA,
            gamesB: evalRes.totalGamesB,
            setsA: evalRes.setsWonA,
            setsB: evalRes.setsWonB,
            winner,
            isDraw,
        };
    }

    const sA = Number(res?.scoreA) || 0;
    const sB = Number(res?.scoreB) || 0;
    let winner = normalizeWinnerSide(res?.winner);
    if (!winner) {
        if (sA > sB) winner = "Side A";
        else if (sB > sA) winner = "Side B";
        else winner = "Draw";
    }
    const isDraw = res?.isDraw !== undefined ? res.isDraw : winner === "Draw";

    return {
        gamesA: sA,
        gamesB: sB,
        setsA: winner === "Side A" ? 1 : 0,
        setsB: winner === "Side B" ? 1 : 0,
        winner,
        isDraw,
    };
}

/**
 * Calculates individual player standings (for Americano, Mixicano, and individual rankings).
 * Evaluates points, wins, draws, losses, games for, games against, diff, sets diff, and walkovers conceded.
 */
export function calculatePlayerStandings(
    players: TournamentParticipant[],
    matches: TournamentMatch[],
    filterGroup?: string
): TournamentStandingsEntry[] {
    const entries: Record<string, TournamentStandingsEntry> = {};

    players.forEach((p) => {
        entries[String(p.id)] = {
            id: p.id,
            name: p.name,
            photoURL: p.photoURL || undefined,
            groupId: p.group || "ALL",
            points: 0,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            diff: 0,
            setsWon: 0,
            setsLost: 0,
            setsDiff: 0,
            walkoversConceded: 0,
            rank: 1,
        };
    });

    matches.forEach((m) => {
        const res = m.result;
        if (!res || !isMatchClosed(res.status)) return;

        const { gamesA, gamesB, setsA, setsB, winner, isDraw } = extractClosedMatchMetrics(m);

        m.team1PlayerIds.forEach((id) => {
            const e = entries[String(id)];
            if (!e) return;
            e.played++;
            e.gf += gamesA;
            e.ga += gamesB;
            e.setsWon = (e.setsWon || 0) + setsA;
            e.setsLost = (e.setsLost || 0) + setsB;

            if (winner === "Side A" && !isDraw) {
                e.wins++;
                e.points += 3;
            } else if (isDraw || winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && winner === "Side B") {
                e.walkoversConceded++;
            }
        });

        m.team2PlayerIds.forEach((id) => {
            const e = entries[String(id)];
            if (!e) return;
            e.played++;
            e.gf += gamesB;
            e.ga += gamesA;
            e.setsWon = (e.setsWon || 0) + setsB;
            e.setsLost = (e.setsLost || 0) + setsA;

            if (winner === "Side B" && !isDraw) {
                e.wins++;
                e.points += 3;
            } else if (isDraw || winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && winner === "Side A") {
                e.walkoversConceded++;
            }
        });
    });

    let list = Object.values(entries);
    if (filterGroup && filterGroup !== "ALL") {
        list = list.filter((e) => e.groupId === filterGroup);
    }

    list.forEach((e) => {
        e.diff = e.gf - e.ga;
        e.setsDiff = (e.setsWon || 0) - (e.setsLost || 0);
    });

    // Multi-Tier Sorting (Points -> Wins -> Sets Diff -> Games Diff -> GF -> Walkovers -> ID)
    list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if ((b.setsDiff || 0) !== (a.setsDiff || 0)) return (b.setsDiff || 0) - (a.setsDiff || 0);
        if (b.diff !== a.diff) return b.diff - a.diff;
        if (b.gf !== a.gf) return b.gf - a.gf;
        if (a.walkoversConceded !== b.walkoversConceded) return a.walkoversConceded - b.walkoversConceded;
        return String(a.id).localeCompare(String(b.id));
    });

    list.forEach((e, idx) => {
        e.rank = idx + 1;
    });

    return list;
}

/**
 * Calculates standings for pairs/teams in Round Robin or Hybrid tournaments.
 */
export function calculatePairStandings(
    pairs: TournamentPair[],
    matches: TournamentMatch[],
    filterGroupId?: string
): TournamentStandingsEntry[] {
    const entries: Record<string, TournamentStandingsEntry> = {};

    pairs.forEach((p) => {
        entries[p.pairId] = {
            id: p.pairId,
            name: p.pairName,
            pairId: p.pairId,
            pairName: p.pairName,
            playerPhotos: (p.playerPhotos || []).map((ph) => ph || undefined),
            groupId: p.groupId || "Group A",
            points: 0,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            diff: 0,
            setsWon: 0,
            setsLost: 0,
            setsDiff: 0,
            walkoversConceded: 0,
            rank: 1,
        };
    });

    matches.forEach((m) => {
        // Exclude knockout matches from round robin group standings
        if (m.matchId && m.matchId.startsWith("ko_")) return;
        const res = m.result;
        if (!res || !isMatchClosed(res.status)) return;

        const { gamesA, gamesB, setsA, setsB, winner, isDraw } = extractClosedMatchMetrics(m);

        const pairA =
            (m.teamAId && pairs.find((p) => p.pairId === m.teamAId)) ||
            pairs.find((p) => p.playerIds && p.playerIds.every((pid) => m.team1PlayerIds.includes(pid)));
        const pairB =
            (m.teamBId && pairs.find((p) => p.pairId === m.teamBId)) ||
            pairs.find((p) => p.playerIds && p.playerIds.every((pid) => m.team2PlayerIds.includes(pid)));

        if (pairA && entries[pairA.pairId]) {
            const e = entries[pairA.pairId];
            e.played++;
            e.gf += gamesA;
            e.ga += gamesB;
            e.setsWon = (e.setsWon || 0) + setsA;
            e.setsLost = (e.setsLost || 0) + setsB;
            if (winner === "Side A" && !isDraw) {
                e.wins++;
                e.points += 3;
            } else if (isDraw || winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && winner === "Side B") e.walkoversConceded++;
        }

        if (pairB && entries[pairB.pairId]) {
            const e = entries[pairB.pairId];
            e.played++;
            e.gf += gamesB;
            e.ga += gamesA;
            e.setsWon = (e.setsWon || 0) + setsB;
            e.setsLost = (e.setsLost || 0) + setsA;
            if (winner === "Side B" && !isDraw) {
                e.wins++;
                e.points += 3;
            } else if (isDraw || winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && winner === "Side A") e.walkoversConceded++;
        }
    });

    let list = Object.values(entries);
    if (filterGroupId && filterGroupId !== "ALL") {
        list = list.filter((e) => e.groupId === filterGroupId);
    }

    list.forEach((e) => {
        e.diff = e.gf - e.ga;
        e.setsDiff = (e.setsWon || 0) - (e.setsLost || 0);
    });

    list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if ((b.setsDiff || 0) !== (a.setsDiff || 0)) return (b.setsDiff || 0) - (a.setsDiff || 0);
        if (b.diff !== a.diff) return b.diff - a.diff;
        if (b.gf !== a.gf) return b.gf - a.gf;

        // Head-to-head tiebreak
        const h2hMatches = matches.filter((m) => {
            if (m.matchId && m.matchId.startsWith("ko_")) return false;
            const res = m.result;
            if (!res || !isMatchClosed(res.status)) return false;
            const pairA = pairs.find((p) => p.pairId === a.pairId);
            const pairB = pairs.find((p) => p.pairId === b.pairId);
            if (!pairA || !pairB) return false;
            const hasA1 = pairA.playerIds.every((pid) => m.team1PlayerIds.includes(pid));
            const hasB2 = pairB.playerIds.every((pid) => m.team2PlayerIds.includes(pid));
            const hasB1 = pairB.playerIds.every((pid) => m.team1PlayerIds.includes(pid));
            const hasA2 = pairA.playerIds.every((pid) => m.team2PlayerIds.includes(pid));
            return (hasA1 && hasB2) || (hasB1 && hasA2);
        });

        if (h2hMatches.length > 0) {
            let h2hA = 0;
            let h2hB = 0;
            h2hMatches.forEach((m) => {
                const pairA = pairs.find((p) => p.pairId === a.pairId);
                const hasA1 = pairA && pairA.playerIds.every((pid) => m.team1PlayerIds.includes(pid));
                const { winner, isDraw } = extractClosedMatchMetrics(m);
                if (!isDraw) {
                    if ((hasA1 && winner === "Side A") || (!hasA1 && winner === "Side B")) h2hA += 3;
                    else if ((hasA1 && winner === "Side B") || (!hasA1 && winner === "Side A")) h2hB += 3;
                }
            });
            if (h2hA !== h2hB) return h2hB - h2hA;
        }

        if (a.walkoversConceded !== b.walkoversConceded) return a.walkoversConceded - b.walkoversConceded;
        return (a.pairId || "").localeCompare(b.pairId || "");
    });

    list.forEach((e, idx) => {
        e.rank = idx + 1;
    });

    return list;
}

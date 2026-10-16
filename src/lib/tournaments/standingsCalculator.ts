import { TournamentDocument, TournamentMatch, TournamentPair, TournamentParticipant, TournamentStandingsEntry } from "./types";

/**
 * Calculates individual player standings (for Americano, Mixicano, and individual rankings).
 * Evaluates points, wins, draws, losses, games for, games against, diff, and walkovers conceded.
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
            groupId: p.group || "ALL",
            points: 0,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            diff: 0,
            walkoversConceded: 0,
            rank: 1,
        };
    });

    matches.forEach((m) => {
        const res = m.result;
        if (!res || (res.status !== "completed" && res.status !== "walkover")) return;

        const sA = res.scoreA || 0;
        const sB = res.scoreB || 0;

        m.team1PlayerIds.forEach((id) => {
            const e = entries[String(id)];
            if (!e) return;
            e.played++;
            e.gf += sA;
            e.ga += sB;
            if (sA > sB || res.winner === "Side A") {
                e.wins++;
                e.points += 3;
            } else if (sA === sB && res.winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && res.winner === "Side B") {
                e.walkoversConceded++;
            }
        });

        m.team2PlayerIds.forEach((id) => {
            const e = entries[String(id)];
            if (!e) return;
            e.played++;
            e.gf += sB;
            e.ga += sA;
            if (sB > sA || res.winner === "Side B") {
                e.wins++;
                e.points += 3;
            } else if (sA === sB && res.winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && res.winner === "Side A") {
                e.walkoversConceded++;
            }
        });
    });

    let list = Object.values(entries);
    if (filterGroup && filterGroup !== "ALL") {
        list = list.filter((e) => e.groupId === filterGroup);
    }

    list.forEach((e) => (e.diff = e.gf - e.ga));

    // 8-Tier Sorting
    list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
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
            groupId: p.groupId || "Group A",
            points: 0,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            diff: 0,
            walkoversConceded: 0,
            rank: 1,
        };
    });

    matches.forEach((m) => {
        // Exclude knockout matches from round robin group standings
        if (m.matchId && m.matchId.startsWith("ko_")) return;
        const res = m.result;
        if (!res || (res.status !== "completed" && res.status !== "walkover")) return;

        const sA = res.scoreA || 0;
        const sB = res.scoreB || 0;

        const pairA = pairs.find(
            (p) => p.playerIds && p.playerIds.every((pid) => m.team1PlayerIds.includes(pid))
        );
        const pairB = pairs.find(
            (p) => p.playerIds && p.playerIds.every((pid) => m.team2PlayerIds.includes(pid))
        );

        if (pairA && entries[pairA.pairId]) {
            const e = entries[pairA.pairId];
            e.played++;
            e.gf += sA;
            e.ga += sB;
            if (sA > sB || res.winner === "Side A") {
                e.wins++;
                e.points += 3;
            } else if (sA === sB && res.winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && res.winner === "Side B") e.walkoversConceded++;
        }

        if (pairB && entries[pairB.pairId]) {
            const e = entries[pairB.pairId];
            e.played++;
            e.gf += sB;
            e.ga += sA;
            if (sB > sA || res.winner === "Side B") {
                e.wins++;
                e.points += 3;
            } else if (sA === sB && res.winner === "Draw") {
                e.draws++;
                e.points += 1;
            } else {
                e.losses++;
            }
            if (res.status === "walkover" && res.winner === "Side A") e.walkoversConceded++;
        }
    });

    let list = Object.values(entries);
    if (filterGroupId && filterGroupId !== "ALL") {
        list = list.filter((e) => e.groupId === filterGroupId);
    }

    list.forEach((e) => (e.diff = e.gf - e.ga));

    list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.diff !== a.diff) return b.diff - a.diff;
        if (b.gf !== a.gf) return b.gf - a.gf;

        // Head-to-head tiebreak
        const h2hMatches = matches.filter((m) => {
            if (m.matchId && m.matchId.startsWith("ko_")) return false;
            const res = m.result;
            if (!res || (res.status !== "completed" && res.status !== "walkover")) return false;
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
                const sA = hasA1 ? m.result.scoreA : m.result.scoreB;
                const sB = hasA1 ? m.result.scoreB : m.result.scoreA;
                if (sA > sB) h2hA += 3;
                else if (sB > sA) h2hB += 3;
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

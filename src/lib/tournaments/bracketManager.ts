import { BracketSlot } from "./engines/knockoutEngine";
import { TournamentMatch, TournamentPair, isMatchClosed } from "./types";
import { calculatePairStandings } from "./standingsCalculator";

export function updateBracketProgression(
    bracketSlots: BracketSlot[],
    matches: TournamentMatch[],
    pairs: TournamentPair[]
): void {
    if (!bracketSlots || bracketSlots.length === 0) return;
    const slotMap: Record<string, BracketSlot> = {};
    bracketSlots.forEach((s) => (slotMap[s.slotId] = s));

    for (let pass = 0; pass < 5; pass++) {
        bracketSlots.forEach((slot) => {
            // 1. Check match result
            if (slot.matchId) {
                const m = matches.find((x) => x.matchId === slot.matchId);
                if (m && isMatchClosed(m.result.status)) {
                    if (m.result.winner === "Side A" || (!m.result.winner && m.result.scoreA > m.result.scoreB)) {
                        slot.winnerPairId = slot.resolvedPairAId;
                    } else if (m.result.winner === "Side B" || (!m.result.winner && m.result.scoreB > m.result.scoreA)) {
                        slot.winnerPairId = slot.resolvedPairBId;
                    } else {
                        slot.winnerPairId = null;
                    }
                } else if (m && !isMatchClosed(m.result.status)) {
                    slot.winnerPairId = null;
                }
            }

            // 2. Auto advance byes
            if (!slot.winnerPairId) {
                if (slot.resolvedPairAId && (!slot.sourceB || slot.sourceB.type === "bye")) {
                    slot.winnerPairId = slot.resolvedPairAId;
                } else if (slot.resolvedPairBId && (!slot.sourceA || slot.sourceA.type === "bye")) {
                    slot.winnerPairId = slot.resolvedPairBId;
                }
            }

            // 3. Downstream slot resolution
            if (slot.sourceA && slot.sourceA.type === "slot" && slot.sourceA.fromSlot) {
                const prev = slotMap[slot.sourceA.fromSlot];
                if (prev && prev.winnerPairId) slot.resolvedPairAId = prev.winnerPairId;
            }
            if (slot.sourceB && slot.sourceB.type === "slot" && slot.sourceB.fromSlot) {
                const prev = slotMap[slot.sourceB.fromSlot];
                if (prev && prev.winnerPairId) slot.resolvedPairBId = prev.winnerPairId;
            }

            // 4. Semi-loser resolution for 3rd place playoff
            if (slot.sourceA && slot.sourceA.type === "semi_loser" && slot.sourceA.fromSlot) {
                const semiA = slotMap[slot.sourceA.fromSlot];
                if (semiA && semiA.winnerPairId && semiA.resolvedPairAId && semiA.resolvedPairBId) {
                    const loserId =
                        semiA.winnerPairId === semiA.resolvedPairAId
                            ? semiA.resolvedPairBId
                            : semiA.resolvedPairAId;
                    slot.resolvedPairAId = loserId;
                }
            }
            if (slot.sourceB && slot.sourceB.type === "semi_loser" && slot.sourceB.fromSlot) {
                const semiB = slotMap[slot.sourceB.fromSlot];
                if (semiB && semiB.winnerPairId && semiB.resolvedPairAId && semiB.resolvedPairBId) {
                    const loserId =
                        semiB.winnerPairId === semiB.resolvedPairAId
                            ? semiB.resolvedPairBId
                            : semiB.resolvedPairAId;
                    slot.resolvedPairBId = loserId;
                }
            }

            // 5. Synchronize match entry
            if (slot.matchId && slot.resolvedPairAId && slot.resolvedPairBId) {
                const m = matches.find((x) => x.matchId === slot.matchId);
                const pairA = pairs.find((p) => p.pairId === slot.resolvedPairAId);
                const pairB = pairs.find((p) => p.pairId === slot.resolvedPairBId);
                if (m && pairA && pairB) {
                    m.teamAId = pairA.pairId;
                    m.teamBId = pairB.pairId;
                    m.team1PlayerIds = pairA.playerIds;
                    m.team2PlayerIds = pairB.playerIds;
                    m.team1Names = pairA.playerNames;
                    m.team2Names = pairB.playerNames;
                    m.team1Photos = pairA.playerPhotos;
                    m.team2Photos = pairB.playerPhotos;
                }
            }
        });
    }
}

export function syncQualifiersFromGroups(
    groups: Array<{ groupId: string; pairIds: string[] }>,
    bracketSlots: BracketSlot[],
    matches: TournamentMatch[],
    pairs: TournamentPair[]
): number {
    const groupStandings: Record<string, ReturnType<typeof calculatePairStandings>> = {};
    groups.forEach((g) => {
        groupStandings[g.groupId] = calculatePairStandings(pairs, matches, g.groupId);
    });

    let populated = 0;
    bracketSlots.forEach((slot) => {
        if (slot.sourceA && slot.sourceA.type === "group_qualifier" && slot.sourceA.groupId && slot.sourceA.rank) {
            const list = groupStandings[slot.sourceA.groupId] || [];
            if (list.length >= slot.sourceA.rank) {
                slot.resolvedPairAId = list[slot.sourceA.rank - 1].pairId || null;
                populated++;
            }
        }
        if (slot.sourceB && slot.sourceB.type === "group_qualifier" && slot.sourceB.groupId && slot.sourceB.rank) {
            const list = groupStandings[slot.sourceB.groupId] || [];
            if (list.length >= slot.sourceB.rank) {
                slot.resolvedPairBId = list[slot.sourceB.rank - 1].pairId || null;
                populated++;
            }
        }
    });

    updateBracketProgression(bracketSlots, matches, pairs);
    return populated;
}

import { TournamentMatch, TournamentPair, TournamentParticipant } from "../types";

export interface BracketSlot {
    slotId: string;
    stageId: string;
    sourceA: { type: "seed" | "slot" | "group_qualifier" | "semi_loser" | "bye"; seed?: number; fromSlot?: string; groupId?: string; rank?: number };
    sourceB: { type: "seed" | "slot" | "group_qualifier" | "semi_loser" | "bye"; seed?: number; fromSlot?: string; groupId?: string; rank?: number };
    resolvedPairAId: string | null;
    resolvedPairBId: string | null;
    winnerPairId: string | null;
    matchId: string;
    nextSlotId?: string;
}

export interface KnockoutEngineResult {
    tournamentId: string;
    title: string;
    mode: "knockout";
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    pairs: TournamentPair[];
    matches: TournamentMatch[];
    stages: Array<{
        stageId: string;
        stageType: string;
        stageOrder: number;
        groupIds: string[];
        status: string;
    }>;
    bracketSlots: BracketSlot[];
}

export function generateStandardBracketSeeds(capacity: number): number[] {
    let seeds = [1, 2];
    while (seeds.length < capacity) {
        const nextSeeds: number[] = [];
        const nextSum = seeds.length * 2 + 1;
        for (const s of seeds) {
            nextSeeds.push(s);
            nextSeeds.push(nextSum - s);
        }
        seeds = nextSeeds;
    }
    return seeds;
}

export function getStageNameForCapacity(cap: number): string {
    if (cap === 2) return "final";
    if (cap === 4) return "semifinal";
    if (cap === 8) return "quarterfinal";
    if (cap === 16) return "round_of_16";
    if (cap === 32) return "round_of_32";
    return `round_of_${cap}`;
}

export function solveKnockout(
    pairs: TournamentPair[],
    numCourts: number,
    thirdPlace?: boolean,
    title?: string
): KnockoutEngineResult | null {
    if (!pairs || pairs.length < 2) return null;
    numCourts = Math.max(1, numCourts || 1);
    const nPairs = pairs.length;
    let capacity = 1;
    while (capacity < nPairs) capacity *= 2;
    const numRounds = Math.round(Math.log2(capacity));

    const sortedPairs = [...pairs].sort((a, b) => (a.seed || 9999) - (b.seed || 9999));
    const seedToPair: Record<number, TournamentPair> = {};
    sortedPairs.forEach((p, idx) => {
        p.seed = idx + 1;
        seedToPair[p.seed] = p;
    });

    const players: TournamentParticipant[] = [];
    sortedPairs.forEach((p) => {
        p.playerIds.forEach((pid, idx) => {
            const pName =
                p.playerNames && p.playerNames[idx]
                    ? p.playerNames[idx]
                    : p.pairName || `Team ${p.pairId}`;
            players.push({ id: pid, name: pName, group: "KNOCKOUT" });
        });
    });

    const round1Seeds = generateStandardBracketSeeds(capacity);
    const stages: KnockoutEngineResult["stages"] = [];
    const bracketSlots: BracketSlot[] = [];
    const slotsByLevel: Record<number, BracketSlot[]> = {};

    let currentRoundCap = capacity;
    for (let level = 0; level < numRounds; level++) {
        const stageName = getStageNameForCapacity(currentRoundCap);
        stages.push({
            stageId: stageName,
            stageType: stageName,
            stageOrder: level + 1,
            groupIds: [],
            status: level === 0 ? "active" : "pending",
        });

        const numSlotsInLevel = currentRoundCap / 2;
        const levelSlots: BracketSlot[] = [];

        for (let sIdx = 0; sIdx < numSlotsInLevel; sIdx++) {
            const slotId = `slot_${stageName}_${sIdx + 1}`;
            if (level === 0) {
                const seedA = round1Seeds[2 * sIdx];
                const seedB = round1Seeds[2 * sIdx + 1];
                const pairA = seedToPair[seedA] || null;
                const pairB = seedToPair[seedB] || null;

                const srcA: BracketSlot["sourceA"] = pairA ? { type: "seed", seed: seedA } : { type: "bye" };
                const srcB: BracketSlot["sourceB"] = pairB ? { type: "seed", seed: seedB } : { type: "bye" };
                let winnerId: string | null = null;
                if (pairA && !pairB) winnerId = pairA.pairId;
                else if (pairB && !pairA) winnerId = pairB.pairId;

                const slot: BracketSlot = {
                    slotId,
                    stageId: stageName,
                    sourceA: srcA,
                    sourceB: srcB,
                    resolvedPairAId: pairA ? pairA.pairId : null,
                    resolvedPairBId: pairB ? pairB.pairId : null,
                    winnerPairId: winnerId,
                    matchId: `ko_${slotId}`,
                };
                levelSlots.push(slot);
            } else {
                const prevA = slotsByLevel[level - 1][2 * sIdx];
                const prevB = slotsByLevel[level - 1][2 * sIdx + 1];
                const slot: BracketSlot = {
                    slotId,
                    stageId: stageName,
                    sourceA: { type: "slot", fromSlot: prevA.slotId },
                    sourceB: { type: "slot", fromSlot: prevB.slotId },
                    resolvedPairAId: prevA.winnerPairId || null,
                    resolvedPairBId: prevB.winnerPairId || null,
                    winnerPairId: null,
                    matchId: `ko_${slotId}`,
                };
                prevA.nextSlotId = slotId;
                prevB.nextSlotId = slotId;
                levelSlots.push(slot);
            }
            bracketSlots.push(levelSlots[levelSlots.length - 1]);
        }
        slotsByLevel[level] = levelSlots;
        currentRoundCap /= 2;
    }

    // 3rd place playoff
    if (thirdPlace && capacity >= 4) {
        const semiLevel = numRounds - 2;
        const semiSlots = slotsByLevel[semiLevel];
        if (semiSlots && semiSlots.length === 2) {
            stages.push({
                stageId: "third_place",
                stageType: "third_place",
                stageOrder: numRounds + 1,
                groupIds: [],
                status: "pending",
            });
            const tpSlot: BracketSlot = {
                slotId: "slot_third_place_1",
                stageId: "third_place",
                sourceA: { type: "semi_loser", fromSlot: semiSlots[0].slotId },
                sourceB: { type: "semi_loser", fromSlot: semiSlots[1].slotId },
                resolvedPairAId: null,
                resolvedPairBId: null,
                winnerPairId: null,
                matchId: "ko_slot_third_place_1",
            };
            bracketSlots.push(tpSlot);
        }
    }

    // Build matches
    const scheduleMatches: TournamentMatch[] = [];
    let timeSlot = 0;
    const chunkSize = Math.max(1, numCourts);

    const r1Slots = slotsByLevel[0] || [];
    const playableR1 = r1Slots.filter((s) => s.resolvedPairAId && s.resolvedPairBId);
    for (let i = 0; i < playableR1.length; i += chunkSize) {
        const chunk = playableR1.slice(i, i + chunkSize);
        chunk.forEach((slot, cIdx) => {
            const pA = sortedPairs.find((p) => p.pairId === slot.resolvedPairAId);
            const pB = sortedPairs.find((p) => p.pairId === slot.resolvedPairBId);
            scheduleMatches.push({
                matchId: slot.matchId,
                roundIdx: timeSlot,
                courtIdx: cIdx,
                courtName: `Court ${cIdx + 1}`,
                stageId: slot.stageId,
                bracketSlotId: slot.slotId,
                team1PlayerIds: pA ? pA.playerIds : [],
                team2PlayerIds: pB ? pB.playerIds : [],
                team1Names: pA ? pA.playerNames : [],
                team2Names: pB ? pB.playerNames : [],
                team1Photos: pA ? pA.playerPhotos : [],
                team2Photos: pB ? pB.playerPhotos : [],
                result: { scoreA: 0, scoreB: 0, status: "not_started", winner: null },
            });
        });
        timeSlot++;
    }

    for (let level = 1; level < numRounds; level++) {
        const lSlots = slotsByLevel[level] || [];
        for (let i = 0; i < lSlots.length; i += chunkSize) {
            const chunk = lSlots.slice(i, i + chunkSize);
            chunk.forEach((slot, cIdx) => {
                const pA = sortedPairs.find((p) => p.pairId === slot.resolvedPairAId);
                const pB = sortedPairs.find((p) => p.pairId === slot.resolvedPairBId);
                scheduleMatches.push({
                    matchId: slot.matchId,
                    roundIdx: timeSlot,
                    courtIdx: cIdx,
                    courtName: `Court ${cIdx + 1}`,
                    stageId: slot.stageId,
                    bracketSlotId: slot.slotId,
                    team1PlayerIds: pA ? pA.playerIds : [],
                    team2PlayerIds: pB ? pB.playerIds : [],
                    team1Names: pA ? pA.playerNames : [],
                    team2Names: pB ? pB.playerNames : [],
                    team1Photos: pA ? pA.playerPhotos : [],
                    team2Photos: pB ? pB.playerPhotos : [],
                    result: { scoreA: 0, scoreB: 0, status: "not_started", winner: null },
                });
            });
            timeSlot++;
        }
    }

    if (thirdPlace && capacity >= 4) {
        scheduleMatches.push({
            matchId: "ko_slot_third_place_1",
            roundIdx: timeSlot,
            courtIdx: 0,
            courtName: "Court 1",
            stageId: "third_place",
            bracketSlotId: "slot_third_place_1",
            team1PlayerIds: [],
            team2PlayerIds: [],
            result: { scoreA: 0, scoreB: 0, status: "not_started", winner: null },
        });
        timeSlot++;
    }

    return {
        tournamentId: Math.random().toString(36).substring(2, 10),
        title: title || `Knockout Cup (${pairs.length} Pairs)`,
        mode: "knockout",
        numCourts,
        numRounds: Math.max(1, timeSlot),
        players,
        pairs: sortedPairs,
        matches: scheduleMatches,
        stages,
        bracketSlots,
    };
}

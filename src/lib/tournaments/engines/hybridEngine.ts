import { TournamentMatch, TournamentPair, TournamentParticipant } from "../types";
import { solveRoundRobin } from "./roundRobinEngine";
import { BracketSlot, generateStandardBracketSeeds, getStageNameForCapacity } from "./knockoutEngine";

export interface HybridEngineResult {
    tournamentId: string;
    title: string;
    mode: "round_robin_knockout";
    numCourts: number;
    numRounds: number;
    players: TournamentParticipant[];
    pairs: TournamentPair[];
    groups: Array<{ groupId: string; pairIds: string[] }>;
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

export function solveRoundRobinKnockout(
    pairs: TournamentPair[],
    numCourts: number,
    numGroups?: number,
    cycles?: 1 | 2,
    qualifiersPerGroup?: number,
    thirdPlace?: boolean,
    title?: string
): HybridEngineResult | null {
    const resolvedNumGroups = Math.max(2, numGroups || 2);
    const resolvedQualifiers = Math.max(1, qualifiersPerGroup || 2);
    const resolvedCycles = cycles === 2 ? 2 : 1;

    const rrSchedule = solveRoundRobin(pairs, numCourts, resolvedNumGroups, resolvedCycles, title);
    if (!rrSchedule) return null;

    const totalQualifiers = resolvedNumGroups * resolvedQualifiers;
    let capacity = 1;
    while (capacity < totalQualifiers) capacity *= 2;
    const numKoRounds = Math.round(Math.log2(capacity));

    const groupNames: string[] = [];
    for (let i = 0; i < resolvedNumGroups; i++) groupNames.push(`Group ${String.fromCharCode(65 + i)}`);

    const seedQualifierMap: Record<number, { groupId: string; rank: number }> = {};
    for (let gIdx = 0; gIdx < resolvedNumGroups; gIdx++) {
        seedQualifierMap[gIdx + 1] = { groupId: groupNames[gIdx], rank: 1 };
    }
    if (resolvedQualifiers >= 2) {
        for (let gIdx = 0; gIdx < resolvedNumGroups; gIdx++) {
            const s = gIdx + 1;
            const oppSeed = capacity + 1 - s;
            const oppGIdx = (gIdx + 1) % resolvedNumGroups;
            seedQualifierMap[oppSeed] = { groupId: groupNames[oppGIdx], rank: 2 };
        }
    }

    const assignedSeeds = new Set(Object.keys(seedQualifierMap).map(Number));
    const remainingSeeds: number[] = [];
    for (let s = 1; s <= totalQualifiers; s++) {
        if (!assignedSeeds.has(s)) remainingSeeds.push(s);
    }
    let remIdx = 0;
    for (let r = 3; r <= resolvedQualifiers; r++) {
        for (let gIdx = 0; gIdx < resolvedNumGroups; gIdx++) {
            if (remIdx < remainingSeeds.length) {
                seedQualifierMap[remainingSeeds[remIdx]] = { groupId: groupNames[gIdx], rank: r };
                remIdx++;
            }
        }
    }

    const round1Seeds = generateStandardBracketSeeds(capacity);
    const koStages: HybridEngineResult["stages"] = [];
    const koBracketSlots: BracketSlot[] = [];
    const slotsByLevel: Record<number, BracketSlot[]> = {};

    let currentCap = capacity;
    for (let level = 0; level < numKoRounds; level++) {
        const stageName = getStageNameForCapacity(currentCap);
        koStages.push({
            stageId: stageName,
            stageType: stageName,
            stageOrder: level + 2,
            groupIds: [],
            status: "pending",
        });

        const numSlots = currentCap / 2;
        const levelSlots: BracketSlot[] = [];

        for (let sIdx = 0; sIdx < numSlots; sIdx++) {
            const slotId = `slot_${stageName}_${sIdx + 1}`;
            if (level === 0) {
                const sA = round1Seeds[2 * sIdx];
                const sB = round1Seeds[2 * sIdx + 1];
                const qA = seedQualifierMap[sA] || null;
                const qB = seedQualifierMap[sB] || null;

                const srcA: BracketSlot["sourceA"] = qA
                    ? { type: "group_qualifier", groupId: qA.groupId, rank: qA.rank, seed: sA }
                    : { type: "bye" };
                const srcB: BracketSlot["sourceB"] = qB
                    ? { type: "group_qualifier", groupId: qB.groupId, rank: qB.rank, seed: sB }
                    : { type: "bye" };

                const slot: BracketSlot = {
                    slotId,
                    stageId: stageName,
                    sourceA: srcA,
                    sourceB: srcB,
                    resolvedPairAId: null,
                    resolvedPairBId: null,
                    winnerPairId: null,
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
                    resolvedPairAId: null,
                    resolvedPairBId: null,
                    winnerPairId: null,
                    matchId: `ko_${slotId}`,
                };
                prevA.nextSlotId = slotId;
                prevB.nextSlotId = slotId;
                levelSlots.push(slot);
            }
            koBracketSlots.push(levelSlots[levelSlots.length - 1]);
        }
        slotsByLevel[level] = levelSlots;
        currentCap /= 2;
    }

    if (thirdPlace && capacity >= 4) {
        const semiLevel = numKoRounds - 2;
        const semiSlots = slotsByLevel[semiLevel];
        if (semiSlots && semiSlots.length === 2) {
            koStages.push({
                stageId: "third_place",
                stageType: "third_place",
                stageOrder: numKoRounds + 2,
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
            koBracketSlots.push(tpSlot);
        }
    }

    let timeSlot = rrSchedule.numRounds;
    const chunkSize = Math.max(1, numCourts);

    for (let level = 0; level < numKoRounds; level++) {
        const lSlots = slotsByLevel[level] || [];
        for (let i = 0; i < lSlots.length; i += chunkSize) {
            const chunk = lSlots.slice(i, i + chunkSize);
            chunk.forEach((slot, cIdx) => {
                rrSchedule.matches.push({
                    matchId: slot.matchId,
                    roundIdx: timeSlot,
                    courtIdx: cIdx,
                    courtName: `Court ${cIdx + 1}`,
                    stageId: slot.stageId,
                    bracketSlotId: slot.slotId,
                    team1PlayerIds: [],
                    team2PlayerIds: [],
                    result: { scoreA: 0, scoreB: 0, status: "not_started", winner: null },
                });
            });
            timeSlot++;
        }
    }

    if (thirdPlace && capacity >= 4) {
        rrSchedule.matches.push({
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
        tournamentId: rrSchedule.tournamentId,
        title: title || `Round Robin + Knockout (${pairs.length} Pairs)`,
        mode: "round_robin_knockout",
        numCourts,
        numRounds: timeSlot,
        players: rrSchedule.players,
        pairs: rrSchedule.pairs,
        groups: rrSchedule.groups,
        stages: [...rrSchedule.stages, ...koStages],
        matches: rrSchedule.matches,
        bracketSlots: koBracketSlots,
    };
}

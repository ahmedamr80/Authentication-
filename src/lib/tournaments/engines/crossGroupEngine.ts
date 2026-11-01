import { TournamentMatch, TournamentPair, TournamentParticipant } from "../types";
import { assignGroupsSnake } from "./roundRobinEngine";
import { BracketSlot, generateStandardBracketSeeds, getStageNameForCapacity } from "./knockoutEngine";

export interface CrossGroupEngineResult {
    tournamentId: string;
    title: string;
    mode: "group_vs_group";
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

/**
 * Group A vs Group B (Inter-Group / Cross-Group Round Robin + Optional Knockout) Engine.
 *
 * Specifically designed for odd-sized groups (e.g., 10 teams split into 5 in Group A and 5 in Group B on 5 courts):
 * - Every team in Group A plays against every team in Group B (K_{N_A, N_B} complete bipartite graph).
 * - When N_A === N_B === N and numCourts >= N (e.g., 5v5 on 5 courts), uses exact Cyclic Latin Square
 *   1-factorization so every round fills all N courts (100% court utilization) with 0 teams resting,
 *   and rotates courts evenly via (i + r) mod N.
 * - Teams accumulate standings points within their own group table (Group A and Group B).
 * - Supports Stage 2 Knockout advancement for Top 2 per group (Semifinals), Top 4 per group (Quarterfinals),
 *   Top 1 per group (Direct Final), or 0 (Group Stage only).
 */
export function solveCrossGroup(
    pairs: TournamentPair[],
    numCourts: number,
    cycles?: 1 | 2,
    qualifiersPerGroup?: number,
    thirdPlace?: boolean,
    title?: string
): CrossGroupEngineResult | null {
    if (!pairs || pairs.length < 2) return null;
    numCourts = Math.max(1, numCourts || 1);
    const resolvedCycles: 1 | 2 = cycles === 2 ? 2 : 1;
    const resolvedQualifiers =
        qualifiersPerGroup !== undefined && qualifiersPerGroup !== null
            ? Math.max(0, qualifiersPerGroup)
            : 2;

    // 1. Divide pairs into Group A and Group B (preserve preset groupId if valid, else snake-seed)
    const hasPresetGroups =
        pairs.some((p) => p.groupId === "Group A") && pairs.some((p) => p.groupId === "Group B");

    let groupDict: Record<string, TournamentPair[]>;
    if (hasPresetGroups) {
        groupDict = { "Group A": [], "Group B": [] };
        pairs.forEach((p, idx) => {
            if (p.groupId === "Group A" || p.groupId === "Group B") {
                groupDict[p.groupId].push(p);
            } else {
                const target = idx % 2 === 0 ? "Group A" : "Group B";
                p.groupId = target;
                groupDict[target].push(p);
            }
        });
    } else {
        groupDict = assignGroupsSnake(pairs, 2);
    }

    const groupA = groupDict["Group A"] || [];
    const groupB = groupDict["Group B"] || [];
    if (groupA.length === 0 || groupB.length === 0) return null;

    const groupList = [
        { groupId: "Group A", pairIds: groupA.map((p) => p.pairId) },
        { groupId: "Group B", pairIds: groupB.map((p) => p.pairId) },
    ];

    const players: TournamentParticipant[] = [];
    pairs.forEach((p) => {
        p.playerIds.forEach((pid, idx) => {
            const pName =
                p.playerNames && p.playerNames[idx]
                    ? p.playerNames[idx]
                    : p.pairName || `Team ${p.pairId}`;
            players.push({
                id: pid,
                name: pName,
                group: p.groupId || "Group A",
            });
        });
    });

    const scheduleMatches: TournamentMatch[] = [];
    let currentTimeSlot = 0;

    const nA = groupA.length;
    const nB = groupB.length;

    // 2. Stage 1: Cross-Group Match Scheduling (Group A vs Group B)
    if (nA === nB && numCourts >= nA) {
        // Exact Cyclic Latin Square (1-Factorization of K_{N,N}):
        // N rounds per cycle, N active courts per round, 0 resting teams per round, balanced court rotation.
        const N = nA;
        for (let cycle = 0; cycle < resolvedCycles; cycle++) {
            for (let r = 0; r < N; r++) {
                const roundMatches: Array<{ p1: TournamentPair; p2: TournamentPair; courtIdx: number }> = [];
                for (let i = 0; i < N; i++) {
                    const pairA = groupA[i];
                    const pairB = groupB[(i + r) % N];
                    // Orthogonal Latin Square court assignment when N is odd: (2 * i + r) % N
                    // ensures BOTH Group A and Group B teams rotate across all N courts!
                    const courtIdx = N % 2 === 1 ? (2 * i + r) % N : (i + r) % N;
                    roundMatches.push({
                        p1: cycle === 0 ? pairA : pairB,
                        p2: cycle === 0 ? pairB : pairA,
                        courtIdx,
                    });
                }
                roundMatches.sort((a, b) => a.courtIdx - b.courtIdx);

                roundMatches.forEach((mItem) => {
                    scheduleMatches.push({
                        matchId: `gvg_r${currentTimeSlot + 1}_c${mItem.courtIdx + 1}`,
                        roundIdx: currentTimeSlot,
                        courtIdx: mItem.courtIdx,
                        courtName: `Court ${mItem.courtIdx + 1}`,
                        stageId: "group",
                        pairAId: mItem.p1.pairId,
                        pairBId: mItem.p2.pairId,
                        team1PlayerIds: mItem.p1.playerIds,
                        team2PlayerIds: mItem.p2.playerIds,
                        team1Names: mItem.p1.playerNames,
                        team2Names: mItem.p2.playerNames,
                        team1Photos: mItem.p1.playerPhotos ? mItem.p1.playerPhotos.map((ph) => ph || null) : [],
                        team2Photos: mItem.p2.playerPhotos ? mItem.p2.playerPhotos.map((ph) => ph || null) : [],
                        result: {
                            scoreA: 0,
                            scoreB: 0,
                            status: "not_started",
                            winner: null,
                        },
                    });
                });
                currentTimeSlot++;
            }
        }
    } else {
        // General Bipartite Scheduler when group sizes differ or numCourts < N
        interface RequiredCrossMatch {
            p1: TournamentPair;
            p2: TournamentPair;
        }

        const reqMatches: RequiredCrossMatch[] = [];
        const maxN = Math.max(nA, nB);
        for (let cycle = 0; cycle < resolvedCycles; cycle++) {
            for (let r = 0; r < maxN; r++) {
                for (let i = 0; i < nA; i++) {
                    const j = (i + r) % maxN;
                    if (j < nB) {
                        const pairA = groupA[i];
                        const pairB = groupB[j];
                        reqMatches.push({
                            p1: cycle === 0 ? pairA : pairB,
                            p2: cycle === 0 ? pairB : pairA,
                        });
                    }
                }
            }
        }

        const M = reqMatches.length;
        const allPairIds = pairs.map((p) => p.pairId);
        const pairDegrees: Record<string, number> = {};
        allPairIds.forEach((id) => {
            pairDegrees[id] = 0;
        });
        reqMatches.forEach((m) => {
            pairDegrees[m.p1.pairId]++;
            pairDegrees[m.p2.pairId]++;
        });

        const maxDegree = Math.max(...Object.values(pairDegrees), 0);
        const maxSimul = Math.min(nA, nB);
        const K = Math.min(numCourts, Math.max(1, maxSimul));
        const R_ideal = Math.ceil(M / K);
        const R_min = Math.max(R_ideal, maxDegree);

        let solvedRounds: Array<Array<RequiredCrossMatch & { matchIdx: number; courtIdx: number }>> | null = null;

        for (let targetRounds = R_min; targetRounds <= R_min + 3; targetRounds++) {
            const rounds: Array<Array<RequiredCrossMatch & { matchIdx: number; courtIdx: number }>> = Array.from(
                { length: targetRounds },
                () => []
            );
            const pairMatchesRemaining = { ...pairDegrees };
            const pairPlayedInRound: Set<string>[] = Array.from({ length: targetRounds }, () => new Set());
            const matchScheduled = new Array(M).fill(false);
            const pairCourtCounts: Record<string, number[]> = {};
            allPairIds.forEach((id) => {
                pairCourtCounts[id] = new Array(K).fill(0);
            });

            function backtrack(roundIdx: number, courtIdx: number): boolean {
                if (roundIdx >= targetRounds) return matchScheduled.every((s) => s);
                const reqThisRound =
                    roundIdx < Math.floor(M / K)
                        ? K
                        : roundIdx === Math.floor(M / K) && M % K !== 0
                        ? M % K
                        : 0;
                if (courtIdx >= reqThisRound) return backtrack(roundIdx + 1, 0);

                const candidates: { m: number; score: number }[] = [];
                for (let m = 0; m < M; m++) {
                    if (matchScheduled[m]) continue;
                    const item = reqMatches[m];
                    const p1Id = item.p1.pairId;
                    const p2Id = item.p2.pairId;
                    if (pairPlayedInRound[roundIdx].has(p1Id) || pairPlayedInRound[roundIdx].has(p2Id)) continue;

                    let score = (pairMatchesRemaining[p1Id] + pairMatchesRemaining[p2Id]) * 10;
                    if (roundIdx > 0) {
                        if (!pairPlayedInRound[roundIdx - 1].has(p1Id)) score += 50;
                        if (!pairPlayedInRound[roundIdx - 1].has(p2Id)) score += 50;
                    }
                    score -= (pairCourtCounts[p1Id][courtIdx] + pairCourtCounts[p2Id][courtIdx]) * 5;
                    candidates.push({ m, score });
                }
                candidates.sort((a, b) => b.score - a.score);

                for (const cand of candidates) {
                    const m = cand.m;
                    const item = reqMatches[m];
                    const p1Id = item.p1.pairId;
                    const p2Id = item.p2.pairId;

                    matchScheduled[m] = true;
                    rounds[roundIdx].push({ ...item, matchIdx: m, courtIdx });
                    pairPlayedInRound[roundIdx].add(p1Id);
                    pairPlayedInRound[roundIdx].add(p2Id);
                    pairMatchesRemaining[p1Id]--;
                    pairMatchesRemaining[p2Id]--;
                    pairCourtCounts[p1Id][courtIdx]++;
                    pairCourtCounts[p2Id][courtIdx]++;

                    if (backtrack(roundIdx, courtIdx + 1)) return true;

                    matchScheduled[m] = false;
                    rounds[roundIdx].pop();
                    pairPlayedInRound[roundIdx].delete(p1Id);
                    pairPlayedInRound[roundIdx].delete(p2Id);
                    pairMatchesRemaining[p1Id]++;
                    pairMatchesRemaining[p2Id]++;
                    pairCourtCounts[p1Id][courtIdx]--;
                    pairCourtCounts[p2Id][courtIdx]--;
                }
                return false;
            }

            if (backtrack(0, 0)) {
                solvedRounds = rounds;
                break;
            }
        }

        if (!solvedRounds) {
            solvedRounds = [];
            const matchScheduled = new Array(M).fill(false);
            let rem = M;
            while (rem > 0) {
                const rList: Array<RequiredCrossMatch & { matchIdx: number; courtIdx: number }> = [];
                const usedPairs = new Set<string>();
                for (let c = 0; c < K; c++) {
                    let bestM = -1;
                    for (let m = 0; m < M; m++) {
                        if (matchScheduled[m]) continue;
                        const item = reqMatches[m];
                        if (!usedPairs.has(item.p1.pairId) && !usedPairs.has(item.p2.pairId)) {
                            bestM = m;
                            break;
                        }
                    }
                    if (bestM !== -1) {
                        matchScheduled[bestM] = true;
                        rem--;
                        const item = reqMatches[bestM];
                        usedPairs.add(item.p1.pairId);
                        usedPairs.add(item.p2.pairId);
                        rList.push({ ...item, matchIdx: bestM, courtIdx: c });
                    }
                }
                solvedRounds.push(rList);
            }
        }

        solvedRounds.forEach((rList, rIdx) => {
            rList.forEach((mItem) => {
                scheduleMatches.push({
                    matchId: `gvg_r${rIdx + 1}_c${mItem.courtIdx + 1}`,
                    roundIdx: rIdx,
                    courtIdx: mItem.courtIdx,
                    courtName: `Court ${mItem.courtIdx + 1}`,
                    stageId: "group",
                    pairAId: mItem.p1.pairId,
                    pairBId: mItem.p2.pairId,
                    team1PlayerIds: mItem.p1.playerIds,
                    team2PlayerIds: mItem.p2.playerIds,
                    team1Names: mItem.p1.playerNames,
                    team2Names: mItem.p2.playerNames,
                    team1Photos: mItem.p1.playerPhotos ? mItem.p1.playerPhotos.map((ph) => ph || null) : [],
                    team2Photos: mItem.p2.playerPhotos ? mItem.p2.playerPhotos.map((ph) => ph || null) : [],
                    result: {
                        scoreA: 0,
                        scoreB: 0,
                        status: "not_started",
                        winner: null,
                    },
                });
            });
            currentTimeSlot++;
        });
    }

    const stages: CrossGroupEngineResult["stages"] = [
        {
            stageId: "group",
            stageType: "group",
            stageOrder: 1,
            groupIds: ["Group A", "Group B"],
            status: "active",
        },
    ];

    const koBracketSlots: BracketSlot[] = [];

    // 3. Stage 2: Optional Knockout Stage (Copa Fácil Cross-Group Seeding)
    const maxPossibleQualifiers = Math.min(nA, nB);
    const effectiveQualifiers = Math.min(resolvedQualifiers, maxPossibleQualifiers);

    if (effectiveQualifiers > 0) {
        const totalQualifiers = 2 * effectiveQualifiers;
        let capacity = 1;
        while (capacity < totalQualifiers) capacity *= 2;
        const numKoRounds = Math.round(Math.log2(capacity));

        // Build Olympic cross-group seed map so Group A and Group B cross in Round 1
        // and Group winners/runners-up are placed in opposite bracket halves:
        // - capacity === 2 (Top 1 per group):
        //     Seed 1: 1st Group A vs Seed 2: 1st Group B
        // - capacity === 4 (Top 2 per group, round1Seeds = [1, 4, 2, 3]):
        //     SF 1 (1 vs 4): 1st Group A vs 2nd Group B
        //     SF 2 (2 vs 3): 1st Group B vs 2nd Group A
        // - capacity === 8 (Top 4 per group, round1Seeds = [1, 8, 4, 5, 2, 7, 3, 6]):
        //     QF 1 (1 vs 8): 1st Group A vs 4th Group B
        //     QF 2 (4 vs 5): 2nd Group B vs 3rd Group A
        //     QF 3 (2 vs 7): 1st Group B vs 4th Group A
        //     QF 4 (3 vs 6): 2nd Group A vs 3rd Group B
        const seedQualifierMap: Record<number, { groupId: string; rank: number }> = {};

        if (capacity === 8 && effectiveQualifiers === 4) {
            seedQualifierMap[1] = { groupId: "Group A", rank: 1 };
            seedQualifierMap[8] = { groupId: "Group B", rank: 4 };
            seedQualifierMap[4] = { groupId: "Group B", rank: 2 };
            seedQualifierMap[5] = { groupId: "Group A", rank: 3 };
            seedQualifierMap[2] = { groupId: "Group B", rank: 1 };
            seedQualifierMap[7] = { groupId: "Group A", rank: 4 };
            seedQualifierMap[3] = { groupId: "Group A", rank: 2 };
            seedQualifierMap[6] = { groupId: "Group B", rank: 3 };
        } else {
            seedQualifierMap[1] = { groupId: "Group A", rank: 1 };
            seedQualifierMap[2] = { groupId: "Group B", rank: 1 };

            if (effectiveQualifiers >= 2) {
                seedQualifierMap[capacity] = { groupId: "Group B", rank: 2 };
                seedQualifierMap[capacity - 1] = { groupId: "Group A", rank: 2 };
            }

            const assignedSeeds = new Set(Object.keys(seedQualifierMap).map(Number));
            const remainingSeeds: number[] = [];
            for (let s = 1; s <= totalQualifiers; s++) {
                if (!assignedSeeds.has(s)) remainingSeeds.push(s);
            }
            let remIdx = 0;
            const groupNames = ["Group A", "Group B"];
            for (let r = 3; r <= effectiveQualifiers; r++) {
                for (let gIdx = 0; gIdx < 2; gIdx++) {
                    if (remIdx < remainingSeeds.length) {
                        seedQualifierMap[remainingSeeds[remIdx]] = { groupId: groupNames[gIdx], rank: r };
                        remIdx++;
                    }
                }
            }
        }

        const round1Seeds = generateStandardBracketSeeds(capacity);
        const slotsByLevel: Record<number, BracketSlot[]> = {};

        let currentCap = capacity;
        for (let level = 0; level < numKoRounds; level++) {
            const stageName = getStageNameForCapacity(currentCap);
            stages.push({
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
                stages.push({
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

        const chunkSize = Math.max(1, numCourts);
        for (let level = 0; level < numKoRounds; level++) {
            const lSlots = slotsByLevel[level] || [];
            for (let i = 0; i < lSlots.length; i += chunkSize) {
                const chunk = lSlots.slice(i, i + chunkSize);
                chunk.forEach((slot, cIdx) => {
                    scheduleMatches.push({
                        matchId: slot.matchId,
                        roundIdx: currentTimeSlot,
                        courtIdx: cIdx,
                        courtName: `Court ${cIdx + 1}`,
                        stageId: slot.stageId,
                        bracketSlotId: slot.slotId,
                        team1PlayerIds: [],
                        team2PlayerIds: [],
                        result: { scoreA: 0, scoreB: 0, status: "not_started", winner: null },
                    });
                });
                currentTimeSlot++;
            }
        }

        if (thirdPlace && capacity >= 4) {
            scheduleMatches.push({
                matchId: "ko_slot_third_place_1",
                roundIdx: currentTimeSlot,
                courtIdx: 0,
                courtName: "Court 1",
                stageId: "third_place",
                bracketSlotId: "slot_third_place_1",
                team1PlayerIds: [],
                team2PlayerIds: [],
                result: { scoreA: 0, scoreB: 0, status: "not_started", winner: null },
            });
            currentTimeSlot++;
        }
    }

    return {
        tournamentId: Math.random().toString(36).substring(2, 10),
        title: title || `Group A vs Group B (${pairs.length} Teams, ${numCourts} Courts)`,
        mode: "group_vs_group",
        numCourts,
        numRounds: currentTimeSlot,
        players,
        pairs,
        groups: groupList,
        stages,
        matches: scheduleMatches,
        bracketSlots: koBracketSlots,
    };
}


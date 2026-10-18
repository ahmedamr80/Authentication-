import { TournamentMatch, TournamentPair, TournamentParticipant } from "../types";

export interface RoundRobinEngineResult {
    tournamentId: string;
    title: string;
    mode: "round_robin";
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
}

export function assignGroupsSnake(pairs: TournamentPair[], numGroups: number): Record<string, TournamentPair[]> {
    if (numGroups <= 1) {
        pairs.forEach((p) => (p.groupId = "Group A"));
        return { "Group A": [...pairs] };
    }
    const groupNames: string[] = [];
    for (let i = 0; i < numGroups; i++) groupNames.push(`Group ${String.fromCharCode(65 + i)}`);
    const groups: Record<string, TournamentPair[]> = {};
    groupNames.forEach((g) => (groups[g] = []));

    pairs.forEach((pair, idx) => {
        const cycle = 2 * numGroups;
        const pos = idx % cycle;
        const gIdx = pos < numGroups ? pos : cycle - 1 - pos;
        const assignedGroup = groupNames[gIdx];
        pair.groupId = assignedGroup;
        groups[assignedGroup].push(pair);
    });
    return groups;
}

export function solveRoundRobin(
    pairs: TournamentPair[],
    numCourts: number,
    numGroups?: number,
    cycles?: 1 | 2,
    title?: string
): RoundRobinEngineResult | null {
    if (!pairs || pairs.length < 2) return null;
    numCourts = Math.max(1, numCourts || 1);
    const resolvedNumGroups = Math.max(1, Math.min(numGroups || 1, Math.floor(pairs.length / 2)));
    const resolvedCycles = cycles === 2 ? 2 : 1;

    const groupDict = assignGroupsSnake(pairs, resolvedNumGroups);
    const groupList = Object.keys(groupDict).map((gid) => ({
        groupId: gid,
        pairIds: groupDict[gid].map((p) => p.pairId),
    }));

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
                group: p.groupId || "ALL",
            });
        });
    });

    // Optimal 8 Pairs, 4 Courts, 7 Rounds schedule
    if (pairs.length === 8 && numCourts === 4 && resolvedNumGroups === 1 && resolvedCycles === 1) {
        const matrix = [
            [[0, 6], [2, 4], [3, 7], [1, 5]],
            [[1, 3], [0, 7], [4, 6], [2, 5]],
            [[5, 7], [1, 4], [3, 6], [0, 2]],
            [[5, 6], [0, 3], [1, 2], [4, 7]],
            [[6, 7], [4, 5], [0, 1], [2, 3]],
            [[0, 4], [1, 7], [3, 5], [2, 6]],
            [[2, 7], [1, 6], [0, 5], [3, 4]],
        ];

        const scheduleMatches: TournamentMatch[] = [];
        matrix.forEach((round, rIdx) => {
            round.forEach((courtSlots, cIdx) => {
                const [p1Idx, p2Idx] = courtSlots;
                const p1 = pairs[p1Idx];
                const p2 = pairs[p2Idx];

                scheduleMatches.push({
                    matchId: `rr_group_1_r${rIdx + 1}_c${cIdx + 1}`,
                    roundIdx: rIdx,
                    courtIdx: cIdx,
                    courtName: `Court ${cIdx + 1}`,
                    stageId: "group",
                    team1PlayerIds: p1.playerIds,
                    team2PlayerIds: p2.playerIds,
                    team1Names: p1.playerNames,
                    team2Names: p2.playerNames,
                    team1Photos: p1.playerPhotos ? p1.playerPhotos.map((ph) => ph || null) : [],
                    team2Photos: p2.playerPhotos ? p2.playerPhotos.map((ph) => ph || null) : [],
                    result: {
                        scoreA: 0,
                        scoreB: 0,
                        status: "not_started",
                        winner: null,
                    },
                });
            });
        });

        const groupStage = {
            stageId: "group",
            stageType: "group",
            stageOrder: 1,
            groupIds: Object.keys(groupDict),
            status: "active",
        };

        return {
            tournamentId: Math.random().toString(36).substring(2, 10),
            title: title || `Round Robin (8 Pairs, 4 Courts)`,
            mode: "round_robin",
            numCourts: 4,
            numRounds: 7,
            players,
            pairs,
            groups: groupList,
            stages: [groupStage],
            matches: scheduleMatches,
        };
    }

    interface RequiredMatch {
        gid: string;
        p1: TournamentPair;
        p2: TournamentPair;
    }

    const reqMatches: RequiredMatch[] = [];
    Object.keys(groupDict).forEach((gid) => {
        const plist = groupDict[gid];
        for (let i = 0; i < plist.length; i++) {
            for (let j = i + 1; j < plist.length; j++) {
                reqMatches.push({ gid, p1: plist[i], p2: plist[j] });
            }
        }
        if (resolvedCycles === 2) {
            for (let i = 0; i < plist.length; i++) {
                for (let j = i + 1; j < plist.length; j++) {
                    reqMatches.push({ gid, p1: plist[j], p2: plist[i] });
                }
            }
        }
    });

    const M = reqMatches.length;
    const scheduleMatches: TournamentMatch[] = [];
    let currentTimeSlot = 0;

    if (M > 0) {
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

        const groupCounts: Record<string, Set<string>> = {};
        reqMatches.forEach((m) => {
            if (!groupCounts[m.gid]) groupCounts[m.gid] = new Set();
            groupCounts[m.gid].add(m.p1.pairId);
            groupCounts[m.gid].add(m.p2.pairId);
        });
        let maxSimul = 0;
        let groupRMin = 0;
        Object.keys(groupCounts).forEach((gid) => {
            const size = groupCounts[gid].size;
            const kg = Math.max(1, Math.floor(size / 2));
            maxSimul += kg;
            const mg = reqMatches.filter((m) => m.gid === gid).length;
            groupRMin = Math.max(groupRMin, Math.ceil(mg / kg));
        });

        const K = Math.min(numCourts, Math.max(1, maxSimul));
        const R_ideal = Math.ceil(M / K);
        const R_min = Math.max(R_ideal, maxDegree, groupRMin);

        let solvedRounds: Array<Array<RequiredMatch & { matchIdx: number; courtIdx: number }>> | null = null;
        for (let targetRounds = R_min; targetRounds <= R_min + 3; targetRounds++) {
            const rounds: Array<Array<RequiredMatch & { matchIdx: number; courtIdx: number }>> = Array.from(
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

        if (solvedRounds) {
            solvedRounds.forEach((roundMatches, roundIdx) => {
                roundMatches.forEach((item) => {
                    scheduleMatches.push({
                        matchId: `rr_${item.gid.replace(/\s+/g, "_").toLowerCase()}_r${roundIdx + 1}_c${item.courtIdx + 1}`,
                        roundIdx,
                        courtIdx: item.courtIdx,
                        courtName: `Court ${item.courtIdx + 1}`,
                        stageId: "group",
                        team1PlayerIds: item.p1.playerIds,
                        team2PlayerIds: item.p2.playerIds,
                        team1Names: item.p1.playerNames,
                        team2Names: item.p2.playerNames,
                        team1Photos: item.p1.playerPhotos ? item.p1.playerPhotos.map((ph) => ph || null) : [],
                        team2Photos: item.p2.playerPhotos ? item.p2.playerPhotos.map((ph) => ph || null) : [],
                        result: {
                            scoreA: 0,
                            scoreB: 0,
                            status: "not_started",
                            winner: null,
                        },
                    });
                });
            });
            currentTimeSlot = solvedRounds.length;
        } else {
            // Fallback simple scheduling if backtracking doesn't find a solution within range
            let matchIdx = 0;
            const roundsNeeded = Math.ceil(M / numCourts);
            for (let r = 0; r < roundsNeeded; r++) {
                for (let c = 0; c < numCourts && matchIdx < M; c++, matchIdx++) {
                    const item = reqMatches[matchIdx];
                    scheduleMatches.push({
                        matchId: `rr_${item.gid.replace(/\s+/g, "_").toLowerCase()}_r${r + 1}_c${c + 1}`,
                        roundIdx: r,
                        courtIdx: c,
                        courtName: `Court ${c + 1}`,
                        stageId: "group",
                        team1PlayerIds: item.p1.playerIds,
                        team2PlayerIds: item.p2.playerIds,
                        team1Names: item.p1.playerNames,
                        team2Names: item.p2.playerNames,
                        team1Photos: item.p1.playerPhotos ? item.p1.playerPhotos.map((ph) => ph || null) : [],
                        team2Photos: item.p2.playerPhotos ? item.p2.playerPhotos.map((ph) => ph || null) : [],
                        result: {
                            scoreA: 0,
                            scoreB: 0,
                            status: "not_started",
                            winner: null,
                        },
                    });
                }
            }
            currentTimeSlot = roundsNeeded;
        }
    }

    const groupStage = {
        stageId: "group",
        stageType: "group",
        stageOrder: 1,
        groupIds: Object.keys(groupDict),
        status: "active",
    };

    return {
        tournamentId: Math.random().toString(36).substring(2, 10),
        title: title || `Round Robin (${pairs.length} Pairs, ${numCourts} Courts)`,
        mode: "round_robin",
        numCourts,
        numRounds: Math.max(1, currentTimeSlot),
        players,
        pairs,
        groups: groupList,
        stages: [groupStage],
        matches: scheduleMatches,
    };
}

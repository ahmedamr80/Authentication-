/**
 * Court Rotation Balancing (post-processing).
 *
 * Permuting which match is played on which court *within the same round* never
 * changes partnerships or opponent confrontations. This module chooses, per round,
 * a court permutation such that:
 *
 *   1. Every player plays on each court floor(g/C) or ceil(g/C) times, where g is
 *      the number of matches that player plays and C the number of active courts.
 *   2. The maximum deviation |count - g/C| over all (player, court) is minimal.
 *   3. The number of consecutive rounds a player stays on the same court is minimal.
 *
 * Evaluated lexicographically: (bandViolation, maxDeviation, consecutiveRepeats).
 */

import { TournamentMatch } from "../types";

export type CourtPermutation = number[];

/**
 * Returns [bandViolation, maxDeviation, consecutiveRepeats]
 */
export function courtBalanceKey(
    rounds: number[][][], // rounds[r][tableIdx] = array of player indices
    perms: CourtPermutation[], // perms[r][tableIdx] = court index
    numPlayers: number,
    numCourts: number
): [number, number, number] {
    const counts: number[][] = Array.from({ length: numPlayers }, () => Array(numCourts).fill(0));
    const games: number[] = Array(numPlayers).fill(0);
    const lastCourt: number[] = Array(numPlayers).fill(-1);
    const lastRound: number[] = Array(numPlayers).fill(-2);
    let consecutive = 0;

    for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
        const tables = rounds[rIdx];
        const perm = perms[rIdx];
        for (let tIdx = 0; tIdx < tables.length; tIdx++) {
            const court = perm[tIdx];
            const players = tables[tIdx];
            for (const p of players) {
                if (p < 0 || p >= numPlayers) continue;
                counts[p][court]++;
                games[p]++;
                if (lastRound[p] === rIdx - 1 && lastCourt[p] === court) {
                    consecutive++;
                }
                lastCourt[p] = court;
                lastRound[p] = rIdx;
            }
        }
    }

    let violation = 0;
    let maxDev = 0;
    for (let p = 0; p < numPlayers; p++) {
        const g = games[p];
        if (g === 0) continue;
        const lo = Math.floor(g / numCourts);
        const hi = Math.ceil(g / numCourts);
        const target = g / numCourts;
        for (let c = 0; c < numCourts; c++) {
            const cnt = counts[p][c];
            if (cnt < lo) violation += lo - cnt;
            else if (cnt > hi) violation += cnt - hi;
            const dev = Math.abs(cnt - target);
            if (dev > maxDev) maxDev = dev;
        }
    }

    return [violation, maxDev, consecutive];
}

function compareKeys(a: [number, number, number], b: [number, number, number]): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (Math.abs(a[1] - b[1]) > 1e-6) return a[1] - b[1];
    return a[2] - b[2];
}

function getInjectivePermutations(tablesCount: number, courtsCount: number): number[][] {
    const results: number[][] = [];
    const used = new Array(courtsCount).fill(false);
    const current: number[] = [];

    function generate() {
        if (current.length === tablesCount) {
            results.push([...current]);
            return;
        }
        for (let c = 0; c < courtsCount; c++) {
            if (!used[c]) {
                used[c] = true;
                current.push(c);
                generate();
                current.pop();
                used[c] = false;
            }
        }
    }
    generate();
    return results;
}

/**
 * Chooses the optimal court permutation per round.
 */
export function balanceCourtAssignments(
    rounds: number[][][],
    numPlayers: number,
    numCourts: number
): CourtPermutation[] {
    const R = rounds.length;
    if (R === 0 || numCourts <= 1) {
        return rounds.map((tables) => tables.map((_, i) => i));
    }

    const options: number[][][] = rounds.map((tables) =>
        getInjectivePermutations(tables.length, numCourts)
    );

    let space = 1;
    for (let r = 1; r < R; r++) {
        space *= options[r].length;
        if (space > 4096) break;
    }

    let bestPerms: CourtPermutation[] = rounds.map((tables) => tables.map((_, i) => i));
    let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];

    if (space <= 4096) {
        // Exhaustive enumeration of small search space with round 0 fixed
        const first = options[0][0];
        const searchProduct = (rIdx: number, currentCombo: CourtPermutation[]) => {
            if (rIdx === R) {
                const key = courtBalanceKey(rounds, currentCombo, numPlayers, numCourts);
                if (compareKeys(key, bestKey) < 0) {
                    bestKey = key;
                    bestPerms = currentCombo.map((p) => [...p]);
                }
                return;
            }
            for (const opt of options[rIdx]) {
                currentCombo.push(opt);
                searchProduct(rIdx + 1, currentCombo);
                currentCombo.pop();
            }
        };
        searchProduct(1, [first]);
        return bestPerms;
    }

    // Coordinate descent / local search for large spaces
    const RESTARTS = 30;
    for (let restart = 0; restart < RESTARTS; restart++) {
        const perms: CourtPermutation[] = options.map((opt, rIdx) => {
            if (rIdx === 0 || restart === 0) return [...opt[0]];
            const randIdx = Math.floor(Math.random() * opt.length);
            return [...opt[randIdx]];
        });

        let currentKey = courtBalanceKey(rounds, perms, numPlayers, numCourts);
        let improved = true;
        while (improved) {
            improved = false;
            for (let r = 1; r < R; r++) {
                const curPerm = perms[r];
                for (const candidate of options[r]) {
                    perms[r] = candidate;
                    const newKey = courtBalanceKey(rounds, perms, numPlayers, numCourts);
                    if (compareKeys(newKey, currentKey) < 0) {
                        currentKey = newKey;
                        improved = true;
                    } else {
                        perms[r] = curPerm;
                    }
                }
            }
        }

        if (compareKeys(currentKey, bestKey) < 0) {
            bestKey = currentKey;
            bestPerms = perms.map((p) => [...p]);
        }
        if (bestKey[0] === 0 && bestKey[2] === 0) break;
    }

    return bestPerms;
}

/**
 * Applies court balancing to an existing list of matches.
 */
export function assignBalancedCourts(
    matches: TournamentMatch[],
    numCourts: number,
    totalPlayerCount?: number
): TournamentMatch[] {
    if (!matches || matches.length === 0 || numCourts <= 1) {
        return matches;
    }

    // Group matches by roundIdx
    const roundMap: Map<number, TournamentMatch[]> = new Map();
    let maxPlayerId = 0;

    matches.forEach((m) => {
        if (!roundMap.has(m.roundIdx)) roundMap.set(m.roundIdx, []);
        roundMap.get(m.roundIdx)!.push(m);

        [...m.team1PlayerIds, ...m.team2PlayerIds].forEach((id) => {
            const numId = typeof id === "number" ? id : parseInt(String(id).replace(/\D/g, ""), 10);
            if (!isNaN(numId) && numId > maxPlayerId) {
                maxPlayerId = numId;
            }
        });
    });

    const numPlayers = totalPlayerCount || maxPlayerId + 1;
    const sortedRounds = Array.from(roundMap.keys()).sort((a, b) => a - b);

    // Extract table player indices per round
    const roundsTables: number[][][] = sortedRounds.map((rIdx) => {
        const roundMatches = roundMap.get(rIdx)!;
        return roundMatches.map((m) => {
            return [...m.team1PlayerIds, ...m.team2PlayerIds].map((id) =>
                typeof id === "number" ? id : parseInt(String(id).replace(/\D/g, ""), 10) || 0
            );
        });
    });

    const perms = balanceCourtAssignments(roundsTables, numPlayers, numCourts);

    // Reassign courtIdx and courtName based on perms
    const balancedMatches: TournamentMatch[] = [];
    sortedRounds.forEach((rIdx, rSeq) => {
        const roundMatches = roundMap.get(rIdx)!;
        const perm = perms[rSeq];
        roundMatches.forEach((m, mIdx) => {
            const assignedCourt = perm && perm[mIdx] !== undefined ? perm[mIdx] : mIdx % numCourts;
            balancedMatches.push({
                ...m,
                courtIdx: assignedCourt,
                courtName: `Court ${assignedCourt + 1}`,
            });
        });
    });

    // Sort matches by roundIdx then courtIdx
    balancedMatches.sort((a, b) => a.roundIdx - b.roundIdx || a.courtIdx - b.courtIdx);
    return balancedMatches;
}

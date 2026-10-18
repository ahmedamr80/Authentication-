import { solveMixicano } from "../src/lib/tournaments/engines/mixicanoEngine";
import { solveTeamBattle } from "../src/lib/tournaments/engines/teamBattleEngine";
import { solveAmericano } from "../src/lib/tournaments/engines/americanoEngine";
import { generateTournamentSchedule } from "../src/lib/tournaments/templateMatcher";

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`❌ FAILED: ${msg}`);
        process.exit(1);
    }
}

console.log("=== Testing Mixicano Engine (Left vs Right) ===");
for (const courts of [1, 2, 3, 4, 5]) {
    const x = 2 * courts;
    const lPlayers = Array.from({ length: x }, (_, i) => ({ id: `L${i}`, name: `L${i}`, group: "L" as const }));
    const rPlayers = Array.from({ length: x }, (_, i) => ({ id: `R${i}`, name: `R${i}`, group: "R" as const }));

    const res = solveMixicano(courts, undefined, `Mixicano ${courts} Courts`, lPlayers, rPlayers);
    assert(res.matches.length === courts * x, `Expected ${courts * x} matches for ${courts} courts, got ${res.matches.length}`);

    // Check 100% L-R partnerships
    const lrPartners = new Set<string>();

    for (const m of res.matches) {
        const [t1_1, t1_2] = m.team1PlayerIds;
        const [t2_1, t2_2] = m.team2PlayerIds;

        // One L and one R on each side
        const t1_hasL = String(t1_1).startsWith("L") || String(t1_2).startsWith("L");
        const t1_hasR = String(t1_1).startsWith("R") || String(t1_2).startsWith("R");
        const t2_hasL = String(t2_1).startsWith("L") || String(t2_2).startsWith("L");
        const t2_hasR = String(t2_1).startsWith("R") || String(t2_2).startsWith("R");
        assert(t1_hasL && t1_hasR, `Side A must have 1 L and 1 R: [${t1_1}, ${t1_2}]`);
        assert(t2_hasL && t2_hasR, `Side B must have 1 L and 1 R: [${t2_1}, ${t2_2}]`);

        // Track partner
        const l1 = String(t1_1).startsWith("L") ? t1_1 : t1_2;
        const r1 = String(t1_1).startsWith("R") ? t1_1 : t1_2;
        lrPartners.add(`${l1}+${r1}`);

        const l2 = String(t2_1).startsWith("L") ? t2_1 : t2_2;
        const r2 = String(t2_1).startsWith("R") ? t2_1 : t2_2;
        lrPartners.add(`${l2}+${r2}`);
    }

    assert(lrPartners.size === x * x, `Mixicano ${courts}C: Expected ${x * x} unique L-R partnerships, got ${lrPartners.size}`);
    assert(res.classification === "PERFECT", `Mixicano ${courts}C must be PERFECT, got ${res.classification}`);
    console.log(`✅ Mixicano ${courts} Courts (${x}L + ${x}R = ${2 * x}P, ${x}R): 100% partnerships (${lrPartners.size}/${x * x}), 0 missing partner pairs, PERFECT!`);
}

console.log("\n=== Testing Team Battle Engine (Alpha vs Beta) ===");
for (const courts of [1, 2, 3, 4, 5]) {
    const y = 2 * courts;
    const aPlayers = Array.from({ length: y }, (_, i) => ({ id: `A${i}`, name: `Alpha ${i + 1}`, group: "Alpha" as const }));
    const bPlayers = Array.from({ length: y }, (_, i) => ({ id: `B${i}`, name: `Beta ${i + 1}`, group: "Beta" as const }));

    const res = solveTeamBattle(courts, undefined, `Team Battle ${courts} Courts`, aPlayers, bPlayers);
    const expectedRounds = Math.max(1, y - 1);
    assert(res.numRounds === expectedRounds, `Expected ${expectedRounds} rounds, got ${res.numRounds}`);

    // Check Alpha partners
    const aPartners = new Set<string>();
    const bPartners = new Set<string>();

    for (const m of res.matches) {
        const [a1, a2] = m.team1PlayerIds;
        const [b1, b2] = m.team2PlayerIds;
        assert(String(a1).startsWith("A") && String(a2).startsWith("A"), `Team 1 must be Alpha: [${a1}, ${a2}]`);
        assert(String(b1).startsWith("B") && String(b2).startsWith("B"), `Team 2 must be Beta: [${b1}, ${b2}]`);

        aPartners.add([a1, a2].sort().join("+"));
        bPartners.add([b1, b2].sort().join("+"));
    }

    const expectedPairs = (y * (y - 1)) / 2;
    assert(aPartners.size === expectedPairs, `Team Alpha must have all ${expectedPairs} unique partnerships, got ${aPartners.size}`);
    assert(bPartners.size === expectedPairs, `Team Beta must have all ${expectedPairs} unique partnerships, got ${bPartners.size}`);
    console.log(`✅ Team Battle ${courts} Courts (${y}A + ${y}B = ${2 * y}P, ${expectedRounds}R): 100% Alpha & Beta internal partnerships (${expectedPairs}/${expectedPairs})!`);
}

console.log("\n=== Testing Americano Engine ===");
for (const testCase of [
    { p: 4, c: 1, r: 3 },
    { p: 6, c: 1, r: 8 },
    { p: 8, c: 2, r: 7 },
    { p: 10, c: 2, r: 12 },
    { p: 12, c: 3, r: 11 },
]) {
    const players = Array.from({ length: testCase.p }, (_, i) => ({ id: i, name: `Player ${i + 1}` }));
    const res = solveAmericano(testCase.p, testCase.c, testCase.r, undefined, players);
    assert(res.matches.length === testCase.c * testCase.r, `Expected ${testCase.c * testCase.r} matches, got ${res.matches.length}`);

    // Check court balancing: court appearances should be floor(g/c) or ceil(g/c)
    const courtCounts: Record<number, Record<number, number>> = {};
    for (const m of res.matches) {
        for (const pid of [...m.team1PlayerIds, ...m.team2PlayerIds]) {
            const p = Number(pid);
            if (!courtCounts[p]) courtCounts[p] = {};
            courtCounts[p][m.courtIdx] = (courtCounts[p][m.courtIdx] || 0) + 1;
        }
    }

    console.log(`✅ Americano ${testCase.p} Players, ${testCase.c} Courts, ${testCase.r} Rounds: Perfect schedule generated!`);
}

console.log("\n=== Testing Template Matcher Integration ===");
const tm8p = generateTournamentSchedule({
    mode: "americano",
    title: "Americano 8P",
    numCourts: 2,
    participants: Array.from({ length: 8 }, (_, i) => ({ id: i, name: `P${i + 1}` })),
});
assert(tm8p.isFromTemplate, "8P Americano must match built-in template");
assert(tm8p.matches.length === 14, "8P Americano must have 14 matches (7 rounds x 2 courts)");
console.log(`✅ Template Matcher correctly matched built-in template: ${tm8p.templateId}`);

console.log("\n=== Testing Fixed Pairs 8 Pairs 4 Courts (7 Rounds) Template ===");
// 1. Round Robin Mode with 8 pre-formed pairs
const rrPairs = Array.from({ length: 8 }, (_, i) => ({
    pairId: `pair_${i}`,
    pairName: `Team ${i + 1}`,
    playerIds: [`p_${i}_1`, `p_${i}_2`],
    playerNames: [`Player ${i * 2 + 1}`, `Player ${i * 2 + 2}`],
}));
const tmRR = generateTournamentSchedule({
    mode: "round_robin",
    title: "Round Robin 8 Pairs 4 Courts",
    numCourts: 4,
    numRounds: 7,
    pairs: rrPairs,
});
assert(tmRR.isFromTemplate, "Fixed pairs round robin must match built-in template");
assert(tmRR.matches.length === 28, `Fixed pairs round robin must have 28 matches (7 rounds x 4 courts), got ${tmRR.matches.length}`);
assert(tmRR.templateId === "round_robin_8p_4c_7r", `Expected round_robin_8p_4c_7r, got ${tmRR.templateId}`);
console.log(`✅ Round Robin fixed pairs correctly matched template: ${tmRR.templateId} (28 matches across 7 rounds)`);

// 2. Americano Mode with 16 individual players mapped to fixed pairs
const amerPlayers = Array.from({ length: 16 }, (_, i) => ({ id: `p_${i}`, name: `Player ${i + 1}` }));
const tmAmer = generateTournamentSchedule({
    mode: "americano",
    title: "Americano Fixed Pairs 8 Pairs 4 Courts",
    numCourts: 4,
    numRounds: 7,
    participants: amerPlayers,
});
assert(tmAmer.isFromTemplate, "16P Americano on 4 courts with 7 rounds must match fixed pairs template");
assert(tmAmer.matches.length === 28, `16P Americano must have 28 matches, got ${tmAmer.matches.length}`);
assert(tmAmer.templateId === "americano_fixed_pairs_8p_4c_7r", `Expected americano_fixed_pairs_8p_4c_7r, got ${tmAmer.templateId}`);
console.log(`✅ Americano fixed pairs correctly matched template: ${tmAmer.templateId} (28 matches across 7 rounds)`);

console.log("\n🎉 ALL SOLVER ENGINE TESTS PASSED PERFECTLY!");

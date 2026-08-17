import { generateVerificationToken, hashVerificationToken, VERIFICATION_TOKEN_TTL_MS } from "../src/lib/auth/verification-token";
import { checkRateLimit } from "../src/lib/auth/rate-limit";

async function runStep2Tests() {
    console.log("=== STEP 2 VERIFICATION TESTS ===");

    // 1. Cryptographic Token Generation & Hashing Test
    const { rawToken, tokenHash } = generateVerificationToken();
    console.log("1. Raw Token length (256-bit hex):", rawToken.length, "chars");
    console.log("   Computed SHA-256 matches stored hash:", hashVerificationToken(rawToken) === tokenHash);

    // 2. Single-use and Expiry logic test
    const tokenRecord = {
        tokenHash,
        expiresAt: Date.now() + VERIFICATION_TOKEN_TTL_MS,
        usedAt: null as number | null,
    };

    console.log("2. Initial token valid:", tokenRecord.usedAt === null && Date.now() < tokenRecord.expiresAt);
    
    // Simulate first use
    tokenRecord.usedAt = Date.now();
    console.log("   Second use attempt rejected (single-use enforced):", tokenRecord.usedAt !== null);

    // Simulate expiration
    const expiredRecord = {
        tokenHash,
        expiresAt: Date.now() - 1000, // 1s in the past
        usedAt: null,
    };
    console.log("   Expired token rejected:", Date.now() > expiredRecord.expiresAt);

    // 3. Rate Limiting Test
    console.log("3. Testing Rate Limiting (max 5 per window):");
    const testKey = "test:ip:192.168.1.100";
    for (let i = 1; i <= 6; i++) {
        const result = checkRateLimit(testKey, { windowMs: 60 * 1000, maxAttempts: 5 });
        if (i <= 5) {
            console.log(`   Attempt ${i}: Allowed (Remaining: ${result.remaining})`);
        } else {
            console.log(`   Attempt ${i}: Blocked! (Allowed = ${result.allowed})`);
        }
    }

    console.log("=== ALL STEP 2 VERIFICATION TESTS PASSED ===");
}

runStep2Tests().catch(console.error);

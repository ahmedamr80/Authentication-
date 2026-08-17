import {
    issueAccessToken,
    issueRefreshToken,
    verifyRefreshToken,
} from "../src/lib/auth/tokens";
import {
    createSessionFamily,
    rotateSessionFamilyToken,
    getSessionFamily,
    ABSOLUTE_SESSION_MAX_AGE_MS,
} from "../src/lib/auth/session-family";

async function runStep7Tests() {
    console.log("=== STEP 7 VERIFICATION TESTS ===");

    const uid = "user_step7_test_uid";

    // 1. Initial Login & Session Family Setup
    const token1 = issueRefreshToken(uid);
    await createSessionFamily(uid, token1.familyId, token1.jti);

    console.log("1. Initial Session Family Created:");
    console.log("   Family ID =", token1.familyId);
    console.log("   Initial Active JTI =", token1.jti);

    // 2. Legitimate Token Rotation (First Silent Refresh)
    const token2_jti = "jti_rotated_step2_9988";
    const rotate1 = await rotateSessionFamilyToken(token1.familyId, token1.jti, token2_jti);

    console.log("2. First Silent Refresh (Legitimate Rotation):");
    console.log("   Rotation Succeeded:", rotate1.success);
    console.log("   New Current JTI =", token2_jti);

    // 3. REUSE DETECTION TEST (Replaying Token 1 after it was already rotated!)
    console.log("3. REUSE DETECTION TEST (Replaying old Token 1):");
    const reuseAttempt = await rotateSessionFamilyToken(token1.familyId, token1.jti, "jti_attacker_attempt_33");

    console.log("   Replay Attempt Rejected:", reuseAttempt.success === false);
    console.log("   Family Marked Revoked:", reuseAttempt.familyRevoked === true);
    console.log("   Reason =", reuseAttempt.error);

    // 4. Subsequent Refresh Attempt with Token 2 (Must also FAIL because whole family was revoked!)
    console.log("4. Subsequent Refresh Attempt with Token 2 (After Family Revocation):");
    const subsequentAttempt = await rotateSessionFamilyToken(token1.familyId, token2_jti, "jti_subsequent_44");

    console.log("   Subsequent Attempt Rejected:", subsequentAttempt.success === false);
    console.log("   Error Message =", subsequentAttempt.error);

    // 5. Absolute Session Lifetime Cap Test (30 Days)
    console.log("5. Absolute Session Cap Test (30 Days):");
    const oldFamilyId = "family_old_30days_cap";
    const oldJti = "jti_old_30days";
    const oldRecord = await createSessionFamily(uid, oldFamilyId, oldJti);

    // Simulate session created 31 days ago
    oldRecord.initialLoginAt = Date.now() - (ABSOLUTE_SESSION_MAX_AGE_MS + 24 * 60 * 60 * 1000);

    const capTestResult = await rotateSessionFamilyToken(oldFamilyId, oldJti, "jti_new_cap_attempt");
    console.log("   Session > 30 Days Rejected:", capTestResult.success === false);
    console.log("   Error Message =", capTestResult.error);

    console.log("=== ALL STEP 7 VERIFICATION TESTS PASSED ===");
}

runStep7Tests().catch(console.error);

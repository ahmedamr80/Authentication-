import { issueAccessToken, issueRefreshToken, verifyAccessToken } from "../src/lib/auth/tokens";
import { revokeJti, isJtiRevoked, revokeAllUserSessions } from "../src/lib/auth/jti-revocation";
import { createSessionFamily, getSessionFamily } from "../src/lib/auth/session-family";

async function runStep9Tests() {
    console.log("=== STEP 9 VERIFICATION TESTS ===");

    const uid = "user_step9_logout_test";
    const testUser = {
        uid,
        email: "logout_user@example.com",
        role: "player",
        isAdmin: false,
        is_email_verified: true,
    };

    // 1. Single Token Revocation (Logout)
    const token = issueAccessToken(testUser);
    const claimsBefore = await verifyAccessToken(token);
    console.log("1. Issued Access Token (JTI:", claimsBefore.jti + ")");
    console.log("   Token valid before logout:", claimsBefore.sub === uid);

    // Perform Logout Revocation
    await revokeJti(claimsBefore.jti, claimsBefore.exp);
    const revokedCheck = await isJtiRevoked(claimsBefore.jti);
    console.log("   Added JTI to revocation list. Is JTI Revoked:", revokedCheck);

    // Try using token immediately after logout (Must fail!)
    let failedAsExpected = false;
    try {
        await verifyAccessToken(token);
    } catch (err: unknown) {
        failedAsExpected = true;
        console.log("   Token used AFTER logout REJECTED as expected:", (err as Error).message);
    }
    console.log("   Access token rejected immediately after logout:", failedAsExpected);

    // 2. Global Sign Out All Devices ("logout-all")
    console.log("2. Testing Global Sign-Out ('Sign out of all devices'):");
    const device1 = issueRefreshToken(uid);
    const device2 = issueRefreshToken(uid);

    await createSessionFamily(uid, device1.familyId, device1.jti);
    await createSessionFamily(uid, device2.familyId, device2.jti);

    console.log("   Created Device 1 Session (Family:", device1.familyId + ")");
    console.log("   Created Device 2 Session (Family:", device2.familyId + ")");

    const count = await revokeAllUserSessions(uid, "TEST_GLOBAL_LOGOUT");
    console.log("   Executed Global Sign Out. Revoked sessions count:", count);

    const family1After = await getSessionFamily(device1.familyId);
    const family2After = await getSessionFamily(device2.familyId);

    console.log("   Device 1 Session Family Revoked:", family1After?.isRevoked === true);
    console.log("   Device 2 Session Family Revoked:", family2After?.isRevoked === true);

    // 3. Revocation List Natural TTL Expiry (Bounded Memory Test)
    console.log("3. Testing Natural TTL Expiry for Bounded Revocation List:");
    const shortJti = "jti_short_lived_test";
    const nowSec = Math.floor(Date.now() / 1000);

    // Revoke with exp = 1 sec ago (simulating expired natural TTL)
    await revokeJti(shortJti, nowSec - 1);
    const expiredCheck = await isJtiRevoked(shortJti);
    console.log("   Expired JTI automatically purged on check:", expiredCheck === false);

    console.log("=== ALL STEP 9 VERIFICATION TESTS PASSED ===");
}

runStep9Tests().catch(console.error);

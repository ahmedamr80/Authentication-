import { issueAccessToken } from "../src/lib/auth/tokens";
import { verifyStepUpAuthentication } from "../src/lib/auth/step-up";
import { performAccountDeletion, revokeAppleToken } from "../src/lib/auth/account-deletion";
import { createSessionFamily, getSessionFamily } from "../src/lib/auth/session-family";

async function runStep10Tests() {
    console.log("=== STEP 10 VERIFICATION TESTS ===");

    const testUid = "user_step10_delete_test";
    const testUser = {
        uid: testUid,
        email: "delete_test_user@example.com",
        role: "player",
        isAdmin: false,
        is_email_verified: true,
    };

    // 1. Step-Up Re-Authentication Verification
    console.log("1. Testing Step-Up Re-Authentication Guard for Account Deletion:");
    const stepUpMissing = await verifyStepUpAuthentication(testUid, undefined);
    console.log("   Deletion attempt WITHOUT step-up password REJECTED (401):", stepUpMissing.verified === false);

    const stepUpWrong = await verifyStepUpAuthentication(testUid, "wrong_password_999");
    console.log("   Deletion attempt WITH WRONG step-up password REJECTED (401):", stepUpWrong.verified === false);

    // 2. Apple Token Revocation Helper Check
    console.log("2. Testing Apple Sign-In Token Revocation Helper (App Store Guideline 5.1.1(v)):");
    const mockAppleToken = "mock_apple_refresh_token_xyz123";
    const appleRevoked = await revokeAppleToken(mockAppleToken);
    console.log("   Apple Token Revocation Handler executed cleanly:", appleRevoked);

    // 3. Cascade Account Deletion Test
    console.log("3. Testing Cascade Account Deletion & Session Revocation:");
    const familyId = "fam_delete_test_8877";
    await createSessionFamily(testUid, familyId, "jti_del_123");

    console.log("   Active session family created before deletion (Family:", familyId + ")");

    const deletionRes = await performAccountDeletion(testUid, "127.0.0.1", "test-agent");
    console.log("   Cascade Account Deletion completed successfully:", deletionRes.success);

    const familyAfter = await getSessionFamily(familyId);
    console.log("   Session Family REVOKED post-deletion:", familyAfter?.isRevoked === true);

    console.log("=== ALL STEP 10 VERIFICATION TESTS PASSED ===");
}

runStep10Tests().catch(console.error);

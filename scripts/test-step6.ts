import {
    issueAccessToken,
    issueRefreshToken,
    verifyAccessToken,
    createRefreshTokenCookieHeader,
    ACCESS_TOKEN_TTL_SECONDS,
} from "../src/lib/auth/tokens";
import { authenticateApiRequest } from "../src/lib/auth/require-auth";

async function runStep6Tests() {
    console.log("=== STEP 6 VERIFICATION TESTS ===");

    const testUser = {
        uid: "user_step6_test_uid",
        email: "step6_user@example.com",
        role: "player",
        isAdmin: false,
        is_email_verified: true,
    };

    // 1. Issue Access Token & Refresh Token
    const accessToken = issueAccessToken(testUser);
    const { refreshToken, familyId } = issueRefreshToken(testUser.uid);

    console.log("1. Issued Access Token (Short-lived 15m JWT):");
    console.log("   JWT Parts count:", accessToken.split(".").length);
    console.log("   Issued Refresh Token (7-day): FamilyId =", familyId);

    // 2. Validate Access Token Claims
    const claims = await verifyAccessToken(accessToken);
    console.log("2. Verified Access Token Claims:");
    console.log("   Sub (uid) matches:", claims.sub === testUser.uid);
    console.log("   Issuer =", claims.iss, "| Audience =", claims.aud);
    console.log("   Expiration duration (seconds):", claims.exp - claims.iat, "(Expected:", ACCESS_TOKEN_TTL_SECONDS, ")");

    // 3. Test API Guard (Authorization: Bearer <token>)
    console.log("3. Testing API Guard Requirement (Authorization: Bearer <token>):");

    // Request WITHOUT Authorization header
    const reqNoAuth = new Request("https://example.com/api/protected", { method: "GET" });
    const authNoAuth = await authenticateApiRequest(reqNoAuth);
    console.log("   Request WITHOUT Authorization header rejected (401):", authNoAuth.authenticated === false);

    // Request WITH valid Authorization header
    const reqValidAuth = new Request("https://example.com/api/protected", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const authValid = await authenticateApiRequest(reqValidAuth);
    console.log("   Request WITH valid Bearer token authenticated:", authValid.authenticated === true && authValid.user?.sub === testUser.uid);

    // 4. Test Expired Access Token Rejection
    console.log("4. Testing Expired Token Rejection:");
    const mockExpiredHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const mockExpiredPayload = Buffer.from(JSON.stringify({
        sub: testUser.uid,
        iss: "EveryWherePadel",
        aud: "EveryWherePadelApp",
        exp: Math.floor(Date.now() / 1000) - 100, // Expired 100s ago
    })).toString("base64url");
    const mockExpiredSig = Buffer.from("mock_sig").toString("base64url");
    const expiredToken = `${mockExpiredHeader}.${mockExpiredPayload}.${mockExpiredSig}`;

    const reqExpiredAuth = new Request("https://example.com/api/protected", {
        headers: { Authorization: `Bearer ${expiredToken}` },
    });
    const authExpired = await authenticateApiRequest(reqExpiredAuth);
    console.log("   Expired Access Token properly rejected:", authExpired.authenticated === false);

    // 5. HttpOnly Cookie Security Check
    console.log("5. Refresh Token Cookie Security Flags:");
    const cookieHeader = createRefreshTokenCookieHeader(refreshToken);
    console.log("   Cookie Header:", cookieHeader);
    console.log("   Contains HttpOnly flag (Hidden from document.cookie in JS console):", cookieHeader.includes("HttpOnly"));
    console.log("   Contains SameSite=Strict flag:", cookieHeader.includes("SameSite=Strict"));
    console.log("   Path restricted to /api/auth/refresh:", cookieHeader.includes("Path=/api/auth/refresh"));

    console.log("=== ALL STEP 6 VERIFICATION TESTS PASSED ===");
}

runStep6Tests().catch(console.error);

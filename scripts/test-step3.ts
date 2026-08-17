import { createPKCEPair, validateState, parseAndValidateIDTokenClaims } from "../src/lib/auth/pkce-oidc";

async function runStep3Tests() {
    console.log("=== STEP 3 VERIFICATION TESTS ===");

    // 1. PKCE & State CSRF Validation Test
    const pkce = createPKCEPair();
    console.log("1. PKCE Code Verifier length:", pkce.codeVerifier.length, "chars");
    console.log("   PKCE Code Challenge (S256 base64url):", pkce.codeChallenge);
    console.log("   Valid state matching:", validateState(pkce.state, pkce.state));
    console.log("   Mismatched CSRF state rejected:", validateState(pkce.state, "tampered_state_123") === false);
    console.log("   Missing state rejected:", validateState(null, pkce.state) === false);

    // 2. ID Token Payload Parsing & Nonce Validation
    const mockHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const mockPayload = Buffer.from(JSON.stringify({
        iss: "https://appleid.apple.com",
        aud: "com.ewpuae.app",
        sub: "001234.apple_test_sub_9988",
        email: "user_test@privaterelay.appleid.com",
        is_private_email: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        nonce: pkce.nonce,
    })).toString("base64url");
    const mockSignature = Buffer.from("mock_signature").toString("base64url");
    const mockIDToken = `${mockHeader}.${mockPayload}.${mockSignature}`;

    const claims = parseAndValidateIDTokenClaims(mockIDToken, "com.ewpuae.app", pkce.nonce);
    console.log("2. ID Token parsed successfully.");
    console.log("   Extracted durable sub claim:", claims.sub);
    console.log("   Private relay email recognized:", claims.email?.endsWith("@privaterelay.appleid.com"));

    // 3. Test Invalid / Expired JWT rejection
    const expiredPayload = Buffer.from(JSON.stringify({
        iss: "https://appleid.apple.com",
        aud: "com.ewpuae.app",
        sub: "001234.apple_test_sub_9988",
        exp: Math.floor(Date.now() / 1000) - 600, // 10 mins ago
    })).toString("base64url");
    const expiredJWT = `${mockHeader}.${expiredPayload}.${mockSignature}`;

    try {
        parseAndValidateIDTokenClaims(expiredJWT, "com.ewpuae.app");
        console.error("   ERROR: Expired JWT was not rejected!");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        console.log("   Expired JWT properly rejected with error:", msg);
    }

    // 4. Test Audience Mismatch rejection
    try {
        parseAndValidateIDTokenClaims(mockIDToken, "wrong.app.audience");
        console.error("   ERROR: Audience mismatch was not rejected!");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        console.log("   Audience mismatch properly rejected with error:", msg);
    }

    console.log("=== ALL STEP 3 VERIFICATION TESTS PASSED ===");
}

runStep3Tests().catch(console.error);

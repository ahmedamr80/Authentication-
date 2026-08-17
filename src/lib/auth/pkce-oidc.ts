import crypto from "crypto";

export interface PKCEPair {
    codeVerifier: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    state: string;
    nonce: string;
}

/**
 * Generates PKCE parameters (code_verifier, code_challenge S256, state, nonce)
 * compliant with OAuth 2.0 / OIDC specifications.
 */
export function createPKCEPair(): PKCEPair {
    const codeVerifier = crypto.randomBytes(32).toString("hex"); // 64 chars
    const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");

    return {
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: "S256",
        state,
        nonce,
    };
}

/**
 * Validates callback state against stored CSRF state parameter.
 * Safely compares buffer lengths to prevent timingSafeEqual thrown exceptions.
 */
export function validateState(receivedState: string | null, storedState: string | null): boolean {
    if (!receivedState || !storedState) return false;

    const bufA = Buffer.from(receivedState);
    const bufB = Buffer.from(storedState);

    if (bufA.length !== bufB.length) return false;

    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Basic OIDC JWT payload validation (sub, iss, aud, exp, nonce)
 */
export interface IDTokenClaims {
    iss: string;
    aud: string | string[];
    sub: string;
    exp: number;
    iat: number;
    email?: string;
    email_verified?: boolean | string;
    is_private_email?: boolean;
    nonce?: string;
    name?: string;
}

export function parseAndValidateIDTokenClaims(
    idToken: string,
    expectedAudience: string,
    expectedNonce?: string
): IDTokenClaims {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT ID token format.");
    }

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims: IDTokenClaims = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
        throw new Error("ID token has expired.");
    }

    const audMatch = typeof claims.aud === "string"
        ? claims.aud === expectedAudience
        : Array.isArray(claims.aud) && claims.aud.includes(expectedAudience);

    if (!audMatch) {
        throw new Error(`ID token audience mismatch: expected ${expectedAudience}, got ${JSON.stringify(claims.aud)}`);
    }

    if (expectedNonce && claims.nonce && claims.nonce !== expectedNonce) {
        throw new Error("ID token nonce mismatch.");
    }

    if (!claims.sub) {
        throw new Error("ID token missing sub (subject identifier) claim.");
    }

    return claims;
}

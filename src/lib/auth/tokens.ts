import crypto from "crypto";
import { isJtiRevoked } from "./jti-revocation";

export interface AccessTokenPayload {
    sub: string; // User ID (uid)
    email: string;
    role: string;
    isAdmin: boolean;
    isEmailVerified: boolean;
    iss: string;
    aud: string;
    jti: string;
    iat: number;
    exp: number;
}

export interface RefreshTokenPayload {
    sub: string;
    tokenFamilyId: string;
    jti: string;
    iss: string;
    iat: number;
    exp: number;
}

const JWT_ISSUER = "EveryWherePadel";
const JWT_AUDIENCE = "EveryWherePadelApp";

const _accessSecret = process.env.ACCESS_TOKEN_SECRET;
const _refreshSecret = process.env.REFRESH_TOKEN_SECRET;

if (!_accessSecret || !_refreshSecret) {
    throw new Error(
        "[FATAL] Missing required environment variables: ACCESS_TOKEN_SECRET and/or REFRESH_TOKEN_SECRET. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
}

const ACCESS_SECRET: string = _accessSecret;
const REFRESH_SECRET: string = _refreshSecret;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function base64UrlEncode(str: string | Buffer): string {
    return Buffer.from(str)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
        base64 += "=";
    }
    return Buffer.from(base64, "base64").toString("utf8");
}

function signHS256(headerAndPayload: string, secret: string): string {
    return crypto
        .createHmac("sha256", secret)
        .update(headerAndPayload)
        .digest("base64url");
}

/**
 * Issues a short-lived (15-min) signed JWT Access Token.
 */
export function issueAccessToken(user: { uid: string; email: string; role?: string; isAdmin?: boolean; is_email_verified?: boolean }): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadData: AccessTokenPayload = {
        sub: user.uid,
        email: user.email,
        role: user.role || "player",
        isAdmin: !!user.isAdmin,
        isEmailVerified: !!user.is_email_verified,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        jti: crypto.randomBytes(16).toString("hex"),
        iat: now,
        exp: now + ACCESS_TOKEN_TTL_SECONDS,
    };

    const payload = base64UrlEncode(JSON.stringify(payloadData));
    const signature = signHS256(`${header}.${payload}`, ACCESS_SECRET);
    return `${header}.${payload}.${signature}`;
}

/**
 * Issues a long-lived (7-day) signed JWT Refresh Token.
 */
export function issueRefreshToken(uid: string, tokenFamilyId?: string): { refreshToken: string; familyId: string; jti: string } {
    const now = Math.floor(Date.now() / 1000);
    const familyId = tokenFamilyId || crypto.randomBytes(16).toString("hex");
    const jti = crypto.randomBytes(16).toString("hex");

    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadData: RefreshTokenPayload = {
        sub: uid,
        tokenFamilyId: familyId,
        jti,
        iss: JWT_ISSUER,
        iat: now,
        exp: now + REFRESH_TOKEN_TTL_SECONDS,
    };

    const payload = base64UrlEncode(JSON.stringify(payloadData));
    const signature = signHS256(`${header}.${payload}`, REFRESH_SECRET);
    const refreshToken = `${header}.${payload}.${signature}`;

    return { refreshToken, familyId, jti };
}

/**
 * Validates and decodes a short-lived Access Token.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT token format.");
    }

    const expectedSig = signHS256(`${parts[0]}.${parts[1]}`, ACCESS_SECRET);
    if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expectedSig))) {
        throw new Error("Access token signature validation failed.");
    }

    const payload: AccessTokenPayload = JSON.parse(base64UrlDecode(parts[1]));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
        throw new Error("Access token has expired.");
    }

    if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) {
        throw new Error("Access token issuer or audience mismatch.");
    }

    const revoked = await isJtiRevoked(payload.jti);
    if (revoked) {
        throw new Error("Access token has been revoked (logged out).");
    }

    return payload;
}

/**
 * Validates and decodes a long-lived Refresh Token.
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid refresh token format.");
    }

    const expectedSig = signHS256(`${parts[0]}.${parts[1]}`, REFRESH_SECRET);
    if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expectedSig))) {
        throw new Error("Refresh token signature validation failed.");
    }

    const payload: RefreshTokenPayload = JSON.parse(base64UrlDecode(parts[1]));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
        throw new Error("Refresh token has expired.");
    }

    return payload;
}

/**
 * Generates Set-Cookie header string for HttpOnly, Secure, SameSite=Strict refresh cookie.
 */
export function createRefreshTokenCookieHeader(refreshToken: string): string {
    const isProduction = process.env.NODE_ENV === "production";
    // In production with HTTPS, use __Host- prefix for strict origin isolation
    const cookieName = isProduction ? "__Host-refreshtoken" : "refreshtoken";
    const secureFlag = isProduction ? "Secure; " : "";

    return `${cookieName}=${refreshToken}; ${secureFlag}HttpOnly; SameSite=Strict; Path=/api/auth/refresh; Max-Age=${REFRESH_TOKEN_TTL_SECONDS}`;
}

/**
 * Generates cookie clearance header string for logout / revocation.
 */
export function createClearRefreshTokenCookieHeader(): string {
    const isProduction = process.env.NODE_ENV === "production";
    const cookieName = isProduction ? "__Host-refreshtoken" : "refreshtoken";
    const secureFlag = isProduction ? "Secure; " : "";

    return `${cookieName}=; ${secureFlag}HttpOnly; SameSite=Strict; Path=/api/auth/refresh; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

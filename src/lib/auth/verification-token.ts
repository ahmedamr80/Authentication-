import crypto from "crypto";

export interface VerificationTokenRecord {
    tokenHash: string;
    uid: string;
    email: string;
    expiresAt: number; // Epoch milliseconds
    usedAt: number | null; // Epoch milliseconds when token was used, or null
    createdAt: number;
}

export const VERIFICATION_TOKEN_TTL_MS = 20 * 60 * 1000; // 20 minutes expiration

/**
 * Generates a cryptographically secure 256-bit (32-byte) verification token.
 * Returns:
 * - rawToken: The raw unhashed secret to be sent in the verification email link.
 * - tokenHash: The SHA-256 hash of rawToken to be saved in the database.
 */
export function generateVerificationToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashVerificationToken(rawToken);
    return { rawToken, tokenHash };
}

/**
 * Calculates the SHA-256 hash of a raw verification token string.
 */
export function hashVerificationToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
}

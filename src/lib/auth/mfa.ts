import crypto from "crypto";
import { getAdminFirestore } from "@/lib/firebase-admin";

export interface BackupCodeRecord {
    codeHash: string;
    usedAt: number | null; // epoch ms or null
}

export interface PendingMFATokenPayload {
    uid: string;
    email: string;
    exp: number;
    nonce: string;
}

const _pendingMfaSecret = process.env.MFA_JWT_SECRET;

if (!_pendingMfaSecret) {
    throw new Error(
        "[FATAL] Missing required environment variable: MFA_JWT_SECRET. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
}

const PENDING_MFA_SECRET: string = _pendingMfaSecret;

// Base32 alphabet for TOTP secrets
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Generates a random 16-character Base32 secret for TOTP.
 */
export function generateTOTPSecret(): string {
    const bytes = crypto.randomBytes(10);
    let secret = "";
    for (let i = 0; i < bytes.length; i++) {
        secret += BASE32_ALPHABET[bytes[i] % 32];
    }
    return secret;
}

/**
 * Decodes a Base32 string into a Buffer.
 */
function base32Decode(base32: string): Buffer {
    const cleaned = base32.toUpperCase().replace(/=+$/, "");
    const bits: number[] = [];

    for (let i = 0; i < cleaned.length; i++) {
        const val = BASE32_ALPHABET.indexOf(cleaned[i]);
        if (val === -1) continue;
        for (let b = 4; b >= 0; b--) {
            bits.push((val >> b) & 1);
        }
    }

    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
            byte = (byte << 1) | bits[i + b];
        }
        bytes.push(byte);
    }

    return Buffer.from(bytes);
}

/**
 * Computes RFC 6238 TOTP 6-digit token for a secret and timestamp counter.
 */
export function generateTOTPCode(secretBase32: string, timeMs: number = Date.now()): string {
    const key = base32Decode(secretBase32);
    const counter = Math.floor(timeMs / 1000 / 30);

    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(counter), 0);

    const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    const otp = (code % 1000000).toString().padStart(6, "0");
    return otp;
}

/**
 * Validates a 6-digit TOTP code against a secret with a ±1 time step window (30s grace).
 */
export function verifyTOTPCode(secretBase32: string, token: string, timeMs: number = Date.now()): boolean {
    if (!token || token.length !== 6) return false;

    // Check t-1, t, t+1 windows for clock skew tolerance
    for (let delta = -1; delta <= 1; delta++) {
        const checkTime = timeMs + delta * 30 * 1000;
        const validCode = generateTOTPCode(secretBase32, checkTime);
        if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(validCode))) {
            return true;
        }
    }

    return false;
}

/**
 * Generates a batch of 8 single-use high-entropy backup/recovery codes.
 * Returns raw codes (to display to user ONCE) and SHA-256 hashed records for database storage.
 */
export function generateBackupCodes(count: number = 8): { rawCodes: string[]; hashedRecords: BackupCodeRecord[] } {
    const rawCodes: string[] = [];
    const hashedRecords: BackupCodeRecord[] = [];

    for (let i = 0; i < count; i++) {
        // High-entropy 8-character code format: XXXX-XXXX
        const part1 = crypto.randomBytes(2).toString("hex").toUpperCase();
        const part2 = crypto.randomBytes(2).toString("hex").toUpperCase();
        const rawCode = `${part1}-${part2}`;
        const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");

        rawCodes.push(rawCode);
        hashedRecords.push({ codeHash, usedAt: null });
    }

    return { rawCodes, hashedRecords };
}

/**
 * Verifies a single-use backup code against stored hashed records for a user.
 */
export async function verifyAndConsumeBackupCode(uid: string, rawCode: string): Promise<boolean> {
    const normalizedCode = rawCode.trim().toUpperCase();
    const targetHash = crypto.createHash("sha256").update(normalizedCode).digest("hex");

    const adminDb = getAdminFirestore();
    const userDocRef = adminDb.collection("users").doc(uid);
    const userSnap = await userDocRef.get();

    if (!userSnap.exists) return false;

    const userData = userSnap.data();
    const backupCodes: BackupCodeRecord[] = userData?.backup_codes || [];

    const matchIndex = backupCodes.findIndex(
        (rec) => rec.codeHash === targetHash && rec.usedAt === null
    );

    if (matchIndex === -1) {
        return false; // Code not found or ALREADY USED!
    }

    // Mark code as used (single-use enforcement)
    backupCodes[matchIndex].usedAt = Date.now();
    await userDocRef.update({ backup_codes: backupCodes });

    return true;
}

/**
 * Creates a signed, ephemeral (5 min) "MFA pending" token for partial session gating.
 */
export function createPendingMFAToken(uid: string, email: string): string {
    const exp = Date.now() + 5 * 60 * 1000; // 5 minutes TTL
    const nonce = crypto.randomBytes(16).toString("hex");
    const payload: PendingMFATokenPayload = { uid, email, exp, nonce };

    const dataStr = JSON.stringify(payload);
    const signature = crypto
        .createHmac("sha256", PENDING_MFA_SECRET)
        .update(dataStr)
        .digest("base64url");

    return `${Buffer.from(dataStr).toString("base64url")}.${signature}`;
}

/**
 * Validates an ephemeral "MFA pending" token.
 */
export function verifyPendingMFAToken(pendingToken: string): PendingMFATokenPayload | null {
    try {
        const parts = pendingToken.split(".");
        if (parts.length !== 2) return null;

        const dataStr = Buffer.from(parts[0], "base64url").toString("utf8");
        const expectedSig = crypto
            .createHmac("sha256", PENDING_MFA_SECRET)
            .update(dataStr)
            .digest("base64url");

        if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig))) {
            return null;
        }

        const payload: PendingMFATokenPayload = JSON.parse(dataStr);
        if (Date.now() > payload.exp) {
            return null; // Expired
        }

        return payload;
    } catch {
        return null;
    }
}

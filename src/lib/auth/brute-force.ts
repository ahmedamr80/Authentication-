import { getAdminFirestore } from "@/lib/firebase-admin";

export interface BruteForceStatus {
    allowed: boolean;
    requireCaptcha: boolean;
    lockedOut: boolean;
    remainingLockoutMs: number;
    failedAttemptsCount: number;
    reason?: string;
}

interface AttemptRecord {
    count: number;
    firstAttemptAt: number;
    lastAttemptAt: number;
    lockoutUntil: number | null;
}

const CAPTCHA_THRESHOLD = 3;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout
const WINDOW_DURATION_MS = 15 * 60 * 1000; // 15 minutes sliding window

// In-memory write-through cache (fast path)
const attemptStore = new Map<string, AttemptRecord>();

// --- Firestore-backed persistence layer ---

function encodeKey(key: string): string {
    // Firestore doc IDs cannot contain '/' so we encode the key
    return encodeURIComponent(key);
}

async function loadRecord(key: string): Promise<AttemptRecord | null> {
    // Check in-memory cache first
    if (attemptStore.has(key)) return attemptStore.get(key)!;

    try {
        const db = getAdminFirestore();
        const doc = await db.collection("brute_force_attempts").doc(encodeKey(key)).get();
        if (doc.exists) {
            const record = doc.data() as AttemptRecord;
            attemptStore.set(key, record);
            return record;
        }
    } catch (err) {
        console.error("Error loading brute-force record from Firestore:", err);
    }
    return null;
}

async function saveRecord(key: string, record: AttemptRecord): Promise<void> {
    attemptStore.set(key, record);
    try {
        const db = getAdminFirestore();
        await db.collection("brute_force_attempts").doc(encodeKey(key)).set(record);
    } catch (err) {
        console.error("Error saving brute-force record to Firestore:", err);
    }
}

async function deleteRecord(key: string): Promise<void> {
    attemptStore.delete(key);
    try {
        const db = getAdminFirestore();
        await db.collection("brute_force_attempts").doc(encodeKey(key)).delete();
    } catch (err) {
        console.error("Error deleting brute-force record from Firestore:", err);
    }
}

/**
 * Checks brute-force state for an IP address or email key.
 */
async function getRecordStatus(key: string): Promise<{ count: number; lockedOut: boolean; remainingLockoutMs: number }> {
    const now = Date.now();
    const record = await loadRecord(key);

    if (!record) {
        return { count: 0, lockedOut: false, remainingLockoutMs: 0 };
    }

    if (record.lockoutUntil && now < record.lockoutUntil) {
        return {
            count: record.count,
            lockedOut: true,
            remainingLockoutMs: record.lockoutUntil - now,
        };
    }

    // Reset if lockout expired or window passed
    const isLockoutExpired = !record.lockoutUntil || now >= record.lockoutUntil;
    const isWindowExpired = now - record.lastAttemptAt > WINDOW_DURATION_MS;

    if (isLockoutExpired && isWindowExpired) {
        await deleteRecord(key);
        return { count: 0, lockedOut: false, remainingLockoutMs: 0 };
    }

    if (record.lockoutUntil && now >= record.lockoutUntil) {
        await deleteRecord(key);
        return { count: 0, lockedOut: false, remainingLockoutMs: 0 };
    }

    return { count: record.count, lockedOut: false, remainingLockoutMs: 0 };
}

/**
 * Evaluates combined brute-force status for both IP address and Account Email.
 */
export async function checkBruteForceStatus(ip: string, email: string): Promise<BruteForceStatus> {
    const ipKey = `bf:ip:${ip}`;
    const emailKey = `bf:email:${email.trim().toLowerCase()}`;

    const ipStatus = await getRecordStatus(ipKey);
    const emailStatus = await getRecordStatus(emailKey);

    const isLockedOut = ipStatus.lockedOut || emailStatus.lockedOut;
    const remainingLockoutMs = Math.max(ipStatus.remainingLockoutMs, emailStatus.remainingLockoutMs);
    const maxFailedAttempts = Math.max(ipStatus.count, emailStatus.count);

    if (isLockedOut) {
        const minutes = Math.ceil(remainingLockoutMs / (60 * 1000));
        return {
            allowed: false,
            requireCaptcha: true,
            lockedOut: true,
            remainingLockoutMs,
            failedAttemptsCount: maxFailedAttempts,
            reason: `Too many failed login attempts. Temporarily locked out for ${minutes} minute(s).`,
        };
    }

    const requireCaptcha = maxFailedAttempts >= CAPTCHA_THRESHOLD;

    return {
        allowed: true,
        requireCaptcha,
        lockedOut: false,
        remainingLockoutMs: 0,
        failedAttemptsCount: maxFailedAttempts,
    };
}

/**
 * Records a failed sign-in attempt for an IP address and Email account.
 * Updates attempt counter and triggers temporary lockout if threshold (5) is exceeded.
 */
export async function recordFailedAttempt(ip: string, email: string): Promise<BruteForceStatus> {
    const now = Date.now();
    const keys = [`bf:ip:${ip}`, `bf:email:${email.trim().toLowerCase()}`];

    for (const key of keys) {
        const existing = await loadRecord(key);
        const record: AttemptRecord = existing || {
            count: 0,
            firstAttemptAt: now,
            lastAttemptAt: now,
            lockoutUntil: null,
        };

        record.count += 1;
        record.lastAttemptAt = now;

        if (record.count >= LOCKOUT_THRESHOLD) {
            record.lockoutUntil = now + LOCKOUT_DURATION_MS;
        }

        await saveRecord(key, record);
    }

    return checkBruteForceStatus(ip, email);
}

/**
 * Resets failed sign-in attempt counters upon successful authentication.
 */
export async function resetFailedAttempts(ip: string, email: string): Promise<void> {
    await deleteRecord(`bf:ip:${ip}`);
    await deleteRecord(`bf:email:${email.trim().toLowerCase()}`);
}

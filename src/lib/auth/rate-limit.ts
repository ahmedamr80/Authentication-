export interface RateLimitOptions {
    windowMs: number; // Duration of window in ms (e.g., 60,000 for 1 minute)
    maxAttempts: number; // Max requests allowed per window
}

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

const globalRateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Periodically purge stale entries from memory
 */
function cleanupStore() {
    const now = Date.now();
    for (const [key, entry] of globalRateLimitStore.entries()) {
        if (now > entry.resetTime) {
            globalRateLimitStore.delete(key);
        }
    }
}

/**
 * Checks sliding window rate limit for a given key (e.g. `ip:127.0.0.1` or `email:user@test.com`).
 */
export function checkRateLimit(
    key: string,
    options: RateLimitOptions = { windowMs: 60 * 1000, maxAttempts: 5 }
): { allowed: boolean; remaining: number; resetTime: number } {
    cleanupStore();

    const now = Date.now();
    const entry = globalRateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
        const resetTime = now + options.windowMs;
        globalRateLimitStore.set(key, { count: 1, resetTime });
        return { allowed: true, remaining: options.maxAttempts - 1, resetTime };
    }

    if (entry.count >= options.maxAttempts) {
        return { allowed: false, remaining: 0, resetTime: entry.resetTime };
    }

    entry.count += 1;
    return { allowed: true, remaining: options.maxAttempts - entry.count, resetTime: entry.resetTime };
}

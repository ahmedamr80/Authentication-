import crypto from "crypto";

export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validates a password against security policies:
 * 1. Minimum length requirement (>= 12 characters)
 * 2. HaveIBeenPwned k-Anonymity breach check
 */
export async function validatePasswordSecurity(password: string): Promise<PasswordValidationResult> {
    if (!password || typeof password !== "string") {
        return { valid: false, error: "Password is required." };
    }

    // 1. Enforce minimum length (12 characters)
    if (password.length < MIN_PASSWORD_LENGTH) {
        return {
            valid: false,
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
        };
    }

    // 2. Check HaveIBeenPwned k-Anonymity breach list
    try {
        const isBreached = await checkPasswordBreached(password);
        if (isBreached) {
            return {
                valid: false,
                error: "This password has appeared in a data breach and is unsafe. Please choose a different password."
            };
        }
    } catch (err) {
        console.error("Error during password breach check:", err);
        // Fail open if breach check service error occurs to avoid completely blocking signup
    }

    return { valid: true };
}

/**
 * Performs k-Anonymity check against HaveIBeenPwned Pwned Passwords API.
 * Never sends the actual password or full hash. Sends only 5-character SHA-1 prefix.
 */
export async function checkPasswordBreached(password: string): Promise<boolean> {
    const sha1Hash = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1Hash.slice(0, 5);
    const suffix = sha1Hash.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: {
            "User-Agent": "EveryWherePadel-Auth-Security",
        },
        cache: "no-store",
    });

    if (!response.ok) {
        console.warn(`HaveIBeenPwned API returned status ${response.status}`);
        return false;
    }

    const body = await response.text();
    const lines = body.split("\n");

    for (const line of lines) {
        const [hashSuffix, countStr] = line.trim().split(":");
        if (hashSuffix === suffix) {
            const count = parseInt(countStr, 10);
            if (count > 0) {
                return true;
            }
        }
    }

    return false;
}

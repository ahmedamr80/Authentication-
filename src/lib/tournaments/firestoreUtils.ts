/**
 * Recursively cleans any object or array so it can be safely stored in Firestore via setDoc/updateDoc.
 * - Removes keys with `undefined` values from objects.
 * - Converts `undefined` values in arrays to `null` to preserve indices and prevent Firestore errors.
 * - Leaves Firestore FieldValues (serverTimestamp, deleteField, etc.), Timestamps, and Dates intact.
 */
export function cleanForFirestore<T>(data: T): T {
    if (data === undefined) {
        return null as any;
    }
    if (data === null || typeof data !== "object") {
        return data;
    }

    // Preserve JavaScript Dates
    if (data instanceof Date) {
        return data;
    }

    // Preserve Firestore FieldValues and Timestamps
    if (
        (data as any)._methodName !== undefined ||
        (data as any)._delegate !== undefined ||
        typeof (data as any).toMillis === "function" ||
        (typeof (data as any).isEqual === "function" && "seconds" in (data as any)) ||
        (data.constructor && (data.constructor.name === "FieldValue" || data.constructor.name === "Timestamp"))
    ) {
        return data;
    }

    // Clean Arrays: convert undefined to null to maintain array shape
    if (Array.isArray(data)) {
        return data.map((item) => (item === undefined ? null : cleanForFirestore(item))) as any;
    }

    // Clean Objects: omit keys whose value is undefined
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) {
            cleaned[key] = cleanForFirestore(val);
        }
    }
    return cleaned as any;
}

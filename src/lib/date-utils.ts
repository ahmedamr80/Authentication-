/**
 * Safely parses various representations of a date/timestamp field from Firebase
 * into a standard Javascript Date object, preventing crashes from deserialized types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseFirebaseDate(dateField: any): Date | null {
    if (!dateField) return null;
    
    // 1. If it has a .toDate method (Firestore Timestamp object)
    if (typeof dateField.toDate === "function") {
        return dateField.toDate();
    }
    
    // 2. If it is already a JS Date object
    if (dateField instanceof Date) {
        return dateField;
    }
    
    // 3. Handle plain serialized objects with seconds (e.g. from offline cache or admin SDK)
    if (typeof dateField === "object") {
        const seconds = dateField.seconds ?? dateField._seconds;
        if (typeof seconds === "number") {
            return new Date(seconds * 1000);
        }
    }
    
    // 4. Handle ISO strings or string representations
    if (typeof dateField === "string") {
        const parsed = new Date(dateField);
        if (!isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    
    // 5. Handle millisecond timestamps (numbers)
    if (typeof dateField === "number") {
        return new Date(dateField);
    }
    
    return null;
}

/**
 * Safely extracts time in milliseconds from any timestamp-like value
 * (Firestore Timestamp, JS Date, string, number, or object with seconds).
 * Returns 0 if invalid or null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTimestampMillis(dateField: any): number {
    if (!dateField) return 0;
    if (typeof dateField.toMillis === "function") {
        return dateField.toMillis();
    }
    const date = parseFirebaseDate(dateField);
    return date ? date.getTime() : 0;
}

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

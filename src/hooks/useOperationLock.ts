import { useRef, useCallback } from "react";

/**
 * Hook that prevents double-submission of async operations.
 * Wraps a promise-returning function with a lock that prevents concurrent execution.
 * 
 * Usage:
 *   const { isLocked, withLock } = useOperationLock();
 *   const handleSubmit = () => withLock(async () => { ... });
 */
export function useOperationLock() {
    const lockRef = useRef(false);

    const withLock = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
        if (lockRef.current) return null;
        lockRef.current = true;
        try {
            return await fn();
        } finally {
            lockRef.current = false;
        }
    }, []);

    return { isLocked: lockRef, withLock };
}

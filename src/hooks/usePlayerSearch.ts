"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface PlayerSearchResult {
    uid: string;
    displayName: string;
    fullName?: string;
    email: string;
    photoURL?: string;
    photoUrl?: string;
    skillLevel?: string;
    level?: string;
    position?: string;
    hand?: string;
    redflagged?: boolean;
    redflagReason?: string;
    isEligible: boolean;
    ineligibilityReason?: string;
}

export interface UsePlayerSearchOptions {
    eventId?: string;
    currentUserId?: string;
    excludeUids?: string[];
    debounceMs?: number;
    limitCount?: number;
    cacheTtlMs?: number;
}

// In-memory cache for player directory to minimize Firestore reads
interface CacheEntry {
    users: PlayerSearchResult[];
    timestamp: number;
}

let globalUsersCache: CacheEntry | null = null;
const DEFAULT_CACHE_TTL = 60 * 1000; // 60 seconds
const EMPTY_EXCLUDE_UIDS: string[] = [];

// Cache for committed registrations per event
const globalCommittedCache = new Map<string, { ids: Set<string>; timestamp: number }>();

export function usePlayerSearch(options: UsePlayerSearchOptions = {}) {
    const {
        eventId,
        currentUserId,
        excludeUids: rawExcludeUids,
        debounceMs = 250,
        limitCount = 10,
        cacheTtlMs = DEFAULT_CACHE_TTL,
    } = options;

    const excludeUidsKey = rawExcludeUids && rawExcludeUids.length > 0
        ? rawExcludeUids.slice().sort().join(",")
        : "";
    const excludeUids = useMemo(() => {
        return rawExcludeUids || EMPTY_EXCLUDE_UIDS;
    }, [excludeUidsKey]);

    const [queryText, setQueryText] = useState("");
    const [results, setResults] = useState<PlayerSearchResult[]>([]);
    const [totalMatches, setTotalMatches] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Sequence tracker to discard outdated asynchronous query results
    const querySeqRef = useRef(0);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Helper: Fetch or get cached users list
    const getUsers = useCallback(async (): Promise<PlayerSearchResult[]> => {
        const now = Date.now();
        if (globalUsersCache && now - globalUsersCache.timestamp < cacheTtlMs) {
            return globalUsersCache.users;
        }

        const usersRef = collection(db, "users");
        const snapshot = await getDocs(usersRef);

        const users: PlayerSearchResult[] = snapshot.docs.map((d) => {
            const data = d.data();
            const fullName = (data.fullName || data.displayName || "").trim();
            const displayName = fullName || data.email || "Unknown Player";

            return {
                uid: d.id,
                displayName,
                fullName,
                email: data.email || "",
                photoURL: data.photoUrl || data.photoURL || "",
                photoUrl: data.photoUrl || data.photoURL || "",
                skillLevel: data.skillLevel || data.level || "",
                level: data.skillLevel || data.level || "",
                position: data.position || "",
                hand: data.hand || "",
                redflagged: !!data.redflagged,
                redflagReason: data.redflagReason || "",
                isEligible: true,
            };
        });

        globalUsersCache = {
            users,
            timestamp: now,
        };

        return users;
    }, [cacheTtlMs]);

    // Helper: Fetch or get cached committed user IDs for event
    const getCommittedUserIds = useCallback(
        async (targetEventId: string): Promise<Set<string>> => {
            const now = Date.now();
            const cached = globalCommittedCache.get(targetEventId);
            if (cached && now - cached.timestamp < cacheTtlMs) {
                return cached.ids;
            }

            try {
                const regsRef = collection(db, "registrations");
                const regsQ = query(regsRef, where("eventId", "==", targetEventId));
                const regsSnapshot = await getDocs(regsQ);

                const committedIds = new Set<string>();
                regsSnapshot.docs.forEach((docSnap) => {
                    const regData = docSnap.data();
                    if (
                        (regData.status === "CONFIRMED" || regData.status === "WAITLIST") &&
                        !regData.lookingForPartner
                    ) {
                        if (regData.playerId) committedIds.add(regData.playerId);
                        if (regData.player2Id) committedIds.add(regData.player2Id);
                    }
                });

                globalCommittedCache.set(targetEventId, {
                    ids: committedIds,
                    timestamp: now,
                });

                return committedIds;
            } catch (err) {
                console.warn("Failed to fetch event registrations for commitment check:", err);
                return new Set<string>();
            }
        },
        [cacheTtlMs]
    );

    // Search executor
    const executeSearch = useCallback(
        async (rawQuery: string, currentSeq: number) => {
            const cleanedQuery = rawQuery.trim().replace(/\s+/g, " ");

            // Minimum 2 characters requirement
            if (cleanedQuery.length < 2) {
                if (currentSeq === querySeqRef.current) {
                    setResults([]);
                    setTotalMatches(0);
                    setLoading(false);
                    setError(null);
                }
                return;
            }

            setLoading(true);
            setError(null);

            try {
                // Fetch players and committed list in parallel
                const [allUsers, committedSet] = await Promise.all([
                    getUsers(),
                    eventId ? getCommittedUserIds(eventId) : Promise.resolve(new Set<string>()),
                ]);

                // Check if this query is still the latest one
                if (currentSeq !== querySeqRef.current) {
                    return;
                }

                // Split query into terms to support partial first name, last name, etc.
                const queryTerms = cleanedQuery.toLowerCase().split(" ").filter(Boolean);

                const matched: PlayerSearchResult[] = [];

                for (const player of allUsers) {
                    const nameLower = (player.fullName || player.displayName || "").toLowerCase();
                    const emailLower = (player.email || "").toLowerCase();

                    // Every token in query must be present in name or email
                    const isMatch = queryTerms.every(
                        (term) => nameLower.includes(term) || emailLower.includes(term)
                    );

                    if (!isMatch) continue;

                    // Evaluate eligibility preserving existing rules
                    let isEligible = true;
                    let ineligibilityReason: string | undefined;

                    if (currentUserId && player.uid === currentUserId) {
                        isEligible = false;
                        ineligibilityReason = "Cannot invite yourself";
                    } else if (player.redflagged) {
                        isEligible = false;
                        ineligibilityReason = player.redflagReason || "Red-flagged player";
                    } else if (committedSet.has(player.uid)) {
                        isEligible = false;
                        ineligibilityReason = "Already registered in this event";
                    } else if (excludeUids.includes(player.uid)) {
                        isEligible = false;
                        ineligibilityReason = "Not eligible";
                    }

                    matched.push({
                        ...player,
                        isEligible,
                        ineligibilityReason,
                    });
                }

                // Rank results:
                // 1. Starts with full query
                // 2. Any word starts with full query
                // 3. Eligible players before ineligible
                const fullLower = cleanedQuery.toLowerCase();
                matched.sort((a, b) => {
                    // Eligible first
                    if (a.isEligible && !b.isEligible) return -1;
                    if (!a.isEligible && b.isEligible) return 1;

                    const aName = (a.fullName || a.displayName).toLowerCase();
                    const bName = (b.fullName || b.displayName).toLowerCase();

                    const aStarts = aName.startsWith(fullLower);
                    const bStarts = bName.startsWith(fullLower);
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;

                    const aWordStarts = aName.split(" ").some((w) => w.startsWith(fullLower));
                    const bWordStarts = bName.split(" ").some((w) => w.startsWith(fullLower));
                    if (aWordStarts && !bWordStarts) return -1;
                    if (!aWordStarts && bWordStarts) return 1;

                    return aName.localeCompare(bName);
                });

                if (currentSeq === querySeqRef.current) {
                    setTotalMatches(matched.length);
                    setResults(matched.slice(0, limitCount));
                    setLoading(false);
                }
            } catch (err) {
                if (currentSeq === querySeqRef.current) {
                    console.error("Autocomplete search error:", err);
                    setError(err instanceof Error ? err.message : "Search failed");
                    setLoading(false);
                }
            }
        },
        [currentUserId, eventId, excludeUids, getCommittedUserIds, getUsers, limitCount]
    );

    const executeSearchRef = useRef(executeSearch);
    useEffect(() => {
        executeSearchRef.current = executeSearch;
    }, [executeSearch]);

    // Trigger search with debounce
    useEffect(() => {
        const nextSeq = ++querySeqRef.current;

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        const trimmed = queryText.trim();
        if (trimmed.length < 2) {
            setResults((prev) => (prev.length === 0 ? prev : []));
            setTotalMatches((prev) => (prev === 0 ? prev : 0));
            setLoading((prev) => (prev ? false : false));
            return;
        }

        // Show immediate loading indicator while debouncing
        setLoading(true);

        debounceTimerRef.current = setTimeout(() => {
            executeSearchRef.current(queryText, nextSeq);
        }, debounceMs);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [queryText, debounceMs]);

    const clearSearch = useCallback(() => {
        querySeqRef.current++;
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        setQueryText("");
        setResults([]);
        setTotalMatches(0);
        setLoading(false);
        setError(null);
    }, []);

    return {
        query: queryText,
        setQuery: setQueryText,
        results,
        totalMatches,
        loading,
        error,
        clearSearch,
    };
}

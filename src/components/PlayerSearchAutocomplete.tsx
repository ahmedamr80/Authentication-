"use client";

import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { Search, X, Loader2, Info, AlertCircle, CheckCircle2, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { usePlayerSearch, PlayerSearchResult } from "@/hooks/usePlayerSearch";

export interface PlayerSearchAutocompleteProps {
    eventId?: string;
    currentUserId?: string;
    excludeUids?: string[];
    onSelectPlayer: (player: PlayerSearchResult) => void | Promise<void>;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    className?: string;
    theme?: "dark" | "light" | "auto";
    actionLabel?: string;
    isSubmitting?: boolean;
}

// Highlight matching tokens within name or string
function HighlightMatch({ text, query }: { text: string; query: string }) {
    if (!text) return null;
    const trimmed = query.trim();
    if (!trimmed) return <span>{text}</span>;

    const terms = trimmed
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    if (terms.length === 0) return <span>{text}</span>;

    const regex = new RegExp(`(${terms.join("|")})`, "gi");
    const parts = text.split(regex);
    const testRegex = new RegExp(`^(${terms.join("|")})$`, "i");

    return (
        <span className="truncate">
            {parts.map((part, i) =>
                testRegex.test(part) ? (
                    <mark
                        key={i}
                        className="bg-orange-500/25 text-orange-600 dark:text-orange-400 font-bold rounded-xs px-0.5"
                    >
                        {part}
                    </mark>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </span>
    );
}

export function PlayerSearchAutocomplete({
    eventId,
    currentUserId,
    excludeUids,
    onSelectPlayer,
    placeholder = "Search by player name or email...",
    disabled = false,
    autoFocus = false,
    className = "",
    theme = "auto",
    actionLabel = "Invite",
    isSubmitting = false,
}: PlayerSearchAutocompleteProps) {
    const listboxId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [invitingUid, setInvitingUid] = useState<string | null>(null);

    const {
        query,
        setQuery,
        results,
        totalMatches,
        loading,
        error,
        clearSearch,
    } = usePlayerSearch({
        eventId,
        currentUserId,
        excludeUids,
        debounceMs: 250,
        limitCount: 10,
    });

    // Reset highlighted index whenever results change
    useEffect(() => {
        setHighlightedIndex((prev) => {
            const next = results.length > 0 ? 0 : -1;
            return prev === next ? prev : next;
        });
    }, [results]);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("touchstart", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("touchstart", handleClickOutside);
        };
    }, []);

    // Ensure highlighted item stays visible in list
    useEffect(() => {
        if (highlightedIndex >= 0 && listRef.current) {
            const items = listRef.current.querySelectorAll<HTMLLIElement>("[data-suggestion-item]");
            const activeItem = items[highlightedIndex];
            if (activeItem) {
                activeItem.scrollIntoView({ block: "nearest" });
            }
        }
    }, [highlightedIndex]);

    const handleSelect = useCallback(
        async (player: PlayerSearchResult) => {
            if (!player.isEligible || isSubmitting || disabled || invitingUid !== null) return;
            setInvitingUid(player.uid);
            try {
                await onSelectPlayer(player);
                setIsOpen(false);
            } catch (err) {
                // Keep open on error so user can review or retry
            } finally {
                setInvitingUid(null);
            }
        },
        [disabled, isSubmitting, invitingUid, onSelectPlayer]
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
            } else if (results.length > 0) {
                setHighlightedIndex((prev) => (prev + 1) % results.length);
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (isOpen && results.length > 0) {
                setHighlightedIndex((prev) => (prev - 1 + results.length) % results.length);
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (isOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
                handleSelect(results[highlightedIndex]);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            setIsOpen(false);
        }
    };

    const handleClear = () => {
        clearSearch();
        inputRef.current?.focus();
        setIsOpen(true);
    };

    const isThemeDark = theme === "dark";
    const isThemeLight = theme === "light";

    // Dynamic style classes based on theme prop or default adaptive classes
    const inputClasses = isThemeDark
        ? "bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-orange-500 focus:ring-orange-500"
        : isThemeLight
        ? "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:ring-orange-500"
        : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 focus:ring-orange-500";

    const dropdownClasses = isThemeDark
        ? "bg-gray-950 border-gray-800 text-white shadow-2xl"
        : isThemeLight
        ? "bg-white border-gray-200 text-gray-900 shadow-xl"
        : "bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white shadow-xl";

    const itemHoverClasses = isThemeDark
        ? "hover:bg-gray-900"
        : isThemeLight
        ? "hover:bg-gray-50"
        : "hover:bg-gray-50 dark:hover:bg-gray-900";

    const itemActiveClasses = isThemeDark
        ? "bg-gray-900"
        : isThemeLight
        ? "bg-orange-50/70"
        : "bg-orange-50/70 dark:bg-gray-900";

    const trimmedQuery = query.trim();
    const hasEnoughChars = trimmedQuery.length >= 2;

    return (
        <div ref={containerRef} className={`relative w-full ${className}`}>
            {/* Search Input Box */}
            <div className="relative flex items-center">
                <Search
                    className={`absolute left-3 w-4 h-4 pointer-events-none transition-colors ${
                        loading ? "text-orange-500" : "text-gray-400"
                    }`}
                />

                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    disabled={disabled}
                    autoFocus={autoFocus}
                    placeholder={placeholder}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-autocomplete="list"
                    aria-controls={listboxId}
                    aria-label="Search players for invitation"
                    className={`w-full pl-9 pr-16 py-2 text-sm rounded-lg border transition-all outline-none focus:ring-1 ${inputClasses}`}
                />

                {/* Right side controls: Spinner & Clear Button */}
                <div className="absolute right-2.5 flex items-center gap-1.5">
                    {(loading || isSubmitting || invitingUid !== null) && (
                        <Loader2 className="w-4 h-4 animate-spin text-orange-500 shrink-0" />
                    )}

                    {query.length > 0 && (
                        <button
                            type="button"
                            onClick={handleClear}
                            aria-label="Clear search"
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Suggestions Dropdown */}
            {isOpen && (
                <div
                    className={`absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border overflow-hidden backdrop-blur-xs transition-all ${dropdownClasses}`}
                >
                    {/* State 1: Need at least 2 characters hint */}
                    {!hasEnoughChars && (
                        <div className="p-3 text-xs flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <Info className="w-4 h-4 text-orange-500 shrink-0" />
                            <span>
                                {trimmedQuery.length === 0
                                    ? "Type player's name (e.g. \"Ahmed\", \"Farid\") to search"
                                    : "Enter at least 2 characters to see matching suggestions"}
                            </span>
                        </div>
                    )}

                    {/* State 2: Error state */}
                    {hasEnoughChars && error && (
                        <div className="p-3 text-xs flex items-center gap-2 text-red-500">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* State 3: Loading while querying */}
                    {hasEnoughChars && loading && results.length === 0 && (
                        <div className="p-4 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                            <span>Searching player directory...</span>
                        </div>
                    )}

                    {/* State 4: No matching results found */}
                    {hasEnoughChars && !loading && !error && results.length === 0 && (
                        <div className="p-4 text-center text-xs text-gray-500 dark:text-gray-400">
                            <p className="font-medium">No matching players found</p>
                            <p className="text-[11px] mt-0.5 opacity-80">
                                No player matching &quot;{trimmedQuery}&quot; was found. Check the spelling or try a different name.
                            </p>
                        </div>
                    )}

                    {/* State 5: Suggestions List */}
                    {hasEnoughChars && results.length > 0 && (
                        <>
                            <ul
                                id={listboxId}
                                ref={listRef}
                                role="listbox"
                                className="max-h-64 sm:max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60 py-1"
                            >
                                {results.map((player, idx) => {
                                    const isHighlighted = idx === highlightedIndex;

                                    return (
                                        <li
                                            key={player.uid}
                                            data-suggestion-item
                                            role="option"
                                            aria-selected={isHighlighted}
                                            onMouseEnter={() => setHighlightedIndex(idx)}
                                            onClick={() => handleSelect(player)}
                                            className={`flex items-center justify-between p-2.5 sm:px-3 sm:py-2.5 transition-colors cursor-pointer text-left ${itemHoverClasses} ${
                                                isHighlighted ? itemActiveClasses : ""
                                            } ${!player.isEligible ? "opacity-75 cursor-not-allowed" : ""}`}
                                        >
                                            {/* Left: Avatar + Details */}
                                            <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                                <Avatar className="h-8 w-8 sm:h-9 sm:w-9 rounded-full shrink-0 border border-gray-200 dark:border-gray-800">
                                                    <AvatarImage
                                                        src={player.photoURL || player.photoUrl}
                                                        alt={player.displayName}
                                                    />
                                                    <AvatarFallback className="bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold text-xs">
                                                        {player.displayName ? (
                                                            player.displayName
                                                                .split(" ")
                                                                .map((n) => n[0])
                                                                .join("")
                                                                .slice(0, 2)
                                                                .toUpperCase()
                                                        ) : (
                                                            <UserIcon className="w-4 h-4" />
                                                        )}
                                                    </AvatarFallback>
                                                </Avatar>

                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="font-semibold text-sm truncate max-w-[150px] sm:max-w-[190px]">
                                                            <HighlightMatch
                                                                text={player.displayName}
                                                                query={query}
                                                            />
                                                        </span>

                                                        {/* Skill level badge */}
                                                        {player.skillLevel && (
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                                                                {player.skillLevel}
                                                            </span>
                                                        )}

                                                        {/* Position / Hand indicator */}
                                                        {player.position && (
                                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 hidden sm:inline">
                                                                • {player.position}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Email identifier */}
                                                    {player.email && (
                                                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px] sm:max-w-60">
                                                            {player.email}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Right: Eligibility Status or Invite Button */}
                                            <div className="shrink-0 ml-2">
                                                {!player.isEligible ? (
                                                    <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium border border-red-500/20 whitespace-nowrap">
                                                        {player.ineligibilityReason || "Ineligible"}
                                                    </span>
                                                ) : (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        disabled={isSubmitting || disabled || invitingUid !== null}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSelect(player);
                                                        }}
                                                        className="h-7 px-2.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors font-medium shrink-0 flex items-center gap-1.5"
                                                    >
                                                        {invitingUid === player.uid || (isSubmitting && invitingUid === player.uid) ? (
                                                            <>
                                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                                <span>Sending...</span>
                                                            </>
                                                        ) : (
                                                            actionLabel
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>

                            {/* Footer hint if results are truncated */}
                            {totalMatches > results.length && (
                                <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900/60 text-[11px] text-gray-500 dark:text-gray-400 text-center border-t border-gray-100 dark:border-gray-800/80">
                                    Showing {results.length} of {totalMatches} matching players. Type more characters to narrow down.
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

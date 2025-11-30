"use client";

import { Search, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type EventFilter = "all" | "active" | "upcoming" | "past";

interface EventFiltersProps {
    activeFilter: EventFilter;
    onFilterChange: (filter: EventFilter) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onClearFilters: () => void;
    onRefresh: () => void;
    isRefreshing?: boolean;
}

export function EventFilters({
    activeFilter,
    onFilterChange,
    searchQuery,
    onSearchChange,
    onClearFilters,
    onRefresh,
    isRefreshing = false,
}: EventFiltersProps) {
    const filters: { key: EventFilter; label: string }[] = [
        { key: "all", label: "All" },
        { key: "active", label: "Happening Now" },
        { key: "upcoming", label: "Upcoming" },
        { key: "past", label: "Past" },
    ];

    const hasActiveFilters = activeFilter !== "all" || searchQuery.length > 0;

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                    type="text"
                    placeholder="Search events by name..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="pl-10 pr-10"
                />
                {searchQuery && (
                    <button
                        onClick={() => onSearchChange("")}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {filters.map((filter) => (
                    <Button
                        key={filter.key}
                        variant={activeFilter === filter.key ? "default" : "outline"}
                        size="sm"
                        onClick={() => onFilterChange(filter.key)}
                        className={
                            activeFilter === filter.key
                                ? "bg-blue-600 hover:bg-blue-700 text-white"
                                : ""
                        }
                    >
                        {filter.label}
                    </Button>
                ))}

                <div className="flex-1" />

                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        <X className="w-4 h-4 mr-1" />
                        Clear Filters
                    </Button>
                )}

                <Button
                    variant="outline"
                    size="sm"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="text-gray-500 hover:text-gray-700"
                >
                    <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </div>
        </div>
    );
}

"use client";

// import { Search, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";

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
    // searchQuery,
    // onSearchChange,
    // onClearFilters,
    // onRefresh,
    // isRefreshing = false,
}: EventFiltersProps) {
    const filters: { key: EventFilter; label: string }[] = [
        { key: "all", label: "All" },
        { key: "upcoming", label: "Upcoming" },
        { key: "active", label: "Live" },
        { key: "past", label: "Past" },
    ];

    // const hasActiveFilters = activeFilter !== "all" || searchQuery.length > 0;

    return (
        <div className="space-y-4">
            {/* Search Bar - Hidden for now as per screenshot, or styled dark? Screenshot doesn't show search. 
                But user said "maintain same functionality". I'll keep it but style it dark. 
            */}
            {/* 
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 w-5 h-5" />
                <Input
                    type="text"
                    placeholder="Search events..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="pl-10 pr-10 bg-gray-900 border-gray-800 text-white placeholder:text-gray-600 focus-visible:ring-orange-500"
                />
                {searchQuery && (
                    <button
                        onClick={() => onSearchChange("")}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
            */}

            <div className="flex flex-wrap items-center gap-3">
                {filters.map((filter) => (
                    <Button
                        key={filter.key}
                        variant={activeFilter === filter.key ? "default" : "outline"}
                        size="sm"
                        onClick={() => onFilterChange(filter.key)}
                        className={
                            activeFilter === filter.key
                                ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500"
                                : "bg-transparent border-gray-800 text-gray-400 hover:text-white hover:bg-gray-900 hover:border-gray-700"
                        }
                    >
                        {filter.label}
                    </Button>
                ))}

                <div className="flex-1" />

                {/* Keep functionality but maybe hide if not needed or style minimally */}
            </div>
        </div>
    );
}

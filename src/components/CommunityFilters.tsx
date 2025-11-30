import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export interface CommunityFiltersState {
    skillLevel: string;
    hand: string;
    position: string;
    gender: string;
    registrationMonth: string;
}

interface CommunityFiltersProps {
    filters: CommunityFiltersState;
    onFilterChange: (key: keyof CommunityFiltersState, value: string) => void;
    onClearFilters: () => void;
}

export function CommunityFilters({
    filters,
    onFilterChange,
    onClearFilters,
}: CommunityFiltersProps) {
    const hasActiveFilters = Object.values(filters).some((v) => v !== "");

    return (
        <div className="space-y-4 p-4 bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">Filters</h3>
                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 px-2"
                    >
                        <X className="w-4 h-4 mr-1" />
                        Clear All
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Skill Level */}
                <Select
                    value={filters.skillLevel}
                    onValueChange={(value) => onFilterChange("skillLevel", value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Skill Level" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Levels</SelectItem>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                        <SelectItem value="expert">Expert</SelectItem>
                    </SelectContent>
                </Select>

                {/* Hand */}
                <Select
                    value={filters.hand}
                    onValueChange={(value) => onFilterChange("hand", value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Hand" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any Hand</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                        <SelectItem value="left">Left</SelectItem>
                    </SelectContent>
                </Select>

                {/* Position */}
                <Select
                    value={filters.position}
                    onValueChange={(value) => onFilterChange("position", value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Position" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any Position</SelectItem>
                        <SelectItem value="left">Left Side</SelectItem>
                        <SelectItem value="right">Right Side</SelectItem>
                    </SelectContent>
                </Select>

                {/* Gender */}
                <Select
                    value={filters.gender}
                    onValueChange={(value) => onFilterChange("gender", value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Gender" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any Gender</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                </Select>

                {/* Registration Month */}
                <Select
                    value={filters.registrationMonth}
                    onValueChange={(value) => onFilterChange("registrationMonth", value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Joined In" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any Time</SelectItem>
                        <SelectItem value="0">January</SelectItem>
                        <SelectItem value="1">February</SelectItem>
                        <SelectItem value="2">March</SelectItem>
                        <SelectItem value="3">April</SelectItem>
                        <SelectItem value="4">May</SelectItem>
                        <SelectItem value="5">June</SelectItem>
                        <SelectItem value="6">July</SelectItem>
                        <SelectItem value="7">August</SelectItem>
                        <SelectItem value="8">September</SelectItem>
                        <SelectItem value="9">October</SelectItem>
                        <SelectItem value="10">November</SelectItem>
                        <SelectItem value="11">December</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}

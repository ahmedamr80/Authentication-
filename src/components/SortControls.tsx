import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown } from "lucide-react";

export type SortOption = "name" | "skill" | "newest" | "oldest";

interface SortControlsProps {
    sortBy: SortOption;
    onSortChange: (value: SortOption) => void;
}

export function SortControls({ sortBy, onSortChange }: SortControlsProps) {
    return (
        <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-gray-500" />
            <Select value={sortBy} onValueChange={(value) => onSortChange(value as SortOption)}>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="newest">Newest Members</SelectItem>
                    <SelectItem value="oldest">Oldest Members</SelectItem>
                    <SelectItem value="skill">Skill Level (High-Low)</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
}

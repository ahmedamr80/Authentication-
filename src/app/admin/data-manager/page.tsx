"use client";

import { useState, useEffect } from "react";
import { withAdminProtection } from "@/lib/with-admin-protection";
import { db, auth } from "@/lib/firebase";
import {
    collection,
    getDocs,
    limit,
    doc,
    updateDoc,
    query,
    DocumentData,
} from "firebase/firestore";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/context/ToastContext";
import { Loader2, Save, Bell, LogOut, Settings, User, Home, Calendar, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/context/AuthContext";

const COLLECTIONS = ["users", "events", "registrations", "clubs", "teams"];

function DataManagerPage() {
    const [selectedCollection, setSelectedCollection] = useState<string>("users");
    const [data, setData] = useState<DocumentData[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [filteredData, setFilteredData] = useState<DocumentData[]>([]);
    const { showToast } = useToast();
    const router = useRouter();
    const { user } = useAuth();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    useEffect(() => {
        fetchData(selectedCollection);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCollection]);

    useEffect(() => {
        if (Object.keys(filters).length === 0) {
            setFilteredData(data);
            return;
        }

        const filtered = data.filter(row => {
            return Object.entries(filters).every(([key, filterValue]) => {
                if (!filterValue) return true;
                const cellValue = formatValue(row[key]).toLowerCase();
                return cellValue.includes(filterValue.toLowerCase());
            });
        });
        setFilteredData(filtered);
    }, [data, filters]);

    const fetchData = async (collName: string) => {
        setLoading(true);
        setEdits({});
        setFilters({});
        try {
            const q = query(collection(db, collName), limit(100));
            const querySnapshot = await getDocs(q);
            const docs = querySnapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));

            // Extract unique keys
            const allKeys = new Set<string>();
            docs.forEach((d) => {
                Object.keys(d).forEach((k) => {
                    if (k !== "id") allKeys.add(k);
                });
            });
            setColumns(Array.from(allKeys).sort());
            setData(docs);
        } catch (error) {
            console.error("Error fetching data:", error);
            showToast("Failed to fetch data", "error");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (rowId: string, field: string, value: string) => {
        setEdits((prev) => ({
            ...prev,
            [rowId]: {
                ...prev[rowId],
                [field]: value,
            },
        }));
    };

    const handleSave = async (rowId: string) => {
        const rowEdits = edits[rowId];
        if (!rowEdits) return;

        setSaving((prev) => ({ ...prev, [rowId]: true }));
        try {
            const updates: Record<string, unknown> = {};
            Object.entries(rowEdits).forEach(([key, value]) => {
                // Basic type inference
                if (typeof value === 'string') {
                    if (value === "true") updates[key] = true;
                    else if (value === "false") updates[key] = false;
                    else if (!isNaN(Number(value)) && value.trim() !== "") updates[key] = Number(value);
                    else if (value.startsWith("{") || value.startsWith("[")) {
                        try {
                            updates[key] = JSON.parse(value);
                        } catch {
                            updates[key] = value; // Fallback to string if invalid JSON
                        }
                    }
                    else updates[key] = value;
                } else {
                    updates[key] = value;
                }
            });

            await updateDoc(doc(db, selectedCollection, rowId), updates);

            // Update local data
            setData((prev) =>
                prev.map((d) => (d.id === rowId ? { ...d, ...updates } : d))
            );

            // Clear edits for this row
            setEdits((prev) => {
                const newEdits = { ...prev };
                delete newEdits[rowId];
                return newEdits;
            });

            showToast("Changes saved successfully", "success");
        } catch (error) {
            console.error("Error saving document:", error);
            showToast("Failed to save changes", "error");
        } finally {
            setSaving((prev) => ({ ...prev, [rowId]: false }));
        }
    };

    const formatValue = (val: unknown): string => {
        if (val === null || val === undefined) return "";
        if (typeof val === "object") return JSON.stringify(val);
        return String(val);
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            showToast("No data to export", "info");
            return;
        }

        const headers = ["id", ...columns];
        const csvContent = [
            headers.join(","),
            ...data.map(row =>
                headers.map(header => {
                    const val = row[header];
                    const formatted = formatValue(val).replace(/"/g, '""'); // Escape quotes
                    return `"${formatted}"`; // Wrap in quotes
                }).join(",")
            )
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${selectedCollection}_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            {/* Sticky Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push("/dashboard")}>
                        <Image src="/logo.svg" alt="EveryWherePadel Logo" width={32} height={32} className="w-8 h-8" />
                        <h1 className="text-xl font-bold bg-linear-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
                            EveryWherePadel
                        </h1>
                    </div>

                    {/* User Menu */}
                    <div className="relative">
                        {user ? (
                            <div className="flex items-center gap-4">
                                <button className="text-gray-400 hover:text-white transition-colors relative" onClick={() => router.push("/notifications")}>
                                    <Bell className="w-6 h-6" />
                                </button>
                                <div className="relative">
                                    <Avatar
                                        className="h-8 w-8 cursor-pointer border-2 border-transparent hover:border-orange-500 transition-all"
                                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                                    >
                                        <AvatarImage src={user.photoURL || undefined} />
                                        <AvatarFallback className="bg-orange-500 text-white">
                                            {user.displayName?.charAt(0) || "U"}
                                        </AvatarFallback>
                                    </Avatar>

                                    {/* Dropdown Menu */}
                                    {isUserMenuOpen && (
                                        <>
                                            <div
                                                className="fixed inset-0 z-40"
                                                onClick={() => setIsUserMenuOpen(false)}
                                            />
                                            <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                                <div className="p-4 border-b border-gray-800">
                                                    <p className="font-medium text-white truncate">{user.displayName}</p>
                                                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                                                </div>
                                                <div className="p-1">
                                                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
                                                        <User className="h-4 w-4" /> Profile
                                                    </button>
                                                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
                                                        <Settings className="h-4 w-4" /> Settings
                                                    </button>
                                                </div>
                                                <div className="p-1 border-t border-gray-800">
                                                    <button
                                                        onClick={handleSignOut}
                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                                    >
                                                        <LogOut className="h-4 w-4" /> Sign Out
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <Button size="sm" onClick={() => router.push("/auth/signin")}>
                                Sign In
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold text-white">Data Manager</h1>
                    <div className="flex items-center gap-4">
                        <Button variant="outline" onClick={handleExportCSV} disabled={data.length === 0} className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white">
                            <Save className="h-4 w-4 mr-2" />
                            Export CSV
                        </Button>
                        <div className="w-[200px]">
                            <Select
                                value={selectedCollection}
                                onValueChange={setSelectedCollection}
                            >
                                <SelectTrigger className="bg-gray-900 border-gray-800 text-white focus:ring-orange-500">
                                    <SelectValue placeholder="Select Collection" />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                    {COLLECTIONS.map((c) => (
                                        <SelectItem key={c} value={c}>
                                            {c}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                    </div>
                ) : (
                    <div className="rounded-md border border-gray-800 overflow-x-auto bg-gray-900">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-950 text-gray-300 uppercase font-medium border-b border-gray-800">
                                <tr>
                                    <th className="px-4 py-3 min-w-[150px] align-top">
                                        <div className="flex flex-col gap-2">
                                            <span>ID</span>
                                            <Input
                                                placeholder="Filter ID..."
                                                className="h-7 text-xs bg-gray-900 border-gray-700 text-white placeholder:text-gray-500"
                                                value={filters["id"] || ""}
                                                onChange={(e) => setFilters(prev => ({ ...prev, id: e.target.value }))}
                                            />
                                        </div>
                                    </th>
                                    {columns.map((col) => (
                                        <th key={col} className="px-4 py-3 min-w-[200px] align-top">
                                            <div className="flex flex-col gap-2">
                                                <span>{col}</span>
                                                <Input
                                                    placeholder={`Filter ${col}...`}
                                                    className="h-7 text-xs bg-gray-900 border-gray-700 text-white placeholder:text-gray-500"
                                                    value={filters[col] || ""}
                                                    onChange={(e) => setFilters(prev => ({ ...prev, [col]: e.target.value }))}
                                                />
                                            </div>
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 sticky right-0 bg-gray-950 shadow-l align-top">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {filteredData.map((row) => {
                                    const hasEdits = !!edits[row.id];
                                    const isSaving = saving[row.id];

                                    return (
                                        <tr key={row.id} className="hover:bg-gray-800/50 transition-colors">
                                            <td className="px-4 py-2 font-mono text-xs text-gray-400">
                                                {row.id}
                                            </td>
                                            {columns.map((col) => {
                                                const originalValue = row[col];
                                                const currentValue =
                                                    (edits[row.id]?.[col] as string) ?? formatValue(originalValue);

                                                return (
                                                    <td key={col} className="px-2 py-2">
                                                        <Input
                                                            className="h-8 text-xs bg-gray-950 border-gray-800 text-white focus:border-orange-500"
                                                            value={currentValue}
                                                            onChange={(e) =>
                                                                handleEdit(row.id, col, e.target.value)
                                                            }
                                                        />
                                                    </td>
                                                );
                                            })}
                                            <td className="px-4 py-2 sticky right-0 bg-gray-900 shadow-l">
                                                {hasEdits && (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleSave(row.id)}
                                                        disabled={isSaving}
                                                        className="bg-orange-500 hover:bg-orange-600 text-white"
                                                    >
                                                        {isSaving ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <Save className="h-4 w-4 mr-1" />
                                                                Save
                                                            </>
                                                        )}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredData.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={columns.length + 2}
                                            className="px-4 py-8 text-center text-gray-500"
                                        >
                                            No documents found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>

            {/* Sticky Bottom Nav */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-md border-t border-gray-800 px-6 py-3">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <Link href="/dashboard" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Home className="w-6 h-6" />
                        <span className="text-xs font-medium">Home</span>
                    </Link>
                    <Link href="/events" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Calendar className="w-6 h-6" />
                        <span className="text-xs font-medium">Events</span>
                    </Link>
                    <Link href="/community" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Users className="w-6 h-6" />
                        <span className="text-xs font-medium">Community</span>
                    </Link>
                </div>
            </nav>
        </div>
    );
}

export default withAdminProtection(DataManagerPage);

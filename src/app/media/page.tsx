"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ref, listAll, getDownloadURL, uploadBytes, deleteObject, StorageReference } from "firebase/storage";
import { storage, auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { useToast } from "@/context/ToastContext";
import { Loader2, Upload, Copy, Trash2, Folder, Image as ImageIcon, RefreshCw, ArrowLeft, Bell, LogOut, Settings, User, Home, Calendar, Users } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/context/AuthContext";

interface StorageItem {
    name: string;
    fullPath: string;
    url?: string;
    isFolder: boolean;
    ref: StorageReference;
}

export default function MediaPage() {
    const router = useRouter();
    const { user } = useAuth();
    const { showToast } = useToast();
    const [currentPath, setCurrentPath] = useState<string>("");
    const [items, setItems] = useState<StorageItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    const fetchItems = useCallback(async (path: string) => {
        setLoading(true);
        try {
            const listRef = ref(storage, path);
            const res = await listAll(listRef);

            const folderItems: StorageItem[] = res.prefixes.map((folderRef) => ({
                name: folderRef.name,
                fullPath: folderRef.fullPath,
                isFolder: true,
                ref: folderRef,
            }));

            const fileItems: StorageItem[] = await Promise.all(
                res.items.map(async (itemRef) => {
                    let url = "";
                    try {
                        url = await getDownloadURL(itemRef);
                    } catch (e) {
                        console.warn("Failed to get URL for", itemRef.name, e);
                    }
                    return {
                        name: itemRef.name,
                        fullPath: itemRef.fullPath,
                        url,
                        isFolder: false,
                        ref: itemRef,
                    };
                })
            );

            setItems([...folderItems, ...fileItems]);
        } catch (error) {
            console.error("Error fetching items:", error);
            showToast("Failed to load media items", "error");
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchItems(currentPath);
    }, [currentPath, fetchItems]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const storageRef = ref(storage, `${currentPath ? currentPath + '/' : ''}${file.name}`);
                await uploadBytes(storageRef, file);
            }
            showToast("Upload successful!", "success");
            fetchItems(currentPath);
        } catch (error) {
            console.error("Error uploading:", error);
            showToast("Failed to upload files", "error");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleDelete = async (item: StorageItem) => {
        if (!confirm(`Are you sure you want to delete ${item.name}?`)) return;

        try {
            await deleteObject(item.ref);
            showToast("Item deleted", "success");
            fetchItems(currentPath);
        } catch (error) {
            console.error("Error deleting:", error);
            showToast("Failed to delete item", "error");
        }
    };

    const copyToClipboard = (url: string) => {
        navigator.clipboard.writeText(url);
        showToast("URL copied to clipboard!", "success");
    };

    const navigateUp = () => {
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <Button
                            variant="ghost"
                            onClick={() => router.push("/dashboard")}
                            className="text-gray-400 hover:text-white mb-2 pl-0 hover:bg-transparent"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Dashboard
                        </Button>
                        <h1 className="text-2xl font-bold text-white">Media Library</h1>
                        <p className="text-sm text-gray-400">
                            Manage and reuse your uploaded images.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => fetchItems(currentPath)} disabled={loading} className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white">
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="bg-orange-500 hover:bg-orange-600 text-white">
                            <Upload className="w-4 h-4 mr-2" />
                            {uploading ? "Uploading..." : "Upload Image"}
                        </Button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            multiple
                            accept="image/*"
                            onChange={handleUpload}
                        />
                    </div>
                </div>

                {/* Breadcrumbs / Navigation */}
                <div className="flex items-center gap-2 text-sm bg-gray-900 p-3 rounded-lg shadow-sm border border-gray-800">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCurrentPath("")}
                        disabled={!currentPath}
                        className={!currentPath ? "font-bold text-blue-400" : "text-gray-400 hover:text-white"}
                    >
                        Root
                    </Button>
                    {currentPath.split('/').filter(Boolean).map((part, index, arr) => (
                        <div key={index} className="flex items-center">
                            <span className="text-gray-600 mx-1">/</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentPath(arr.slice(0, index + 1).join('/'))}
                                className={index === arr.length - 1 ? "font-bold text-blue-400" : "text-gray-400 hover:text-white"}
                            >
                                {part}
                            </Button>
                        </div>
                    ))}
                    {currentPath && (
                        <Button variant="ghost" size="sm" onClick={navigateUp} className="ml-auto text-gray-500 hover:text-white">
                            Up Level
                        </Button>
                    )}
                </div>

                {loading && items.length === 0 ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-12 bg-gray-900 rounded-lg border border-dashed border-gray-800">
                        <ImageIcon className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-white">No items found</h3>
                        <p className="text-gray-500 mt-1">
                            Upload images to get started.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {items.map((item) => (
                            <div key={`${item.fullPath}-${item.isFolder ? 'folder' : 'file'}`} className="group relative bg-gray-900 rounded-lg shadow-sm border border-gray-800 overflow-hidden hover:shadow-md transition-shadow">
                                {item.isFolder ? (
                                    <div
                                        onClick={() => setCurrentPath(item.fullPath)}
                                        className="cursor-pointer p-6 flex flex-col items-center justify-center h-40 bg-gray-800/50 hover:bg-gray-800 transition-colors"
                                    >
                                        <Folder className="w-12 h-12 text-blue-500 mb-2" />
                                        <span className="text-sm font-medium text-gray-300 truncate w-full text-center px-2">
                                            {item.name}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="relative h-40 bg-gray-800">
                                        {item.url ? (
                                            <Image
                                                src={item.url}
                                                alt={item.name}
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-gray-600">
                                                <ImageIcon className="w-8 h-8" />
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 gap-2">
                                            {item.url && (
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className="bg-gray-800 hover:bg-gray-700 text-white border-gray-600"
                                                    onClick={() => copyToClipboard(item.url!)}
                                                    title="Copy URL"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button
                                                size="icon"
                                                variant="outline"
                                                className="bg-gray-800 hover:bg-red-900/50 text-red-400 border-red-900 hover:border-red-700"
                                                onClick={() => handleDelete(item)}
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {!item.isFolder && (
                                    <div className="p-2 text-xs text-gray-400 truncate border-t border-gray-800">
                                        {item.name}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Sticky Bottom Nav */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-md border-t border-gray-800 px-6 py-3">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <Link href="/" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
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

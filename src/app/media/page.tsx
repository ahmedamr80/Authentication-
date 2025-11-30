"use client";

import { useState, useEffect, useRef } from "react";
import { ref, listAll, getDownloadURL, uploadBytes, deleteObject, StorageReference } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { useToast } from "@/context/ToastContext";
import { Loader2, Upload, Copy, Trash2, Folder, Image as ImageIcon, RefreshCw, ArrowLeft } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface StorageItem {
    name: string;
    fullPath: string;
    url?: string;
    isFolder: boolean;
    ref: StorageReference;
}

export default function MediaPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [currentPath, setCurrentPath] = useState<string>("");
    const [items, setItems] = useState<StorageItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchItems = async (path: string) => {
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
    };

    useEffect(() => {
        fetchItems(currentPath);
    }, [currentPath, showToast]);

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

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <Button
                            variant="ghost"
                            onClick={() => router.push("/dashboard")}
                            className="text-gray-600 hover:text-gray-900 mb-2 pl-0 hover:bg-transparent"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Dashboard
                        </Button>
                        <h1 className="text-2xl font-bold text-gray-900">Media Library</h1>
                        <p className="text-sm text-gray-500">
                            Manage and reuse your uploaded images.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => fetchItems(currentPath)} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
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
                <div className="flex items-center gap-2 text-sm bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCurrentPath("")}
                        disabled={!currentPath}
                        className={!currentPath ? "font-bold text-blue-600" : "text-gray-600"}
                    >
                        Root
                    </Button>
                    {currentPath.split('/').filter(Boolean).map((part, index, arr) => (
                        <div key={index} className="flex items-center">
                            <span className="text-gray-400 mx-1">/</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentPath(arr.slice(0, index + 1).join('/'))}
                                className={index === arr.length - 1 ? "font-bold text-blue-600" : "text-gray-600"}
                            >
                                {part}
                            </Button>
                        </div>
                    ))}
                    {currentPath && (
                        <Button variant="ghost" size="sm" onClick={navigateUp} className="ml-auto text-gray-500">
                            Up Level
                        </Button>
                    )}
                </div>

                {loading && items.length === 0 ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
                        <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900">No items found</h3>
                        <p className="text-gray-500 mt-1">
                            Upload images to get started.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {items.map((item) => (
                            <div key={`${item.fullPath}-${item.isFolder ? 'folder' : 'file'}`} className="group relative bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                                {item.isFolder ? (
                                    <div
                                        onClick={() => setCurrentPath(item.fullPath)}
                                        className="cursor-pointer p-6 flex flex-col items-center justify-center h-40 bg-blue-50 hover:bg-blue-100 transition-colors"
                                    >
                                        <Folder className="w-12 h-12 text-blue-500 mb-2" />
                                        <span className="text-sm font-medium text-gray-700 truncate w-full text-center px-2">
                                            {item.name}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="relative h-40 bg-gray-100">
                                        {item.url ? (
                                            <Image
                                                src={item.url}
                                                alt={item.name}
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-gray-400">
                                                <ImageIcon className="w-8 h-8" />
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 gap-2">
                                            {item.url && (
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className="bg-white hover:bg-gray-100 text-gray-700 border-gray-200"
                                                    onClick={() => copyToClipboard(item.url!)}
                                                    title="Copy URL"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button
                                                size="icon"
                                                variant="outline"
                                                className="bg-white hover:bg-red-50 text-red-600 border-red-200 hover:border-red-300"
                                                onClick={() => handleDelete(item)}
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {!item.isFolder && (
                                    <div className="p-2 text-xs text-gray-600 truncate border-t border-gray-100">
                                        {item.name}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

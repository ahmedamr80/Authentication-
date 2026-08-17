import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, auth } from "@/lib/firebase";

interface UploadOptions {
    file: File;
    folder: string;
    customId?: string;
    compress?: boolean;
}

/**
 * Resilient image uploader:
 * 1. Tries direct Firebase Storage client SDK upload.
 * 2. If client storage fails, attempts upload via server API (/api/upload).
 * 3. If server fails, falls back to a high-quality client Base64 Data URI.
 */
export async function uploadImageWithFallback({
    file,
    folder,
    customId,
    compress = true,
}: UploadOptions): Promise<string> {
    if (!file.type.startsWith("image/")) {
        throw new Error("Please upload an image file");
    }

    if (file.size > 10 * 1024 * 1024) {
        throw new Error("Image size should be less than 10MB");
    }

    // Optional compression
    const processedFile = compress ? await compressImage(file) : file;
    const fileName = customId || `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const storagePath = `${folder}/${fileName}`;

    // 1. Try Direct Client Upload
    try {
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, processedFile);
        const downloadURL = await getDownloadURL(storageRef);
        return downloadURL;
    } catch (clientErr) {
        console.warn(`Client storage upload failed for ${storagePath}, falling back to server API:`, clientErr);
    }

    // 2. Try Server API Fallback
    try {
        const formData = new FormData();
        formData.append("file", processedFile);
        formData.append("folder", folder);
        if (customId) formData.append("customId", customId);

        const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : "";
        const res = await fetch("/api/upload", {
            method: "POST",
            headers: {
                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: formData,
        });

        const data = await res.json();
        if (res.ok && data.success && data.url) {
            return data.url;
        }
        console.warn("Server upload API returned error:", data.error);
    } catch (serverErr) {
        console.warn("Server upload API failed, falling back to Data URL:", serverErr);
    }

    // 3. Fallback: Base64 Data URL
    return await fileToDataUrl(processedFile);
}

function compressImage(file: File): Promise<File | Blob> {
    return new Promise((resolve) => {
        // If file is already small (< 600KB), don't compress
        if (file.size <= 600 * 1024) {
            resolve(file);
            return;
        }

        const img = document.createElement("img");
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 1200;
                const MAX_HEIGHT = 1200;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width = Math.round((width * MAX_HEIGHT) / height);
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(file);
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (blob && blob.size < file.size) {
                            resolve(blob);
                        } else {
                            resolve(file);
                        }
                    },
                    "image/jpeg",
                    0.85
                );
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

function fileToDataUrl(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

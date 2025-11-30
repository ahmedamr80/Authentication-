"use client";

import { useState, useEffect, useRef, use } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/context/ToastContext";
import { Loader2, User as UserIcon, Camera, ArrowLeft } from "lucide-react";
import Image from "next/image";

// Schema (Reused from Profile Page)
const profileSchema = z.object({
    fullName: z.string().min(2, "Full Name must be at least 2 characters"),
    gender: z.enum(["male", "female"]),
    phone: z.string().min(8, "Phone number must be at least 8 characters"),
    notes: z.string().optional(),
    hand: z.enum(["right", "left"]),
    registrationStatus: z.enum(["active", "pending"]),
    position: z.enum(["right", "left", "both"]),
    role: z.enum(["player", "admin"]),
    skillLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]),
    nickname: z.string().optional(),
    isShadow: z.boolean().default(false),
    isAdmin: z.boolean().default(false),
    location: z.string().optional(),
    dateOfBirth: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function PlayerDetailsPage({ params }: { params: Promise<{ playerId: string }> }) {
    const router = useRouter();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Unwrap params using React.use()
    const { playerId } = use(params);

    const form = useForm<ProfileFormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: zodResolver(profileSchema) as any,
        defaultValues: {
            fullName: "",
            gender: "male",
            phone: "",
            notes: "",
            hand: "right",
            registrationStatus: "pending",
            position: "right",
            role: "player",
            skillLevel: "beginner",
            nickname: "",
            isShadow: false,
            isAdmin: false,
            location: "",
            dateOfBirth: "",
        },
    });

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const docRef = doc(db, "users", playerId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    form.reset({
                        fullName: data.fullName || data.fullname || "",
                        gender: (data.gender?.toLowerCase() as ProfileFormValues["gender"]) || "male",
                        phone: data.phone || "",
                        notes: data.notes || "",
                        hand: (data.hand?.toLowerCase() as ProfileFormValues["hand"]) || "right",
                        registrationStatus: data.registrationStatus || "pending",
                        position: (data.position?.toLowerCase() as ProfileFormValues["position"]) || "right",
                        role: data.role || "player",
                        skillLevel: (data.skillLevel?.toLowerCase() as ProfileFormValues["skillLevel"]) || (data.skilllevel?.toLowerCase() as ProfileFormValues["skillLevel"]) || "beginner",
                        nickname: data.nickname || "",
                        isShadow: data.isShadow || false,
                        isAdmin: data.isAdmin || false,
                        location: data.location || "",
                        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth.seconds * 1000).toISOString().split('T')[0] : "",
                    });
                    setPhotoUrl(data.photoUrl || null);
                } else {
                    showToast("Player not found", "error");
                    router.push("/community");
                }
            } catch (error) {
                console.error("Error fetching profile:", error);
                showToast("Failed to load profile", "error");
            } finally {
                setLoading(false);
            }
        };

        if (playerId) {
            fetchProfile();
        }
    }, [playerId, form, showToast, router]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            showToast("Please upload an image file", "error");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast("Image size should be less than 5MB", "error");
            return;
        }

        setUploadingPhoto(true);
        try {
            const compressedFile = await compressImage(file);
            const storageRef = ref(storage, `profile-pictures/${playerId}`);
            await uploadBytes(storageRef, compressedFile);
            const downloadURL = await getDownloadURL(storageRef);

            setPhotoUrl(downloadURL);
            await updateDoc(doc(db, "users", playerId), {
                photoUrl: downloadURL
            });

            showToast("Profile picture updated!", "success");
        } catch (error) {
            console.error("Error uploading image:", error);
            showToast("Failed to upload image", "error");
        } finally {
            setUploadingPhoto(false);
        }
    };

    const compressImage = (file: File): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const img = document.createElement("img");
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        reject(new Error("Could not get canvas context"));
                        return;
                    }

                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error("Canvas to Blob failed"));
                    }, "image/jpeg", 0.7);
                };
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const onSubmit: SubmitHandler<ProfileFormValues> = async (data) => {
        setSaving(true);
        try {
            await updateDoc(doc(db, "users", playerId), {
                ...data,
                photoUrl: photoUrl,
                dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
                updatedAt: new Date(),
            });
            showToast("Player profile updated successfully!", "success");
        } catch (error) {
            console.error("Error updating profile:", error);
            showToast("Failed to update profile", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto space-y-6">
                <Button
                    variant="ghost"
                    onClick={() => router.push("/community")}
                    className="text-gray-600 hover:text-gray-900 pl-0 hover:bg-transparent"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Community
                </Button>

                <div className="bg-white shadow rounded-lg p-6 sm:p-8">
                    <div className="border-b border-gray-200 pb-6 mb-6 text-center">
                        <h1 className="text-2xl font-bold text-gray-900">Edit Player Profile</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            Update information for this player.
                        </p>
                    </div>

                    <div className="flex flex-col items-center mb-8">
                        <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                            <div className="h-32 w-32 rounded-full overflow-hidden border-4 border-white shadow-lg bg-gray-100 relative">
                                {photoUrl ? (
                                    <Image
                                        src={photoUrl}
                                        alt="Profile"
                                        fill
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center text-gray-400">
                                        <UserIcon className="h-16 w-16" />
                                    </div>
                                )}
                                {uploadingPhoto && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <Loader2 className="h-8 w-8 animate-spin text-white" />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <Camera className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                            />
                        </div>
                        <p className="mt-2 text-sm text-gray-500">Click to upload photo</p>
                    </div>

                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        {/* Personal Info */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Full Name</label>
                                <Input {...form.register("fullName")} placeholder="Enter full name" />
                                {form.formState.errors.fullName && (
                                    <p className="text-sm text-red-500">{form.formState.errors.fullName.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Nickname</label>
                                <Input {...form.register("nickname")} placeholder="Enter nickname" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Phone</label>
                                <Input {...form.register("phone")} placeholder="Enter phone number" />
                                {form.formState.errors.phone && (
                                    <p className="text-sm text-red-500">{form.formState.errors.phone.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Location</label>
                                <Input {...form.register("location")} placeholder="City, Country" />
                            </div>
                        </div>

                        {/* Player Stats */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Gender</label>
                                <Select onValueChange={(val) => form.setValue("gender", val as ProfileFormValues["gender"])} defaultValue={form.getValues("gender")}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select gender" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="male">Male</SelectItem>
                                        <SelectItem value="female">Female</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Skill Level</label>
                                <Select onValueChange={(val) => form.setValue("skillLevel", val as ProfileFormValues["skillLevel"])} defaultValue={form.getValues("skillLevel")}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select skill level" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="beginner">Beginner</SelectItem>
                                        <SelectItem value="intermediate">Intermediate</SelectItem>
                                        <SelectItem value="advanced">Advanced</SelectItem>
                                        <SelectItem value="expert">Expert</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Hand</label>
                                <Select onValueChange={(val) => form.setValue("hand", val as ProfileFormValues["hand"])} defaultValue={form.getValues("hand")}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select hand" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="right">Right</SelectItem>
                                        <SelectItem value="left">Left</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Position</label>
                                <Select onValueChange={(val) => form.setValue("position", val as ProfileFormValues["position"])} defaultValue={form.getValues("position")}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select position" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="right">Right</SelectItem>
                                        <SelectItem value="left">Left</SelectItem>
                                        <SelectItem value="both">Both</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Admin/System Fields */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 bg-gray-50 p-4 rounded-lg">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Role</label>
                                <Select
                                    onValueChange={(val) => {
                                        form.setValue("role", val as ProfileFormValues["role"]);
                                        if (val === "admin") form.setValue("isAdmin", true);
                                        else form.setValue("isAdmin", false);
                                    }}
                                    defaultValue={form.getValues("role")}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="player">Player</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Registration Status</label>
                                <Select onValueChange={(val) => form.setValue("registrationStatus", val as ProfileFormValues["registrationStatus"])} defaultValue={form.getValues("registrationStatus")}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="pending">Pending</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="isShadow"
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    {...form.register("isShadow")}
                                />
                                <label htmlFor="isShadow" className="text-sm font-medium text-gray-700">Is Shadow User</label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="isAdmin"
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    {...form.register("isAdmin", {
                                        onChange: (e) => {
                                            if (e.target.checked) form.setValue("role", "admin");
                                            else form.setValue("role", "player");
                                        }
                                    })}
                                />
                                <label htmlFor="isAdmin" className="text-sm font-medium text-gray-700">Is Admin</label>
                            </div>
                        </div>

                        {/* Date of Birth */}
                        <div className="space-y-2">
                            <label htmlFor="dateOfBirth" className="text-sm font-medium text-gray-700">Date of Birth</label>
                            <Input
                                id="dateOfBirth"
                                type="date"
                                {...form.register("dateOfBirth")}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Notes</label>
                            <Textarea {...form.register("notes")} placeholder="Additional notes..." className="h-24" />
                        </div>

                        <div className="flex justify-end pt-6">
                            <Button type="submit" size="lg" isLoading={saving}>
                                Save Changes
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

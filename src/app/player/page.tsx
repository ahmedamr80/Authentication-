"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged, User, sendEmailVerification } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/context/ToastContext";
import { Loader2, User as UserIcon, Camera, Bell, LogOut, Settings, Home, Calendar, Users, ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
// import { useAuth } from "@/context/AuthContext";

// ------------------------------------------------------------------
// 📧 EMAIL VERIFICATION SWITCH 📧
// Set to "on" to enable email verification, "off" to disable.
const EMAIL_VERIFICATION_ON: string = "on";
// ------------------------------------------------------------------

// Schema
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
    dateOfBirth: z.string().optional(), // Using string for date input "YYYY-MM-DD"
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function PlayerProfilePage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [isVerified, setIsVerified] = useState(false); // Added state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

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
        const fetchProfile = async (uid: string) => {
            try {
                const docRef = doc(db, "users", uid);
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
                }
            } catch (error) {
                console.error("Error fetching profile:", error);
                showToast("Failed to load profile", "error");
            }
        };

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                // Reload user to get the latest 'emailVerified' status
                await currentUser.reload();
                setUser(currentUser);

                const isEmailVerified = currentUser.emailVerified || EMAIL_VERIFICATION_ON === "off";
                setIsVerified(isEmailVerified);

                // Only fetch profile if verified (or if verification is disabled)
                if (isEmailVerified) {
                    await fetchProfile(currentUser.uid);
                }
            } else {
                router.push("/auth/signin?returnTo=/player");
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, [router, form, showToast]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        // Basic validation
        if (!file.type.startsWith("image/")) {
            showToast("Please upload an image file", "error");
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            showToast("Image size should be less than 5MB", "error");
            return;
        }

        setUploadingPhoto(true);
        try {
            // Compress image (using canvas for simplicity)
            const compressedFile = await compressImage(file);

            const storageRef = ref(storage, `profile-pictures/${user.uid}`);
            await uploadBytes(storageRef, compressedFile);
            const downloadURL = await getDownloadURL(storageRef);

            setPhotoUrl(downloadURL);

            // Update Firestore immediately with new photo URL
            await updateDoc(doc(db, "users", user.uid), {
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

                    // Max dimensions
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
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error("Canvas to Blob failed"));
                        }
                    }, "image/jpeg", 0.7); // 0.7 quality
                };
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleResendVerification = async () => {
        if (user) {
            try {
                await sendEmailVerification(user);
                showToast("Verification email resent! Check your inbox.", "success");
            } catch (error) {
                console.error("Error sending verification email:", error);
                showToast("Error sending email. Try again later.", "error");
            }
        }
    };

    const onSubmit: SubmitHandler<ProfileFormValues> = async (data) => {
        if (!user) return;
        setSaving(true);
        try {
            await updateDoc(doc(db, "users", user.uid), {
                ...data,
                photoUrl: photoUrl, // Ensure photoUrl is saved
                dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null, // Convert string to Date (Timestamp)
                updatedAt: new Date(),
            });
            showToast("Profile updated successfully!", "success");
        } catch (error) {
            console.error("Error updating profile:", error);
            showToast("Failed to update profile", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    if (!loading && user && !isVerified) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center space-y-6 bg-gray-950 p-4 text-white">
                <div className="flex justify-center mb-4">
                    <Image src="/logo.svg" alt="App Logo" width={80} height={80} priority />
                </div>
                <div className="text-center space-y-2 max-w-md">
                    <h1 className="text-2xl font-bold text-red-500">Email Not Verified</h1>
                    <p className="text-gray-400">
                        Please check your email <strong>{user.email}</strong> to verify your account.
                        You must verify your email to access your profile.
                    </p>
                </div>
                <div className="flex gap-4">
                    <Button onClick={handleResendVerification} variant="outline" className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white">
                        Resend Verification Email
                    </Button>
                    <Button
                        onClick={() => window.location.reload()}
                        className="bg-blue-600 text-white hover:bg-blue-700"
                    >
                        I have verified, Refresh Page
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            {/* Sticky Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push("/dashboard")}>
                        <Image src="/logo.svg" alt="EveryWherePadel Logo" width={32} height={32} className="w-8 h-8" style={{ width: 'auto' }} />
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
                                                        <UserIcon className="h-4 w-4" /> Profile
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

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto space-y-8">
                <Button
                    variant="ghost"
                    onClick={() => router.push("/dashboard")}
                    className="text-gray-400 hover:text-white mb-2 pl-0 hover:bg-transparent"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Dashboard
                </Button>

                <div className="bg-gray-900 shadow-md rounded-xl p-6 sm:p-8 border border-gray-800">
                    <div className="border-b border-gray-800 pb-6 mb-6 text-center">
                        <h1 className="text-2xl font-bold text-white">Player Profile</h1>
                        <p className="mt-1 text-sm text-gray-400">
                            Manage your player information and preferences.
                        </p>
                    </div>

                    <div className="flex flex-col items-center mb-8">
                        <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                            <div className="h-32 w-32 rounded-full overflow-hidden border-4 border-gray-800 shadow-lg bg-gray-800 relative">
                                {photoUrl ? (
                                    <Image
                                        src={photoUrl}
                                        alt="Profile"
                                        fill
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center text-gray-600">
                                        <UserIcon className="h-16 w-16" />
                                    </div>
                                )}
                                {uploadingPhoto && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <Loader2 className="h-8 w-8 animate-spin text-white" />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
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
                        {/* Read-only Fields */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-400">User ID</label>
                                <Input value={user?.uid || ""} disabled className="bg-gray-950 border-gray-800 text-gray-500" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-400">Email</label>
                                <Input value={user?.email || ""} disabled className="bg-gray-950 border-gray-800 text-gray-500" />
                            </div>
                        </div>

                        {/* Personal Info */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Full Name</label>
                                <Input {...form.register("fullName")} placeholder="Enter full name" className="bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500" />
                                {form.formState.errors.fullName && (
                                    <p className="text-sm text-red-400">{form.formState.errors.fullName.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Nickname</label>
                                <Input {...form.register("nickname")} placeholder="Enter nickname" className="bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Phone</label>
                                <Input {...form.register("phone")} placeholder="Enter phone number" className="bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500" />
                                {form.formState.errors.phone && (
                                    <p className="text-sm text-red-400">{form.formState.errors.phone.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Location</label>
                                <Input {...form.register("location")} placeholder="City, Country" className="bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500" />
                            </div>
                        </div>

                        {/* Player Stats */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Gender</label>
                                <Select onValueChange={(val) => form.setValue("gender", val as ProfileFormValues["gender"])} defaultValue={form.getValues("gender")}>
                                    <SelectTrigger className="bg-gray-950 border-gray-800 text-white focus:ring-orange-500">
                                        <SelectValue placeholder="Select gender" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="male">Male</SelectItem>
                                        <SelectItem value="female">Female</SelectItem>
                                    </SelectContent>
                                </Select>
                                {form.formState.errors.gender && (
                                    <p className="text-sm text-red-400">{form.formState.errors.gender.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Skill Level</label>
                                <Select onValueChange={(val) => form.setValue("skillLevel", val as ProfileFormValues["skillLevel"])} defaultValue={form.getValues("skillLevel")}>
                                    <SelectTrigger className="bg-gray-950 border-gray-800 text-white focus:ring-orange-500">
                                        <SelectValue placeholder="Select skill level" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="beginner">Beginner</SelectItem>
                                        <SelectItem value="intermediate">Intermediate</SelectItem>
                                        <SelectItem value="advanced">Advanced</SelectItem>
                                        <SelectItem value="expert">Expert</SelectItem>
                                    </SelectContent>
                                </Select>
                                {form.formState.errors.skillLevel && (
                                    <p className="text-sm text-red-400">{form.formState.errors.skillLevel.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Hand</label>
                                <Select onValueChange={(val) => form.setValue("hand", val as ProfileFormValues["hand"])} defaultValue={form.getValues("hand")}>
                                    <SelectTrigger className="bg-gray-950 border-gray-800 text-white focus:ring-orange-500">
                                        <SelectValue placeholder="Select hand" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="right">Right</SelectItem>
                                        <SelectItem value="left">Left</SelectItem>
                                    </SelectContent>
                                </Select>
                                {form.formState.errors.hand && (
                                    <p className="text-sm text-red-400">{form.formState.errors.hand.message}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Position</label>
                                <Select onValueChange={(val) => form.setValue("position", val as ProfileFormValues["position"])} defaultValue={form.getValues("position")}>
                                    <SelectTrigger className="bg-gray-950 border-gray-800 text-white focus:ring-orange-500">
                                        <SelectValue placeholder="Select position" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="right">Right</SelectItem>
                                        <SelectItem value="left">Left</SelectItem>
                                        <SelectItem value="both">Both</SelectItem>
                                    </SelectContent>
                                </Select>
                                {form.formState.errors.position && (
                                    <p className="text-sm text-red-400">{form.formState.errors.position.message}</p>
                                )}
                            </div>
                        </div>

                        {/* Admin/System Fields */}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 bg-gray-950/50 p-4 rounded-lg border border-gray-800">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Role</label>
                                <Select
                                    onValueChange={(val) => {
                                        form.setValue("role", val as ProfileFormValues["role"]);
                                        // Sync isAdmin based on role
                                        if (val === "admin") {
                                            form.setValue("isAdmin", true);
                                        } else {
                                            form.setValue("isAdmin", false);
                                        }
                                    }}
                                    value={form.watch("role")}
                                >
                                    <SelectTrigger className="bg-gray-900 border-gray-800 text-white focus:ring-orange-500">
                                        <SelectValue placeholder="Select role" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="player">Player</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Registration Status</label>
                                <Select onValueChange={(val) => form.setValue("registrationStatus", val as ProfileFormValues["registrationStatus"])} defaultValue={form.getValues("registrationStatus")}>
                                    <SelectTrigger className="bg-gray-900 border-gray-800 text-white focus:ring-orange-500">
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="pending">Pending</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="isShadow"
                                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-orange-500 focus:ring-orange-500"
                                    {...form.register("isShadow")}
                                />
                                <label htmlFor="isShadow" className="text-sm font-medium text-gray-300">Is Shadow User</label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="isAdmin"
                                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-orange-500 focus:ring-orange-500"
                                    {...form.register("isAdmin", {
                                        onChange: (e) => {
                                            const isChecked = e.target.checked;
                                            // Sync role based on isAdmin
                                            if (isChecked) {
                                                form.setValue("role", "admin");
                                            } else {
                                                form.setValue("role", "player");
                                            }
                                        }
                                    })}
                                    checked={!!form.watch("isAdmin")}
                                />
                                <label htmlFor="isAdmin" className="text-sm font-medium text-gray-300">Is Admin</label>
                            </div>
                        </div>

                        {/* Date of Birth */}
                        <div className="space-y-2">
                            <label htmlFor="dateOfBirth" className="text-sm font-medium text-gray-300">Date of Birth</label>
                            <Input
                                id="dateOfBirth"
                                type="date"
                                {...form.register("dateOfBirth")}
                                className="bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500 scheme-dark"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Notes</label>
                            <Textarea {...form.register("notes")} placeholder="Additional notes..." className="h-24 bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500" />
                        </div>

                        <div className="flex justify-end pt-6">
                            <Button type="submit" size="lg" isLoading={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
                                Save Changes
                            </Button>
                        </div>
                    </form>
                </div>
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

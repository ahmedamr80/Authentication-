"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm, SubmitHandler, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { useToast } from "@/context/ToastContext";

// Icons
import { MapPin, Activity, Loader2, Camera, ArrowLeft, Save } from "lucide-react";

// ----------------------------------------------------------------------
// 1. SHARED TYPES & SCHEMA
// ----------------------------------------------------------------------

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

interface UserProfile {
    uid: string;
    displayName: string;
    photoUrl?: string;
    photoURL?: string;
    fullName?: string;
    bio?: string;
    location?: string;
    skillLevel?: string;
    position?: string;
    hand?: string;
    role?: string;
    createdAt?: { seconds: number; nanoseconds: number };
    nickname?: string;
    dateOfBirth?: { seconds: number; nanoseconds: number } | null;
    // Admin fields
    notes?: string;
    phone?: string;
    gender?: string;
    registrationStatus?: string;
    isShadow?: boolean;
    isAdmin?: boolean;
}

// ----------------------------------------------------------------------
// 2. ADMIN VIEW COMPONENT (Full Edit Access)
// ----------------------------------------------------------------------

function AdminPlayerEditor({ playerId, initialData }: { playerId: string, initialData: UserProfile }) {
    const { showToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [photoUrl, setPhotoUrl] = useState<string | null>(initialData.photoUrl || initialData.photoURL || null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<ProfileFormValues>({
        // Proper typing for resolver
        resolver: zodResolver(profileSchema) as Resolver<ProfileFormValues>,
        defaultValues: {
            fullName: initialData.fullName || initialData.displayName || "",
            // Use type assertion for enums if needed, or validate data beforehand
            gender: (initialData.gender?.toLowerCase() as "male" | "female") || "male",
            phone: initialData.phone || "",
            notes: initialData.notes || "",
            hand: (initialData.hand?.toLowerCase() as "right" | "left") || "right",
            registrationStatus: (initialData.registrationStatus as "active" | "pending") || "pending",
            position: (initialData.position?.toLowerCase() as "right" | "left" | "both") || "right",
            role: (initialData.role as "player" | "admin") || "player",
            skillLevel: (initialData.skillLevel?.toLowerCase() as "beginner" | "intermediate" | "advanced" | "expert") || "beginner",
            nickname: initialData.nickname || "",
            isShadow: initialData.isShadow || false,
            isAdmin: initialData.isAdmin || false,
            location: initialData.location || "",
            dateOfBirth: initialData.dateOfBirth ? new Date(initialData.dateOfBirth.seconds * 1000).toISOString().split('T')[0] : "",
        },
    });

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingPhoto(true);
        try {
            const storageRef = ref(storage, `profile-pictures/${playerId}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            setPhotoUrl(downloadURL);
            await updateDoc(doc(db, "users", playerId), { photoUrl: downloadURL });
            showToast("Photo updated", "success");
        } catch (error) {
            console.error(error);
            showToast("Failed to upload image", "error");
        } finally {
            setUploadingPhoto(false);
        }
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
            showToast("Player updated successfully!", "success");
        } catch (error) {
            console.error(error);
            showToast("Failed to update profile", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="bg-gray-900 shadow-md rounded-xl p-6 sm:p-8 border border-gray-800">
                <div className="border-b border-gray-800 pb-6 mb-6 text-center">
                    <h1 className="text-2xl font-bold text-white">Admin Editor</h1>
                    <p className="mt-1 text-sm text-gray-400">You have full edit access to this player.</p>
                </div>

                <div className="flex flex-col items-center mb-8">
                    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        <Avatar className="h-32 w-32 border-4 border-gray-800 shadow-lg">
                            <AvatarImage src={photoUrl || undefined} />
                            <AvatarFallback className="bg-gray-800 text-3xl">{initialData.displayName?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center rounded-full">
                            <Camera className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    </div>
                    {uploadingPhoto && <Loader2 className="h-6 w-6 animate-spin text-orange-500 mt-2" />}
                </div>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Full Name</label>
                            <Input {...form.register("fullName")} className="bg-gray-950 border-gray-800 text-white" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Phone</label>
                            <Input {...form.register("phone")} className="bg-gray-950 border-gray-800 text-white" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Location</label>
                            <Input {...form.register("location")} className="bg-gray-950 border-gray-800 text-white" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Date of Birth</label>
                            <Input type="date" {...form.register("dateOfBirth")} className="bg-gray-950 border-gray-800 text-white scheme-dark" />
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Skill Level</label>
                            <Select onValueChange={(val) => form.setValue("skillLevel", val as "beginner" | "intermediate" | "advanced" | "expert")} defaultValue={form.getValues("skillLevel")}>
                                <SelectTrigger className="bg-gray-950 border-gray-800 text-white"><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                    <SelectItem value="beginner">Beginner</SelectItem>
                                    <SelectItem value="intermediate">Intermediate</SelectItem>
                                    <SelectItem value="advanced">Advanced</SelectItem>
                                    <SelectItem value="expert">Expert</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Position</label>
                            <Select onValueChange={(val) => form.setValue("position", val as "right" | "left" | "both")} defaultValue={form.getValues("position")}>
                                <SelectTrigger className="bg-gray-950 border-gray-800 text-white"><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                    <SelectItem value="right">Right</SelectItem>
                                    <SelectItem value="left">Left</SelectItem>
                                    <SelectItem value="both">Both</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Admin Only Fields */}
                    <div className="bg-gray-950/50 p-4 rounded-lg border border-orange-900/30">
                        <h3 className="text-sm font-bold text-orange-500 mb-4">System Settings</h3>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Role</label>
                                <Select onValueChange={(val) => {
                                    form.setValue("role", val as "player" | "admin");
                                    form.setValue("isAdmin", val === "admin");
                                }} defaultValue={form.getValues("role")}>
                                    <SelectTrigger className="bg-gray-900 border-gray-800 text-white"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="player">Player</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Status</label>
                                <Select onValueChange={(val) => form.setValue("registrationStatus", val as "active" | "pending")} defaultValue={form.getValues("registrationStatus")}>
                                    <SelectTrigger className="bg-gray-900 border-gray-800 text-white"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-gray-900 border-gray-800 text-white">
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="pending">Pending</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input type="checkbox" className="h-4 w-4 rounded bg-gray-900 border-gray-700" {...form.register("isShadow")} />
                                <label className="text-sm text-gray-300">Is Shadow User</label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input type="checkbox" className="h-4 w-4 rounded bg-gray-900 border-gray-700" {...form.register("isAdmin")} />
                                <label className="text-sm text-gray-300">Is Admin</label>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Private Notes (Admin Only)</label>
                        <Textarea {...form.register("notes")} className="h-24 bg-gray-950 border-gray-800 text-white" />
                    </div>

                    <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                        Save Changes
                    </Button>
                </form>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------
// 3. PUBLIC VIEW COMPONENT (Read Only)
// ----------------------------------------------------------------------

function PublicPlayerView({ profile }: { profile: UserProfile }) {
    // Format Joined Date
    const joinedDate = profile?.createdAt
        ? new Date(profile.createdAt.seconds * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
        : "N/A";

    // Calculate Age
    let age = "N/A";
    if (profile?.dateOfBirth) {
        const birthDate = new Date(profile.dateOfBirth.seconds * 1000);
        const today = new Date();
        let calculatedAge = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            calculatedAge--;
        }
        age = calculatedAge.toString();
    }

    return (
        <div className="bg-gray-900 shadow-xl rounded-2xl overflow-hidden border border-gray-800">
            {/* Cover Banner */}
            <div className="h-32 bg-linear-to-r from-orange-600 to-orange-400 opacity-20 relative">
                <div className="absolute inset-0 bg-[url('/noise.png')] opacity-20"></div>
            </div>

            <div className="px-8 pb-8">
                <div className="relative -mt-16 mb-6 flex justify-between items-end">
                    <Avatar className="h-32 w-32 border-4 border-gray-900 shadow-2xl">
                        <AvatarImage src={profile.photoUrl || profile.photoURL} />
                        <AvatarFallback className="bg-orange-500 text-3xl font-bold text-white">
                            {(profile.displayName || profile.fullName || "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <Badge className="mb-4 bg-gray-800 hover:bg-gray-700 text-orange-500 border-orange-500/20">
                        {profile.role === 'admin' ? 'Admin' : 'Player'}
                    </Badge>
                </div>

                <div className="space-y-6">
                    <div>
                        <h1 className="text-3xl font-bold text-white">
                            {profile.displayName || profile.fullName || "Unknown Player"}
                        </h1>
                        {profile.nickname && (
                            <p className="text-lg text-gray-400">&quot;{profile.nickname}&quot;</p>
                        )}
                        {profile.location && (
                            <div className="flex items-center text-gray-500 mt-2 text-sm">
                                <MapPin className="w-4 h-4 mr-1" />
                                {profile.location}
                            </div>
                        )}
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 py-6 border-y border-gray-800">
                        <div className="space-y-1">
                            <span className="text-xs text-gray-500 uppercase tracking-wider">Skill Level</span>
                            <p className="font-semibold text-orange-400 capitalize">{profile.skillLevel || "N/A"}</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-gray-500 uppercase tracking-wider">Position</span>
                            <p className="font-semibold text-gray-300 capitalize">{profile.position || "N/A"}</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-gray-500 uppercase tracking-wider">Hand</span>
                            <p className="font-semibold text-gray-300 capitalize">{profile.hand || "N/A"}</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-gray-500 uppercase tracking-wider">Age</span>
                            <p className="font-semibold text-gray-300 capitalize">{age}</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-gray-500 uppercase tracking-wider">Joined</span>
                            <p className="font-semibold text-gray-300">
                                {joinedDate}
                            </p>
                        </div>
                    </div>

                    {/* Bio */}
                    {profile.bio && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium text-white flex items-center gap-2">
                                <Activity className="w-4 h-4 text-orange-500" />
                                About
                            </h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                {profile.bio}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------
// 4. MAIN PAGE CONTROLLER
// ----------------------------------------------------------------------

export default function PublicProfilePage() {
    const params = useParams();
    const router = useRouter();
    const playerId = params.playerId as string;

    // Get Admin status from AuthContext
    const { user, isAdmin } = useAuth();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const docRef = doc(db, "users", playerId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    setProfile(docSnap.data() as UserProfile);
                } else {
                    setProfile(null);
                }
            } catch (error) {
                console.error("Error fetching profile:", error);
            } finally {
                setLoading(false);
            }
        };

        if (playerId) {
            fetchProfile();
        }
    }, [playerId]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white space-y-4">
                <Header user={user} showBack={true} />
                <h1 className="text-2xl font-bold">Player Not Found</h1>
                <Button onClick={() => router.push("/community")} variant="outline">
                    Back to Community
                </Button>
                <BottomNav />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            <Header user={user} showBack={true} onBack={() => router.push("/community")} />

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto space-y-8">
                <Button
                    variant="ghost"
                    onClick={() => router.push("/community")}
                    className="text-gray-400 hover:text-white mb-2 pl-0 hover:bg-transparent"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Community
                </Button>

                {/* Conditional Rendering based on Role */}
                {isAdmin ? (
                    <AdminPlayerEditor playerId={playerId} initialData={profile} />
                ) : (
                    <PublicPlayerView profile={profile} />
                )}
            </main>
            <BottomNav />
        </div>
    );
}
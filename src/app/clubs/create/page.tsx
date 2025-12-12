"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";

// Icons
import { Loader2, Save, Building2, MapPin, Phone, Camera, Info } from "lucide-react";
import Image from "next/image";

// 1. Zod Schema Validation
const clubSchema = z.object({
    name: z.string().min(2, "Club Name is required"),
    address: z.string().min(5, "Address is required"),
    lat: z.string().min(1, "Latitude is required").refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= -90 && parseFloat(val) <= 90, "Invalid Latitude"),
    lng: z.string().min(1, "Longitude is required").refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= -180 && parseFloat(val) <= 180, "Invalid Longitude"),
    phone: z.string().min(5, "Phone number is required"),
    notes: z.string().optional(),
});

type ClubFormValues = z.infer<typeof clubSchema>;

export default function CreateClubPage() {
    const router = useRouter();
    const { user, isAdmin, loading: authLoading } = useAuth();
    const { showToast } = useToast();

    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [pictureUrl, setPictureUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<ClubFormValues>({
        resolver: zodResolver(clubSchema),
        defaultValues: {
            name: "",
            address: "",
            lat: "24.4539", // Default to approx Abu Dhabi
            lng: "54.3773",
            phone: "",
            notes: "",
        },
    });

    // 2. Admin Protection Guard
    useEffect(() => {
        if (!authLoading && !isAdmin) {
            showToast("Access Denied: Admins only.", "error");
            router.push("/clubs");
        }
    }, [isAdmin, authLoading, router, showToast]);

    // 3. Image Upload Logic
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
            const tempId = `club-${Date.now()}`;
            const storageRef = ref(storage, `club-pictures/${tempId}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            setPictureUrl(downloadURL);
            showToast("Club image uploaded!", "success");
        } catch (error) {
            console.error("Upload error:", error);
            showToast("Failed to upload image", "error");
        } finally {
            setUploadingPhoto(false);
        }
    };

    // 4. Form Submission Logic
    const onSubmit: SubmitHandler<ClubFormValues> = async (data) => {
        if (!pictureUrl) {
            showToast("Please upload a club image", "error");
            return;
        }

        setSaving(true);
        try {
            // Construct the exact data structure requested
            const clubData = {
                name: data.name,
                location: {
                    address: data.address,
                    coordinates: {
                        lat: parseFloat(data.lat),
                        lng: parseFloat(data.lng)
                    }
                },
                phone: data.phone,
                notes: data.notes || null,
                pictureUrl: pictureUrl,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

            await addDoc(collection(db, "clubs"), clubData);

            showToast("Club created successfully!", "success");
            router.push("/clubs");
        } catch (error) {
            console.error("Error creating club:", error);
            showToast("Failed to create club", "error");
        } finally {
            setSaving(false);
        }
    };

    if (authLoading || !isAdmin) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            {/* Standardized Header */}
            <Header user={user} showBack={true} onBack={() => router.back()} />

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8">
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-orange-500/10 rounded-full border border-orange-500/20">
                        <Building2 className="w-8 h-8 text-orange-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white">Add New Club</h1>
                        <p className="text-gray-400">Register a new venue for Padel events</p>
                    </div>
                </div>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* Image Upload Section */}
                    <Card className="bg-gray-900/60 backdrop-blur-xl border-gray-800">
                        <CardHeader>
                            <CardTitle className="text-white">Club Image</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col items-center sm:items-start">
                                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <div className="h-48 w-full sm:w-80 rounded-xl overflow-hidden border-2 border-gray-800 bg-gray-950 relative">
                                        {pictureUrl ? (
                                            <Image
                                                src={pictureUrl}
                                                alt="Club Preview"
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="h-full w-full flex flex-col items-center justify-center text-gray-600 gap-2">
                                                <Camera className="h-12 w-12" />
                                                <span className="text-sm">Click to upload photo</span>
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
                            </div>
                        </CardContent>
                    </Card>

                    {/* Details Section */}
                    <Card className="bg-gray-900/60 backdrop-blur-xl border-gray-800">
                        <CardHeader>
                            <CardTitle className="text-white">Club Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-gray-300">Club Name *</Label>
                                <div className="relative">
                                    <Building2 className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                    <Input
                                        id="name"
                                        {...form.register("name")}
                                        placeholder="e.g. Zayed Sports City"
                                        className="pl-10 bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-600"
                                    />
                                </div>
                                {form.formState.errors.name && <p className="text-sm text-red-400">{form.formState.errors.name.message}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-gray-300">Phone Number *</Label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                    <Input
                                        id="phone"
                                        {...form.register("phone")}
                                        placeholder="+971 50 000 0000"
                                        className="pl-10 bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-600"
                                    />
                                </div>
                                {form.formState.errors.phone && <p className="text-sm text-red-400">{form.formState.errors.phone.message}</p>}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="address" className="text-gray-300">Address *</Label>
                                    <div className="relative">
                                        <MapPin className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                        <Input
                                            id="address"
                                            {...form.register("address")}
                                            placeholder="Street Name, Area"
                                            className="pl-10 bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-600"
                                        />
                                    </div>
                                    {form.formState.errors.address && <p className="text-sm text-red-400">{form.formState.errors.address.message}</p>}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="lat" className="text-gray-300">Latitude</Label>
                                        <Input
                                            id="lat"
                                            type="number"
                                            step="any"
                                            {...form.register("lat")}
                                            className="bg-gray-950/50 border-gray-800 text-white"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="lng" className="text-gray-300">Longitude</Label>
                                        <Input
                                            id="lng"
                                            type="number"
                                            step="any"
                                            {...form.register("lng")}
                                            className="bg-gray-950/50 border-gray-800 text-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="notes" className="text-gray-300">Notes (Optional)</Label>
                                <div className="relative">
                                    <Info className="absolute left-3 top-3 h-5 w-5 text-gray-500" />
                                    <Textarea
                                        id="notes"
                                        {...form.register("notes")}
                                        placeholder="Any additional info..."
                                        className="pl-10 min-h-[100px] bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-600"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end gap-4 pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => router.back()}
                            className="border-gray-700 text-gray-300 hover:bg-gray-800"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={saving || uploadingPhoto}
                            className="bg-orange-500 hover:bg-orange-600 text-white min-w-[140px]"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <Save className="w-4 h-4 mr-2" />
                                    Create Club
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </main>

            {/* Standardized Footer */}
            <BottomNav />
        </div>
    );
}
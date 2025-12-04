"use client";

import { useState, useEffect } from "react";
import { collection, doc, runTransaction, Timestamp, query, orderBy, getDocs } from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Loader2, Save, ArrowLeft, Camera, MapPin, Calendar, Home, LogOut, Settings, User as UserIcon } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Image from "next/image";
import Link from "next/link";

interface CreateEventFormData {
    eventName: string;
    locationName: string;
    clubId: string | null;
    dateTime: string;
    duration: number;
    unitType: "Players" | "Teams";
    isPublic: boolean;
    isTeamRegistration: boolean;
    slotsAvailable: number;
    pricePerPlayer: number;
    termsAndConditions: string;
    logoUrl: string;
    coordinates: { lat: number; lng: number } | null;
}

export default function CreateEventPage() {
    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const { showToast } = useToast();
    const router = useRouter();
    const { user } = useAuth();
    // 1. Calculate Date: Today + 7 Days
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 7);
    defaultDate.setHours(18, 0, 0, 0); // Optional: Defaults to 6:00 PM
    // Adjust for timezone offset to ensure it shows local time, not UTC
    const offset = defaultDate.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(defaultDate.getTime() - offset)).toISOString().slice(0, 16);
    const [formData, setFormData] = useState<CreateEventFormData>({
        eventName: "Padel Games",
        locationName: "",
        clubId: null,
        dateTime: localISOTime, // <--- Set to next week,
        duration: 60,
        unitType: "Players",
        isPublic: true,
        isTeamRegistration: false,
        slotsAvailable: 8,
        pricePerPlayer: 75,
        termsAndConditions: `• Registration: Teams are preferred, but individuals may register.
• Payment: Required at least 24 hours in advance. Unpaid slots may be forfeited.
• Cancellation: No refunds for cancellations made within 24 hours.
• Substitutions: Allowed (participants arrange reimbursement privately).
• Rules & Fees: Official tournament rules apply. Prices vary by venue.`,
        logoUrl: "https://firebasestorage.googleapis.com/v0/b/db-padel-reg.firebasestorage.app/o/events%2F1761906495228_IMG_8759.png?alt=media&token=558e21b5-f050-4d42-ba10-74fa69ce2755",
        coordinates: null,
    });

    const [clubs, setClubs] = useState<{ id: string; name: string; location?: { coordinates?: { lat: number; lng: number } } }[]>([]);
    const [loadingClubs, setLoadingClubs] = useState(true);

    useEffect(() => {
        const fetchClubs = async () => {
            try {
                const clubsRef = collection(db, "clubs");
                const q = query(clubsRef, orderBy("name"));
                const querySnapshot = await getDocs(q);
                const clubsList = querySnapshot.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name,
                    location: doc.data().location
                }));
                setClubs(clubsList);
            } catch (error) {
                console.error("Error fetching clubs:", error);
            } finally {
                setLoadingClubs(false);
            }
        };
        fetchClubs();
    }, []);

    const isValidUrl = (url: string) => {
        try {
            new URL(url);
            return url.startsWith("http://") || url.startsWith("https://");
        } catch {
            return false;
        }
    };

    const handleInputChange = (field: keyof CreateEventFormData, value: CreateEventFormData[keyof CreateEventFormData]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

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
            const tempId = `temp-${Date.now()}`;
            const storageRef = ref(storage, `events/${tempId}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            handleInputChange("logoUrl", downloadURL);
            showToast("Logo uploaded successfully!", "success");
        } catch (error) {
            console.error("Error uploading image:", error);
            showToast("Failed to upload image", "error");
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleCreate = async () => {
        if (!formData.eventName.trim()) {
            showToast("Please enter an event name", "error");
            return;
        }
        if (!formData.dateTime) {
            showToast("Please select a date and time", "error");
            return;
        }
        if (!formData.locationName.trim() && !formData.clubId) {
            showToast("Please select a location", "error");
            return;
        }

        setSaving(true);
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                showToast("You must be logged in to create an event", "error");
                router.push("/auth/signin");
                return;
            }

            const eventData = {
                eventName: formData.eventName.trim(),
                locationName: formData.locationName.trim(),
                clubId: formData.clubId,
                dateTime: Timestamp.fromDate(new Date(formData.dateTime)),
                duration: formData.duration,
                unitType: formData.unitType,
                isPublic: formData.isPublic,
                isTeamRegistration: formData.isTeamRegistration,
                slotsAvailable: formData.slotsAvailable,
                pricePerPlayer: formData.pricePerPlayer,
                termsAndConditions: formData.termsAndConditions.trim(),
                logoUrl: formData.logoUrl,
                coordinates: formData.coordinates,
                adminId: currentUser.uid,
                status: "Upcoming",
                createdAt: Timestamp.now(),
            };

            let newEventId = "";

            await runTransaction(db, async (transaction) => {
                const counterRef = doc(db, "counters", "events");
                const counterDoc = await transaction.get(counterRef);

                if (!counterDoc.exists()) {
                    throw new Error("Counter document does not exist!");
                }

                const lastIndex = counterDoc.data().lastIndex || 0;
                const newIndex = lastIndex + 1;

                newEventId = `EVENT${String(newIndex).padStart(3, '0')}`;

                const eventRef = doc(db, "events", newEventId);

                transaction.set(eventRef, {
                    ...eventData,
                    eventId: newEventId
                });

                transaction.update(counterRef, { lastIndex: newIndex });
            });

            showToast("Event created successfully!", "success");
            router.push(`/events/${newEventId}`);
        } catch (error) {
            console.error("Error creating event:", error);
            showToast("Failed to create event", "error");
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

    const getDefaultDateTime = () => {
        const now = new Date();
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offset).toISOString().slice(0, 16);
    };

    useEffect(() => {
        if (!formData.dateTime) {
            setFormData(prev => ({ ...prev, dateTime: getDefaultDateTime() }));
        }
    }, [formData.dateTime]);

    return (
        <div className="min-h-screen bg-black text-white pb-24 relative">
            {/* Background Gradient */}
            <div className="fixed inset-0 z-0 bg-linear-to-b from-gray-900 via-black to-black" />

            {/* Sticky Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-gray-800">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-gray-400 hover:text-white hover:bg-gray-800/50"
                            onClick={() => router.back()}
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Button>

                        {/* Logo */}
                        <div
                            className="flex items-center gap-2 cursor-pointer"
                            onClick={() => router.push("/dashboard")}
                        >
                            <Image
                                src="/logo.svg"
                                alt="EWP"
                                width={32}
                                height={32}
                                className="w-8 h-8"
                                style={{ width: 'auto' }}
                            />
                            <span className="font-bold text-xl tracking-tighter text-white">EveryWherePadel</span>
                        </div>
                    </div>

                    {/* User Menu */}
                    <div className="relative">
                        {user ? (
                            <div className="flex items-center gap-4">
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

            {/* Main Content */}
            <div className="container mx-auto px-4 pt-24 relative z-10 max-w-4xl">
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-orange-500/10 rounded-full">
                        <Calendar className="w-8 h-8 text-orange-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white">Create New Event</h1>
                        <p className="text-gray-400">Fill in the details to create a new padel event</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <Card className="bg-gray-900/60 backdrop-blur-xl border-gray-800">
                        <CardHeader>
                            <CardTitle className="text-white">General Information</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="eventName" className="text-gray-300">Event Name *</Label>
                                    <Input
                                        id="eventName"
                                        value={formData.eventName}
                                        onChange={(e) => handleInputChange("eventName", e.target.value)}
                                        placeholder="Friday Night Padel"
                                        className="bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-500"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="dateTime" className="text-gray-300">Date & Time *</Label>
                                    <Input
                                        id="dateTime"
                                        type="datetime-local"
                                        value={formData.dateTime}
                                        onChange={(e) => handleInputChange("dateTime", e.target.value)}
                                        className="bg-gray-950/50 border-gray-800 text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="duration" className="text-gray-300">Duration (minutes)</Label>
                                    <Input
                                        id="duration"
                                        type="number"
                                        value={formData.duration}
                                        onChange={(e) => handleInputChange("duration", parseInt(e.target.value) || 60)}
                                        min={15}
                                        step={15}
                                        className="bg-gray-950/50 border-gray-800 text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="location" className="text-gray-300">Location *</Label>
                                    {loadingClubs ? (
                                        <div className="flex items-center space-x-2 text-sm text-gray-500">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Loading clubs...</span>
                                        </div>
                                    ) : (
                                        <Select
                                            value={formData.clubId || "custom"}
                                            onValueChange={(value) => {
                                                if (value === "custom") {
                                                    handleInputChange("clubId", null);
                                                    handleInputChange("locationName", "");
                                                    handleInputChange("coordinates", null);
                                                } else {
                                                    const selectedClub = clubs.find(c => c.id === value);
                                                    if (selectedClub) {
                                                        handleInputChange("clubId", value);
                                                        handleInputChange("locationName", selectedClub.name);
                                                        if (selectedClub.location?.coordinates) {
                                                            handleInputChange("coordinates", selectedClub.location.coordinates);
                                                        }
                                                    }
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="bg-gray-950/50 border-gray-800 text-white">
                                                <SelectValue placeholder="Select a club" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-gray-900 border-gray-800">
                                                <SelectItem value="custom">Custom Location</SelectItem>
                                                {clubs.map((club) => (
                                                    <SelectItem key={club.id} value={club.id}>
                                                        {club.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {(!formData.clubId || formData.clubId === "custom") && (
                                        <Input
                                            id="locationName"
                                            value={formData.locationName}
                                            onChange={(e) => handleInputChange("locationName", e.target.value)}
                                            placeholder="Enter location name"
                                            className="mt-2 bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-500"
                                        />
                                    )}
                                    {formData.locationName && (
                                        <div className="pt-1">
                                            <a
                                                href={formData.coordinates
                                                    ? `https://www.google.com/maps/search/?api=1&query=${formData.coordinates.lat},${formData.coordinates.lng}`
                                                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formData.locationName)}`
                                                }
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-orange-400 hover:underline flex items-center"
                                            >
                                                <MapPin className="w-3 h-3 mr-1" />
                                                View on Google Maps
                                            </a>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="price" className="text-gray-300">Price Per Player (AED)</Label>
                                    <Input
                                        id="price"
                                        type="number"
                                        value={formData.pricePerPlayer}
                                        onChange={(e) => handleInputChange("pricePerPlayer", parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={5}
                                        className="bg-gray-950/50 border-gray-800 text-white"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-gray-300">Event Logo</Label>
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col items-center sm:items-start">
                                        <div className="relative group cursor-pointer" onClick={() => document.getElementById('logo-upload')?.click()}>
                                            <div className="h-32 w-32 rounded-lg overflow-hidden border-2 border-gray-800 bg-gray-950 relative">
                                                {formData.logoUrl && isValidUrl(formData.logoUrl) ? (
                                                    <Image
                                                        src={formData.logoUrl}
                                                        alt="Event Logo"
                                                        fill
                                                        className="object-cover"
                                                    />
                                                ) : (
                                                    <div className="h-full w-full flex items-center justify-center text-gray-600">
                                                        <Camera className="h-12 w-12" />
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
                                                id="logo-upload"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={handleImageUpload}
                                            />
                                        </div>
                                        <p className="mt-2 text-sm text-gray-500">Click to upload event logo</p>
                                    </div>

                                    <div className="space-y-1">
                                        <Label htmlFor="logoUrlInput" className="text-xs text-gray-500">Or enter Image URL</Label>
                                        <Input
                                            id="logoUrlInput"
                                            placeholder="https://example.com/image.jpg"
                                            value={formData.logoUrl}
                                            onChange={(e) => handleInputChange("logoUrl", e.target.value)}
                                            className={`bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-500 ${formData.logoUrl && !isValidUrl(formData.logoUrl) ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                        />
                                        {formData.logoUrl && !isValidUrl(formData.logoUrl) && (
                                            <p className="text-xs text-red-500">Please enter a valid URL (starting with http:// or https://)</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gray-900/60 backdrop-blur-xl border-gray-800">
                        <CardHeader>
                            <CardTitle className="text-white">Registration & Settings</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="slots" className="text-gray-300">Slots Available</Label>
                                    <Input
                                        id="slots"
                                        type="number"
                                        value={formData.slotsAvailable}
                                        onChange={(e) => handleInputChange("slotsAvailable", parseInt(e.target.value) || 0)}
                                        min={1}
                                        className="bg-gray-950/50 border-gray-800 text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="unitType" className="text-gray-300">Unit Type</Label>
                                    <Select
                                        value={formData.unitType}
                                        onValueChange={(value) => handleInputChange("unitType", value)}
                                    >
                                        <SelectTrigger className="bg-gray-950/50 border-gray-800 text-white">
                                            <SelectValue placeholder="Select unit type" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-gray-900 border-gray-800">
                                            <SelectItem value="Players">Players</SelectItem>
                                            <SelectItem value="Teams">Teams</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-6 py-2">
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="isPublic"
                                        checked={formData.isPublic}
                                        onCheckedChange={(checked) => handleInputChange("isPublic", checked)}
                                    />
                                    <Label htmlFor="isPublic" className="text-gray-300">Public Event</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="isTeamRegistration"
                                        checked={formData.isTeamRegistration}
                                        onCheckedChange={(checked) => handleInputChange("isTeamRegistration", checked)}
                                    />
                                    <Label htmlFor="isTeamRegistration" className="text-gray-300">Team Registration</Label>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gray-900/60 backdrop-blur-xl border-gray-800">
                        <CardHeader>
                            <CardTitle className="text-white">Additional Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <Label htmlFor="terms" className="text-gray-300">Terms & Conditions</Label>
                                <Textarea
                                    id="terms"
                                    rows={4}
                                    value={formData.termsAndConditions}
                                    onChange={(e) => handleInputChange("termsAndConditions", e.target.value)}
                                    placeholder="Enter any terms, rules, or conditions for the event..."
                                    className="bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-500"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end gap-4 pt-4 pb-8">
                        <Button
                            variant="outline"
                            onClick={() => router.push("/events")}
                            className="border-gray-700 text-gray-300 hover:bg-gray-800"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreate}
                            disabled={saving}
                            className="bg-orange-500 hover:bg-orange-600 text-white"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <Save className="w-4 h-4 mr-2" />
                                    Create Event
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Sticky Bottom Nav */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-md border-t border-gray-800 px-6 py-3">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <Link href="/dashboard" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Home className="w-6 h-6" />
                        <span className="text-xs font-medium">Home</span>
                    </Link>
                    <Link href="/events" className="flex flex-col items-center gap-1 text-orange-500">
                        <Calendar className="w-6 h-6" />
                        <span className="text-xs font-medium">Events</span>
                    </Link>
                    <Link href="/community" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <UserIcon className="w-6 h-6" />
                        <span className="text-xs font-medium">Community</span>
                    </Link>
                </div>
            </nav>
        </div>
    );
}

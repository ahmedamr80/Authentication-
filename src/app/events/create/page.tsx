"use client";

import { useState, useEffect } from "react";
import { collection, doc, runTransaction, Timestamp, query, orderBy, getDocs } from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Loader2, Save, ArrowLeft, Camera, MapPin, Calendar } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    const { showToast } = useToast();
    const router = useRouter();

    const [formData, setFormData] = useState<CreateEventFormData>({
        eventName: "",
        locationName: "",
        clubId: null,
        dateTime: "",
        duration: 60,
        unitType: "Players",
        isPublic: true,
        isTeamRegistration: false,
        slotsAvailable: 8,
        pricePerPlayer: 0,
        termsAndConditions: "",
        logoUrl: "",
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
        } catch (e) {
            return false;
        }
    };

    const handleInputChange = (field: keyof CreateEventFormData, value: any) => {
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
            const user = auth.currentUser;
            if (!user) {
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
                adminId: user.uid,
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

                // Format: EVENT010
                newEventId = `EVENT${String(newIndex).padStart(3, '0')}`;

                const eventRef = doc(db, "events", newEventId);

                // Add the custom eventId to the data as well
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
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => router.push("/events")}
                        className="text-gray-600 hover:text-gray-900"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Events
                    </Button>

                    <Link href="/" className="flex items-center">
                        <Image
                            src="/logo.svg"
                            alt="Logo"
                            width={48}
                            height={48}
                            className="h-12 w-auto"
                        />
                    </Link>
                </div>

                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-100 rounded-full">
                        <Calendar className="w-8 h-8 text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Create New Event</h1>
                        <p className="text-gray-600">Fill in the details to create a new padel event</p>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>General Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="eventName">Event Name *</Label>
                                <Input
                                    id="eventName"
                                    value={formData.eventName}
                                    onChange={(e) => handleInputChange("eventName", e.target.value)}
                                    placeholder="Friday Night Padel"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="dateTime">Date & Time *</Label>
                                <Input
                                    id="dateTime"
                                    type="datetime-local"
                                    value={formData.dateTime}
                                    onChange={(e) => handleInputChange("dateTime", e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="duration">Duration (minutes)</Label>
                                <Input
                                    id="duration"
                                    type="number"
                                    value={formData.duration}
                                    onChange={(e) => handleInputChange("duration", parseInt(e.target.value) || 60)}
                                    min={15}
                                    step={15}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="location">Location *</Label>
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
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a club" />
                                        </SelectTrigger>
                                        <SelectContent>
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
                                        className="mt-2"
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
                                            className="text-xs text-blue-600 hover:underline flex items-center"
                                        >
                                            <MapPin className="w-3 h-3 mr-1" />
                                            View on Google Maps
                                        </a>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="price">Price Per Player (AED)</Label>
                                <Input
                                    id="price"
                                    type="number"
                                    value={formData.pricePerPlayer}
                                    onChange={(e) => handleInputChange("pricePerPlayer", parseFloat(e.target.value) || 0)}
                                    min={0}
                                    step={5}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Event Logo</Label>
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col items-center sm:items-start">
                                    <div className="relative group cursor-pointer" onClick={() => document.getElementById('logo-upload')?.click()}>
                                        <div className="h-32 w-32 rounded-lg overflow-hidden border-2 border-gray-200 bg-gray-100 relative">
                                            {formData.logoUrl && isValidUrl(formData.logoUrl) ? (
                                                <Image
                                                    src={formData.logoUrl}
                                                    alt="Event Logo"
                                                    fill
                                                    className="object-cover"
                                                />
                                            ) : (
                                                <div className="h-full w-full flex items-center justify-center text-gray-400">
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
                                        className={formData.logoUrl && !isValidUrl(formData.logoUrl) ? "border-red-500 focus-visible:ring-red-500" : ""}
                                    />
                                    {formData.logoUrl && !isValidUrl(formData.logoUrl) && (
                                        <p className="text-xs text-red-500">Please enter a valid URL (starting with http:// or https://)</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Registration & Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="slots">Slots Available</Label>
                                <Input
                                    id="slots"
                                    type="number"
                                    value={formData.slotsAvailable}
                                    onChange={(e) => handleInputChange("slotsAvailable", parseInt(e.target.value) || 0)}
                                    min={1}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unitType">Unit Type</Label>
                                <Select
                                    value={formData.unitType}
                                    onValueChange={(value) => handleInputChange("unitType", value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select unit type" />
                                    </SelectTrigger>
                                    <SelectContent>
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
                                <Label htmlFor="isPublic">Public Event</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="isTeamRegistration"
                                    checked={formData.isTeamRegistration}
                                    onCheckedChange={(checked) => handleInputChange("isTeamRegistration", checked)}
                                />
                                <Label htmlFor="isTeamRegistration">Team Registration</Label>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Additional Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <Label htmlFor="terms">Terms & Conditions</Label>
                            <Textarea
                                id="terms"
                                rows={4}
                                value={formData.termsAndConditions}
                                onChange={(e) => handleInputChange("termsAndConditions", e.target.value)}
                                placeholder="Enter any terms, rules, or conditions for the event..."
                            />
                        </div>
                    </CardContent>
                </Card>

                <div className="flex justify-end gap-4 pt-4">
                    <Button
                        variant="outline"
                        onClick={() => router.push("/events")}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={saving}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
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
    );
}

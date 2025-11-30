"use client";

import { useEffect, useState, use } from "react";
import { doc, getDoc, updateDoc, Timestamp, collection, query, orderBy, getDocs } from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebase"; // Ensure storage is imported
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { EventData } from "@/components/EventCard";
import { Loader2, Save, ArrowLeft, Camera, MapPin } from "lucide-react"; // Add MapPin
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Image from "next/image"; // Add Image

// Helper to calculate status
const calculateStatus = (event: EventData): string => {
    if (event.cancellationMessage) return "Cancelled";

    const now = new Date();
    const eventDate = event.dateTime.toDate();
    const endDate = new Date(eventDate.getTime() + event.duration * 60000);

    if (now < eventDate) return "Upcoming";
    if (now >= eventDate && now < endDate) return "Active";
    return "Past";
};

export default function EventDetailsPage({ params }: { params: Promise<{ eventId: string }> }) {
    const { eventId } = use(params);
    const [event, setEvent] = useState<EventData | null>(null);
    const [creatorName, setCreatorName] = useState<string>("Loading...");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false); // Add uploading state
    const { showToast } = useToast();
    const router = useRouter();

    // Form state
    const [formData, setFormData] = useState<Partial<EventData>>({
        eventName: "",
        locationName: "",
        unitType: "Players", // Default value
        isPublic: false,     // Default value
        isTeamRegistration: false, // Default value
        slotsAvailable: 0,
        pricePerPlayer: 0,
        duration: 60, // Default duration
        cancellationMessage: "",
        termsAndConditions: "",
        logoUrl: ""
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

    useEffect(() => {
        const fetchEvent = async () => {
            try {
                const docRef = doc(db, "events", eventId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data() as EventData;
                    // Ensure eventId is set from doc ID if not in data
                    const eventData = { ...data, eventId: docSnap.id };
                    setEvent(eventData);
                    setFormData(eventData);

                    // Fetch creator name
                    if (data.adminId) {
                        const userRef = doc(db, "users", data.adminId);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            setCreatorName(userSnap.data().fullName || "Unknown User");
                        } else {
                            setCreatorName("Unknown User");
                        }
                    }
                } else {
                    showToast("Event not found.", "error");
                    router.push("/events");
                }
            } catch (error) {
                console.error("Error fetching event:", error);
                showToast("Failed to load event.", "error");
            } finally {
                setLoading(false);
            }
        };

        fetchEvent();
    }, [eventId, router, showToast]);

    const handleInputChange = (field: keyof EventData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

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
            // Create a reference to 'event-logos/eventId'
            // We use eventId to organize files. 
            // Note: This overwrites the previous logo for this event if it exists, which saves space.
            const storageRef = ref(storage, `events/${eventId}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            // Update local state
            handleInputChange("logoUrl", downloadURL);
            showToast("Logo uploaded successfully!", "success");
        } catch (error) {
            console.error("Error uploading image:", error);
            showToast("Failed to upload image", "error");
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleSave = async () => {
        if (!event) return;
        setSaving(true);
        try {
            const eventRef = doc(db, "events", eventId);

            // Convert date string back to Timestamp if needed (for datetime-local input)
            // Note: In a real app, you'd handle date conversion carefully.
            // Here we assume the input gives us a string we need to parse back to Timestamp if changed.
            let updatedData = { ...formData };

            if (typeof updatedData.dateTime === 'string') {
                updatedData.dateTime = Timestamp.fromDate(new Date(updatedData.dateTime));
            }

            // Recalculate status before saving (optional, but good for consistency)
            // Ideally status is derived on read, but if we store it, we should update it.
            // However, the requirement says "Implement a helper function to determine the status dynamically".
            // So we might not need to store 'status' if we calculate it on the fly.
            // But the EventData interface has a status field, so let's update it.
            // We need to cast to EventData to use the helper, assuming formData has enough fields.
            const tempEvent = { ...event, ...updatedData } as EventData;
            updatedData.status = calculateStatus(tempEvent);

            await updateDoc(eventRef, updatedData);
            setEvent(tempEvent);
            showToast("Event updated successfully!", "success");
        } catch (error) {
            console.error("Error updating event:", error);
            showToast("Failed to update event.", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!event) return null;

    const currentStatus = calculateStatus({ ...event, ...formData } as EventData);

    // Helper to format Timestamp for datetime-local input
    const formatDateForInput = (ts: Timestamp | string) => {
        if (!ts) return "";
        const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
        // Format: YYYY-MM-DDThh:mm
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
        return localISOTime;
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <Button variant="ghost" onClick={() => router.back()} className="mb-4">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Events
                </Button>

                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Event Details</h1>
                        <p className="text-gray-600">Manage and edit event information</p>
                    </div>
                    <div className={`px-4 py-2 rounded-full text-sm font-bold text-white shadow-sm ${currentStatus === 'Active' ? 'bg-green-500' :
                        currentStatus === 'Upcoming' ? 'bg-blue-500' :
                            currentStatus === 'Cancelled' ? 'bg-red-500' :
                                'bg-gray-500'
                        }`}>
                        {currentStatus}
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>General Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="eventId">Event ID</Label>
                                <Input id="eventId" value={eventId} disabled className="bg-gray-100 font-mono text-sm" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="eventName">Event Name</Label>
                                <Input
                                    id="eventName"
                                    value={formData.eventName || ""}
                                    onChange={(e) => handleInputChange("eventName", e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="creator">Created By</Label>
                                <Input id="creator" value={creatorName} disabled className="bg-gray-100" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="dateTime">Date & Time</Label>
                                <Input
                                    id="dateTime"
                                    type="datetime-local"
                                    value={formatDateForInput(formData.dateTime as Timestamp)}
                                    onChange={(e) => handleInputChange("dateTime", e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="duration">Duration (minutes)</Label>
                                <Input
                                    id="duration"
                                    type="number"
                                    value={formData.duration || 0}
                                    onChange={(e) => handleInputChange("duration", parseInt(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="locationName">Location</Label>
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
                                        value={formData.locationName || ""}
                                        onChange={(e) => handleInputChange("locationName", e.target.value)}
                                        placeholder="Or type custom location"
                                        className="mt-2"
                                    />
                                )}
                                {(formData.coordinates || formData.locationName) && (
                                    <div className="pt-1">
                                        <a
                                            href={formData.coordinates
                                                ? `https://www.google.com/maps/search/?api=1&query=${formData.coordinates.lat},${formData.coordinates.lng}`
                                                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formData.locationName || "")}`
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
                                    value={formData.pricePerPlayer || 0}
                                    onChange={(e) => handleInputChange("pricePerPlayer", parseFloat(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Event Logo</Label>
                                <div className="flex items-center space-x-2">
                                    <Label htmlFor="use-url" className="text-xs font-normal text-gray-500 cursor-pointer">Use URL</Label>
                                    <Switch
                                        id="use-url"
                                        checked={!uploadingPhoto && typeof formData.logoUrl === 'string' && !formData.logoUrl.includes('firebasestorage')}
                                        onCheckedChange={(checked) => {
                                            // Optional: clear logo if switching modes, or just let user overwrite
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-4">
                                {/* Image Preview & Upload Area */}
                                <div className="flex flex-col items-center sm:items-start">
                                    <div className="relative group cursor-pointer" onClick={() => document.getElementById('logo-upload')?.click()}>
                                        <div className="h-32 w-32 rounded-lg overflow-hidden border-2 border-gray-200 bg-gray-100 relative">
                                            {formData.logoUrl ? (
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
                                    <p className="mt-2 text-sm text-gray-500">Click image to upload new file</p>
                                </div>

                                {/* URL Input Fallback */}
                                <div className="space-y-1">
                                    <Label htmlFor="logoUrlInput" className="text-xs text-gray-500">Or enter Image URL directly</Label>
                                    <Input
                                        id="logoUrlInput"
                                        placeholder="https://example.com/image.jpg"
                                        value={formData.logoUrl || ""}
                                        onChange={(e) => handleInputChange("logoUrl", e.target.value)}
                                    />
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
                                    value={formData.slotsAvailable || 0}
                                    onChange={(e) => handleInputChange("slotsAvailable", parseInt(e.target.value))}
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

                        <div className="flex items-center space-x-4 py-2">
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="isPublic"
                                    checked={formData.isPublic}
                                    onCheckedChange={(checked: boolean) => handleInputChange("isPublic", checked)}
                                />
                                <Label htmlFor="isPublic">Public Event</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="isTeamRegistration"
                                    checked={formData.isTeamRegistration}
                                    onCheckedChange={(checked: boolean) => handleInputChange("isTeamRegistration", checked)}
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
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="cancellationMessage">Cancellation Message</Label>
                            <Input
                                id="cancellationMessage"
                                placeholder="Enter message to cancel event"
                                value={formData.cancellationMessage || ""}
                                onChange={(e) => handleInputChange("cancellationMessage", e.target.value)}
                            />
                            <p className="text-xs text-gray-500">Setting this will mark the event as Cancelled.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="terms">Terms & Conditions</Label>
                            <Textarea
                                id="terms"
                                rows={4}
                                value={formData.termsAndConditions || ""}
                                onChange={(e) => handleInputChange("termsAndConditions", e.target.value)}
                            />
                        </div>
                    </CardContent>
                </Card>

                <div className="flex justify-end pt-4">
                    <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-2" />
                                Save Changes
                            </>
                        )}
                    </Button>
                </div>
            </div >
        </div >
    );
}

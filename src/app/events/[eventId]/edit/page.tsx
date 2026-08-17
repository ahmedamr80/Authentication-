"use client";

import { useState, useEffect, use } from "react";
import { collection, doc, Timestamp, query, orderBy, getDocs, getDoc, updateDoc, where, runTransaction } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Loader2, Save, Camera, MapPin, Calendar, CalendarX } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { uploadImageWithFallback } from "@/lib/upload-helper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Image from "next/image";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";

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

export default function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
    const { eventId } = use(params);
    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [loadingEvent, setLoadingEvent] = useState(true);
    const { showToast } = useToast();
    const router = useRouter();
    const { user, isAdmin, loading: authLoading } = useAuth();

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

    const [originalSlotsAvailable, setOriginalSlotsAvailable] = useState<number>(8);
    const [isCancelled, setIsCancelled] = useState(false);
    const [originalIsCancelled, setOriginalIsCancelled] = useState(false);
    const [cancellationMessage, setCancellationMessage] = useState("");

    const [clubs, setClubs] = useState<{ id: string; name: string; location?: { coordinates?: { lat: number; lng: number } } }[]>([]);
    const [loadingClubs, setLoadingClubs] = useState(true);

    // Redirect non-admins
    useEffect(() => {
        if (!authLoading && !loadingEvent) {
            if (!isAdmin) {
                showToast("Access Denied: You do not have permission to edit events.", "error");
                router.push("/events");
            }
        }
    }, [isAdmin, authLoading, loadingEvent, router, showToast]);

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
            if (!eventId) return;
            try {
                const eventDoc = await getDoc(doc(db, "events", eventId));
                if (eventDoc.exists()) {
                    const data = eventDoc.data();
                    const eventDate = data.dateTime.toDate();
                    const offset = eventDate.getTimezoneOffset() * 60000;
                    const localISOTime = (new Date(eventDate.getTime() - offset)).toISOString().slice(0, 16);
                    setFormData({
                        eventName: data.eventName || "",
                        locationName: data.locationName || "",
                        clubId: data.clubId || null,
                        dateTime: localISOTime,
                        duration: data.duration || 60,
                        unitType: data.unitType || "Players",
                        isPublic: data.isPublic ?? true,
                        isTeamRegistration: data.isTeamRegistration ?? false,
                        slotsAvailable: data.slotsAvailable || 8,
                        pricePerPlayer: data.pricePerPlayer || 0,
                        termsAndConditions: data.termsAndConditions || "",
                        logoUrl: data.logoUrl || "",
                        coordinates: data.coordinates || null,
                    });
                    setOriginalSlotsAvailable(data.slotsAvailable || 8);
                    const cancelled = data.status === "Cancelled" || !!data.cancellationMessage;
                    setIsCancelled(cancelled);
                    setOriginalIsCancelled(cancelled);
                    setCancellationMessage(data.cancellationMessage || "");
                } else {
                    showToast("Event not found", "error");
                    router.push("/events");
                }
            } catch (error) {
                console.error("Error fetching event:", error);
            } finally {
                setLoadingEvent(false);
            }
        };
        fetchEvent();
    }, [eventId, router, showToast]);

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
            const url = await uploadImageWithFallback({
                file,
                folder: "events",
                customId: `event-${Date.now()}`
            });

            handleInputChange("logoUrl", url);
            showToast("Logo uploaded successfully!", "success");
        } catch (error) {
            console.error("Error uploading image:", error);
            showToast(error instanceof Error ? error.message : "Failed to upload image", "error");
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleUpdate = async () => {
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
        if (isCancelled && !cancellationMessage.trim()) {
            showToast("Please enter a cancellation message", "error");
            return;
        }

        setSaving(true);
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                showToast("You must be logged in to update an event", "error");
                router.push("/auth/signin");
                return;
            }

            const newSlots = formData.slotsAvailable;

            const baseEventData = {
                eventName: formData.eventName.trim(),
                locationName: formData.locationName.trim(),
                clubId: formData.clubId,
                dateTime: Timestamp.fromDate(new Date(formData.dateTime)),
                duration: formData.duration,
                unitType: formData.unitType,
                isPublic: formData.isPublic,
                isTeamRegistration: formData.isTeamRegistration,
                slotsAvailable: newSlots,
                pricePerPlayer: formData.pricePerPlayer,
                termsAndConditions: formData.termsAndConditions.trim(),
                logoUrl: formData.logoUrl,
                coordinates: formData.coordinates,
                updatedAt: Timestamp.now(),
            };

            const eventRef = doc(db, "events", eventId);

            // CASE A: NEW CANCELLATION
            if (isCancelled && !originalIsCancelled) {
                await runTransaction(db, async (transaction) => {
                    const eventSnap = await transaction.get(eventRef);
                    if (!eventSnap.exists()) throw new Error("Event not found");

                    transaction.update(eventRef, {
                        ...baseEventData,
                        status: "Cancelled",
                        cancellationMessage: cancellationMessage.trim(),
                    });

                    // Fetch and notify confirmed players
                    if (formData.unitType === "Players") {
                        const confirmedQuery = query(
                            collection(db, "registrations"),
                            where("eventId", "==", eventId),
                            where("status", "==", "CONFIRMED")
                        );
                        const confirmedSnap = await getDocs(confirmedQuery);
                        for (const regDoc of confirmedSnap.docs) {
                            const notifRef = doc(collection(db, "notifications"));
                            transaction.set(notifRef, {
                                notificationId: notifRef.id,
                                userId: regDoc.data().playerId,
                                type: "EVENT_CANCELLED",
                                title: "Event Cancelled ❌",
                                message: `The event "${formData.eventName.trim()}" has been cancelled. Message: "${cancellationMessage.trim()}"`,
                                eventId: eventId,
                                read: false,
                                createdAt: Timestamp.now()
                            });
                        }
                    } else {
                        // Teams Mode
                        const confirmedTeamsQuery = query(
                            collection(db, "teams"),
                            where("eventId", "==", eventId),
                            where("status", "==", "CONFIRMED")
                        );
                        const confirmedTeamsSnap = await getDocs(confirmedTeamsQuery);
                        for (const teamDoc of confirmedTeamsSnap.docs) {
                            const teamData = teamDoc.data();
                            const players = [teamData.player1Id, teamData.player2Id].filter(Boolean);
                            for (const playerId of players) {
                                const notifRef = doc(collection(db, "notifications"));
                                transaction.set(notifRef, {
                                    notificationId: notifRef.id,
                                    userId: playerId,
                                    type: "EVENT_CANCELLED",
                                    title: "Event Cancelled ❌",
                                    message: `The event "${formData.eventName.trim()}" has been cancelled. Message: "${cancellationMessage.trim()}"`,
                                    eventId: eventId,
                                    read: false,
                                    createdAt: Timestamp.now()
                                });
                            }
                        }
                    }
                });

                showToast("Event cancelled and players notified!", "success");
                router.push(`/events/${eventId}`);
                return;
            }

            const cancelledStatus = isCancelled ? "Cancelled" : "Upcoming";
            const cancellationMsg = isCancelled ? cancellationMessage.trim() : null;

            // CASE B: CAPACITY CHANGE (Only process queue if event is NOT cancelled)
            if (!isCancelled && newSlots !== originalSlotsAvailable) {
                if (newSlots > originalSlotsAvailable) {
                    // Capacity Increased
                    const diff = newSlots - originalSlotsAvailable;
                    if (formData.unitType === "Players") {
                        const waitlistQuery = query(
                            collection(db, "registrations"),
                            where("eventId", "==", eventId),
                            where("status", "==", "WAITLIST"),
                            orderBy("registeredAt", "asc")
                        );
                        const waitlistSnap = await getDocs(waitlistQuery);

                        await runTransaction(db, async (transaction) => {
                            const eventSnap = await transaction.get(eventRef);
                            if (!eventSnap.exists()) throw new Error("Event not found");

                            const curEvent = eventSnap.data();
                            const curConfirmed = curEvent.registrationsCount || 0;
                            const curWaitlist = curEvent.waitlistCount || 0;

                            let promoteCount = 0;
                            if (!waitlistSnap.empty) {
                                const waitlistedToPromote = waitlistSnap.docs.slice(0, diff);
                                promoteCount = waitlistedToPromote.length;

                                for (const regDoc of waitlistedToPromote) {
                                    const regRef = doc(db, "registrations", regDoc.id);
                                    transaction.update(regRef, {
                                        status: "CONFIRMED",
                                        waitlistPosition: null,
                                        promotedAt: Timestamp.now()
                                    });

                                    const notifRef = doc(collection(db, "notifications"));
                                    transaction.set(notifRef, {
                                        notificationId: notifRef.id,
                                        userId: regDoc.data().playerId,
                                        type: "WAITLIST_PROMOTED",
                                        title: "You're In! 🎉",
                                        message: `You've been promoted from the waitlist for ${formData.eventName.trim()}!`,
                                        eventId: eventId,
                                        read: false,
                                        createdAt: Timestamp.now()
                                    });
                                }
                            }

                            transaction.update(eventRef, {
                                ...baseEventData,
                                status: cancelledStatus,
                                cancellationMessage: cancellationMsg,
                                registrationsCount: curConfirmed + promoteCount,
                                waitlistCount: Math.max(0, curWaitlist - promoteCount)
                            });
                        });
                    } else {
                        // Teams Mode
                        const waitlistTeamsQuery = query(
                            collection(db, "teams"),
                            where("eventId", "==", eventId),
                            where("status", "==", "WAITLIST"),
                            orderBy("createdAt", "asc")
                        );
                        const waitlistTeamsSnap = await getDocs(waitlistTeamsQuery);

                        await runTransaction(db, async (transaction) => {
                            const eventSnap = await transaction.get(eventRef);
                            if (!eventSnap.exists()) throw new Error("Event not found");

                            const curEvent = eventSnap.data();
                            const curConfirmed = curEvent.registrationsCount || 0;
                            const curWaitlist = curEvent.waitlistCount || 0;

                            let promoteCount = 0;
                            if (!waitlistTeamsSnap.empty) {
                                const teamsToPromote = waitlistTeamsSnap.docs.slice(0, diff);
                                promoteCount = teamsToPromote.length;

                                for (const teamDoc of teamsToPromote) {
                                    const teamId = teamDoc.id;
                                    const teamData = teamDoc.data();
                                    const teamRef = doc(db, "teams", teamId);

                                    transaction.update(teamRef, {
                                        status: "CONFIRMED",
                                        promotedAt: Timestamp.now()
                                    });

                                    const regQuery = query(
                                        collection(db, "registrations"),
                                        where("teamId", "==", teamId)
                                    );
                                    const regSnap = await getDocs(regQuery);
                                    for (const regDoc of regSnap.docs) {
                                        transaction.update(doc(db, "registrations", regDoc.id), {
                                            status: "CONFIRMED",
                                            waitlistPosition: null,
                                            confirmedAt: Timestamp.now()
                                        });
                                    }

                                    const players = [teamData.player1Id, teamData.player2Id].filter(Boolean);
                                    for (const playerId of players) {
                                        const notifRef = doc(collection(db, "notifications"));
                                        transaction.set(notifRef, {
                                            notificationId: notifRef.id,
                                            userId: playerId,
                                            type: "WAITLIST_PROMOTED",
                                            title: "You're In! 🎉",
                                            message: `Your team has been promoted from the waitlist for ${formData.eventName.trim()}!`,
                                            eventId: eventId,
                                            read: false,
                                            createdAt: Timestamp.now()
                                        });
                                    }
                                }
                            }

                            transaction.update(eventRef, {
                                ...baseEventData,
                                status: cancelledStatus,
                                cancellationMessage: cancellationMsg,
                                registrationsCount: curConfirmed + promoteCount,
                                waitlistCount: Math.max(0, curWaitlist - promoteCount)
                            });
                        });
                    }
                } else {
                    // Capacity Decreased
                    if (formData.unitType === "Players") {
                        const confirmedQuery = query(
                            collection(db, "registrations"),
                            where("eventId", "==", eventId),
                            where("status", "==", "CONFIRMED"),
                            orderBy("registeredAt", "asc")
                        );
                        const confirmedSnap = await getDocs(confirmedQuery);

                        await runTransaction(db, async (transaction) => {
                            const eventSnap = await transaction.get(eventRef);
                            if (!eventSnap.exists()) throw new Error("Event not found");

                            const curEvent = eventSnap.data();
                            const curConfirmed = curEvent.registrationsCount || 0;
                            const curWaitlist = curEvent.waitlistCount || 0;

                            let demotedCount = 0;
                            if (!confirmedSnap.empty && confirmedSnap.docs.length > newSlots) {
                                const demotedRegs = confirmedSnap.docs.slice(newSlots);
                                demotedCount = demotedRegs.length;

                                let waitlistPos = curWaitlist;
                                for (const regDoc of demotedRegs) {
                                    waitlistPos++;
                                    const regRef = doc(db, "registrations", regDoc.id);
                                    transaction.update(regRef, {
                                        status: "WAITLIST",
                                        waitlistPosition: waitlistPos,
                                        demotedAt: Timestamp.now()
                                    });

                                    const notifRef = doc(collection(db, "notifications"));
                                    transaction.set(notifRef, {
                                        notificationId: notifRef.id,
                                        userId: regDoc.data().playerId,
                                        type: "WAITLIST_DEMOTED",
                                        title: "Moved to Waitlist ⏳",
                                        message: `Due to a change in event capacity, you have been moved to the waiting list for ${formData.eventName.trim()}.`,
                                        eventId: eventId,
                                        read: false,
                                        createdAt: Timestamp.now()
                                    });
                                }
                            }

                            transaction.update(eventRef, {
                                ...baseEventData,
                                status: cancelledStatus,
                                cancellationMessage: cancellationMsg,
                                registrationsCount: Math.max(0, curConfirmed - demotedCount),
                                waitlistCount: curWaitlist + demotedCount
                            });
                        });
                    } else {
                        // Teams Mode
                        const confirmedTeamsQuery = query(
                            collection(db, "teams"),
                            where("eventId", "==", eventId),
                            where("status", "==", "CONFIRMED"),
                            orderBy("createdAt", "asc")
                        );
                        const confirmedTeamsSnap = await getDocs(confirmedTeamsQuery);

                        await runTransaction(db, async (transaction) => {
                            const eventSnap = await transaction.get(eventRef);
                            if (!eventSnap.exists()) throw new Error("Event not found");

                            const curEvent = eventSnap.data();
                            const curConfirmed = curEvent.registrationsCount || 0;
                            const curWaitlist = curEvent.waitlistCount || 0;

                            let demotedCount = 0;
                            if (!confirmedTeamsSnap.empty && confirmedTeamsSnap.docs.length > newSlots) {
                                const demotedTeamsList = confirmedTeamsSnap.docs.slice(newSlots);
                                demotedCount = demotedTeamsList.length;

                                let waitlistPos = curWaitlist;
                                for (const teamDoc of demotedTeamsList) {
                                    waitlistPos++;
                                    const teamId = teamDoc.id;
                                    const teamData = teamDoc.data();
                                    const teamRef = doc(db, "teams", teamId);

                                    transaction.update(teamRef, {
                                        status: "WAITLIST",
                                        demotedAt: Timestamp.now()
                                    });

                                    const regQuery = query(
                                        collection(db, "registrations"),
                                        where("teamId", "==", teamId)
                                    );
                                    const regSnap = await getDocs(regQuery);
                                    for (const regDoc of regSnap.docs) {
                                        transaction.update(doc(db, "registrations", regDoc.id), {
                                            status: "WAITLIST",
                                            waitlistPosition: waitlistPos,
                                            demotedAt: Timestamp.now()
                                        });
                                    }

                                    const players = [teamData.player1Id, teamData.player2Id].filter(Boolean);
                                    for (const playerId of players) {
                                        const notifRef = doc(collection(db, "notifications"));
                                        transaction.set(notifRef, {
                                            notificationId: notifRef.id,
                                            userId: playerId,
                                            type: "WAITLIST_DEMOTED",
                                            title: "Moved to Waitlist ⏳",
                                            message: `Due to a change in event capacity, your team has been moved to the waiting list for ${formData.eventName.trim()}.`,
                                            eventId: eventId,
                                            read: false,
                                            createdAt: Timestamp.now()
                                        });
                                    }
                                }
                            }

                            transaction.update(eventRef, {
                                ...baseEventData,
                                status: cancelledStatus,
                                cancellationMessage: cancellationMsg,
                                registrationsCount: Math.max(0, curConfirmed - demotedCount),
                                waitlistCount: curWaitlist + demotedCount
                            });
                        });
                    }
                }
            } else {
                // CASE C: NORMAL UPDATE (No capacity change)
                await updateDoc(eventRef, {
                    ...baseEventData,
                    status: cancelledStatus,
                    cancellationMessage: cancellationMsg,
                });
            }

            showToast("Event updated successfully!", "success");
            router.push(`/events/${eventId}`);
        } catch (error) {
            console.error("Error updating event:", error);
            showToast("Failed to update event", "error");
        } finally {
            setSaving(false);
        }
    };

    if (authLoading || loadingEvent || !isAdmin) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }
    return (
        <div className="min-h-screen bg-black text-white pb-32 relative">
            <div className="fixed inset-0 z-0 bg-linear-to-b from-gray-900 via-black to-black" />

            <Header user={user} showBack={true} onBack={() => router.back()} />

            <div className="container mx-auto px-4 pt-24 relative z-10 max-w-4xl">
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-orange-500/10 rounded-full">
                        <Calendar className="w-8 h-8 text-orange-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white">Edit Event</h1>
                        <p className="text-gray-400">Update the details of your padel event</p>
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
                                        value={formData.duration || ""}
                                        onChange={(e) => handleInputChange("duration", e.target.value === "" ? 0 : parseInt(e.target.value))}
                                        min={15}
                                        step={15}
                                        inputMode="numeric"
                                        pattern="[0-9]*"
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
                                        value={formData.pricePerPlayer || ""}
                                        onChange={(e) => handleInputChange("pricePerPlayer", e.target.value === "" ? 0 : parseFloat(e.target.value))}
                                        min={0}
                                        step={5}
                                        inputMode="decimal"
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
                                                        sizes="(max-width: 640px) 100vw, 128px"
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
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        className="bg-gray-950/50 border-gray-800 text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="unitType" className="text-gray-300">Unit Type</Label>
                                    <Select
                                        value={formData.unitType}
                                        onValueChange={(value: "Players" | "Teams") => handleInputChange("unitType", value)}
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

                    <Card className="bg-red-950/20 backdrop-blur-xl border-red-900/30">
                        <CardHeader>
                            <CardTitle className="text-red-400 flex items-center gap-2">
                                <CalendarX className="w-5 h-5" /> Cancel Event
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="isCancelled"
                                    checked={isCancelled}
                                    onCheckedChange={(checked) => {
                                        setIsCancelled(checked);
                                        if (!checked) setCancellationMessage("");
                                    }}
                                />
                                <Label htmlFor="isCancelled" className="text-gray-300">Cancel this event</Label>
                            </div>
                            {isCancelled && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <Label htmlFor="cancellationMessage" className="text-gray-300">Cancellation Message *</Label>
                                    <Textarea
                                        id="cancellationMessage"
                                        rows={3}
                                        value={cancellationMessage}
                                        onChange={(e) => setCancellationMessage(e.target.value)}
                                        placeholder="Provide a reason for the cancellation..."
                                        className="bg-gray-950/50 border-gray-800 text-white placeholder:text-gray-500"
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="flex justify-end gap-4 pt-4 pb-24">
                        <Button
                            variant="outline"
                            onClick={() => router.push(`/events/${eventId}`)}
                            className="border-gray-700 text-gray-300 hover:bg-gray-800"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleUpdate}
                            disabled={saving}
                            className="bg-orange-500 hover:bg-orange-600 text-white"
                        >
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
                </div>
            </div>

            <BottomNav />
        </div>
    );
}

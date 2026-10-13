"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { withAdminProtection } from "@/lib/with-admin-protection";
import { useToast } from "@/context/ToastContext";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { parseFirebaseDate } from "@/lib/date-utils";
import { format } from "date-fns";
import { EventData } from "@/types";
import {
    ShieldCheck,
    CalendarPlus,
    CalendarRange,
    Trash2,
    Building2,
    ShieldAlert,
    Database,
    Search,
    AlertTriangle,
    Loader2,
    Calendar,
    MapPin,
    ArrowRight,
    Users,
    CheckSquare,
    Square,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";

function AdminConsolePage() {
    const router = useRouter();
    const { user } = useAuth();
    const { showToast } = useToast();

    // Events State
    const [events, setEvents] = useState<EventData[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(true);

    // Modals
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editSearchQuery, setEditSearchQuery] = useState("");

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteSearchQuery, setDeleteSearchQuery] = useState("");
    const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
    const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Subscribe to events
    useEffect(() => {
        const eventsRef = collection(db, "events");
        const q = query(eventsRef, orderBy("dateTime", "desc"));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const list: EventData[] = [];
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    list.push({
                        eventId: docSnap.id,
                        ...data,
                    } as EventData);
                });
                setEvents(list);
                setLoadingEvents(false);
            },
            (error) => {
                console.error("Error fetching events for admin console:", error);
                showToast("Failed to load events", "error");
                setLoadingEvents(false);
            }
        );

        return () => unsubscribe();
    }, [showToast]);

    // Helpers to identify upcoming events
    const isUpcomingEvent = (event: EventData): boolean => {
        const now = new Date();
        const dt = parseFirebaseDate(event.dateTime || event.eventDate || event.eventStartAt);
        if (!dt) return false;
        const durationMinutes = event.duration || 60;
        const endDate = new Date(dt.getTime() + durationMinutes * 60000);
        return endDate.getTime() >= now.getTime();
    };

    const upcomingEvents = useMemo(() => {
        return events
            .filter((e) => isUpcomingEvent(e))
            .sort((a, b) => {
                const dateA = parseFirebaseDate(a.dateTime || a.eventDate)?.getTime() || 0;
                const dateB = parseFirebaseDate(b.dateTime || b.eventDate)?.getTime() || 0;
                return dateA - dateB; // Upcoming ascending (soonest first)
            });
    }, [events]);

    const filteredUpcomingEvents = useMemo(() => {
        const q = editSearchQuery.toLowerCase().trim();
        if (!q) return upcomingEvents;
        return upcomingEvents.filter((e) => {
            const name = (e.eventName || e.title || "").toLowerCase();
            const loc = (e.locationName || e.location || "").toLowerCase();
            return name.includes(q) || loc.includes(q);
        });
    }, [upcomingEvents, editSearchQuery]);

    const filteredAllEvents = useMemo(() => {
        const q = deleteSearchQuery.toLowerCase().trim();
        if (!q) return events;
        return events.filter((e) => {
            const name = (e.eventName || e.title || "").toLowerCase();
            const loc = (e.locationName || e.location || "").toLowerCase();
            return name.includes(q) || loc.includes(q);
        });
    }, [events, deleteSearchQuery]);

    // Toggle event selection for delete
    const toggleSelectEvent = (id: string) => {
        const next = new Set(selectedEventIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedEventIds(next);
    };

    const toggleSelectAllDelete = () => {
        if (selectedEventIds.size === filteredAllEvents.length && filteredAllEvents.length > 0) {
            setSelectedEventIds(new Set());
        } else {
            setSelectedEventIds(new Set(filteredAllEvents.map((e) => e.eventId)));
        }
    };

    const selectedEventsList = useMemo(() => {
        return events.filter((e) => selectedEventIds.has(e.eventId));
    }, [events, selectedEventIds]);

    const handleExecuteDelete = async () => {
        if (selectedEventIds.size === 0 || !user) return;

        setIsDeleting(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/events/delete", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ eventIds: Array.from(selectedEventIds) }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to delete events");
            }

            showToast(
                `Successfully deleted ${selectedEventIds.size} event(s) and all related teams, registrations, notifications, and audit logs.`,
                "success"
            );

            setSelectedEventIds(new Set());
            setIsConfirmDeleteOpen(false);
            setIsDeleteModalOpen(false);
        } catch (error) {
            console.error("Event deletion error:", error);
            showToast(
                error instanceof Error ? error.message : "Failed to delete events.",
                "error"
            );
        } finally {
            setIsDeleting(false);
        }
    };

    const formatEventDateTime = (raw: unknown) => {
        const dt = parseFirebaseDate(raw);
        if (!dt) return "Date TBA";
        return format(dt, "EEE, MMM dd, yyyy • hh:mm a");
    };

    const adminActions = [
        {
            id: "create-event",
            title: "Create Event",
            description: "Launch a new tournament, social match, or clinic with custom registration rules.",
            icon: CalendarPlus,
            color: "text-blue-400",
            bgColor: "bg-blue-500/10",
            borderColor: "border-blue-500/20 hover:border-blue-500/40",
            action: () => router.push("/events/create"),
        },
        {
            id: "edit-event",
            title: "Edit Event",
            description: "Browse upcoming events to update schedules, courts, pricing, or player limits.",
            icon: CalendarRange,
            color: "text-amber-400",
            bgColor: "bg-amber-500/10",
            borderColor: "border-amber-500/20 hover:border-amber-500/40",
            action: () => setIsEditModalOpen(true),
        },
        {
            id: "delete-event",
            title: "Delete Event",
            description: "Select and safely remove events with automatic player notifications and data cleanup.",
            icon: Trash2,
            color: "text-red-400",
            bgColor: "bg-red-500/10",
            borderColor: "border-red-500/20 hover:border-red-500/40",
            action: () => setIsDeleteModalOpen(true),
        },
        {
            id: "add-club",
            title: "Add Club",
            description: "Register a new padel venue or club with GPS coordinates, phone, and details.",
            icon: Building2,
            color: "text-emerald-400",
            bgColor: "bg-emerald-500/10",
            borderColor: "border-emerald-500/20 hover:border-emerald-500/40",
            action: () => router.push("/clubs/create"),
        },
        {
            id: "manage-redflags",
            title: "Manage Red-Flagged Players",
            description: "Inspect penalized players, view late withdrawal records, and clear restrictions.",
            icon: ShieldAlert,
            color: "text-purple-400",
            bgColor: "bg-purple-500/10",
            borderColor: "border-purple-500/20 hover:border-purple-500/40",
            action: () => router.push("/admin/red-flagged-players"),
        },
        {
            id: "data-manager",
            title: "Data Manager",
            description: "Direct database table inspector for users, events, registrations, and teams.",
            icon: Database,
            color: "text-gray-400",
            bgColor: "bg-gray-500/10",
            borderColor: "border-gray-800 hover:border-gray-700",
            action: () => router.push("/admin/data-manager"),
        },
    ];

    return (
        <div className="min-h-screen bg-black text-white pb-24 relative">
            {/* Background Gradient */}
            <div className="fixed inset-0 z-0 bg-linear-to-b from-gray-900 via-black to-black" />

            <Header user={user} showBack={true} onBack={() => router.push("/dashboard")} />

            <main className="relative z-10 pt-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-8">
                {/* Header Banner */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-6">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Badge className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs px-2.5 py-0.5">
                                <ShieldCheck className="w-3.5 h-3.5 mr-1 inline" /> Administrator
                            </Badge>
                        </div>
                        <h1 className="text-3xl font-extrabold text-white tracking-tight">
                            Admin Console
                        </h1>
                        <p className="text-sm text-gray-400 max-w-xl">
                            Central control hub for managing padel events, venues, registrations, and player disciplinary flags.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900/80 px-3 py-2 rounded-xl border border-gray-800">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>System Live • {events.length} Events Total</span>
                    </div>
                </div>

                {/* Primary Action Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {adminActions.map((item) => {
                        const Icon = item.icon;
                        return (
                            <Card
                                key={item.id}
                                onClick={item.action}
                                className={`cursor-pointer bg-gray-900/80 border ${item.borderColor} hover:bg-gray-850 transition-all duration-200 group flex flex-col justify-between rounded-xl overflow-hidden`}
                            >
                                <CardContent className="p-5 sm:p-6 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className={`p-3 rounded-xl ${item.bgColor} group-hover:scale-105 transition-transform duration-200`}>
                                            <Icon className={`w-6 h-6 ${item.color}`} />
                                        </div>
                                        <span className="text-gray-600 group-hover:text-gray-300 transition-colors">
                                            <ArrowRight className="w-5 h-5" />
                                        </span>
                                    </div>

                                    <div className="space-y-1.5">
                                        <h3 className="text-lg font-bold text-white group-hover:text-orange-400 transition-colors">
                                            {item.title}
                                        </h3>
                                        <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">
                                            {item.description}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </main>

            {/* ========================================================================= */}
            {/* 1. EDIT EVENT MODAL (Upcoming Events Selection)                          */}
            {/* ========================================================================= */}
            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent className="bg-gray-950 border-gray-800 text-white max-w-2xl sm:rounded-xl max-h-[85vh] flex flex-col">
                    <DialogHeader className="space-y-2 pb-2">
                        <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                            <CalendarRange className="w-5 h-5 text-amber-400" />
                            Select Upcoming Event to Edit
                        </DialogTitle>
                        <DialogDescription className="text-xs sm:text-sm text-gray-400">
                            Choose an upcoming event to modify its details, schedule, or rules.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Search filter */}
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Filter upcoming events by title or location..."
                            value={editSearchQuery}
                            onChange={(e) => setEditSearchQuery(e.target.value)}
                            className="pl-10 bg-gray-900 border-gray-800 text-white placeholder:text-gray-500 rounded-lg text-sm"
                        />
                    </div>

                    {/* Events List */}
                    <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1 max-h-[50vh]">
                        {loadingEvents ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                            </div>
                        ) : filteredUpcomingEvents.length === 0 ? (
                            <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl bg-gray-900/30">
                                <Calendar className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                                <p className="text-sm font-medium text-gray-300">
                                    {editSearchQuery ? "No matching upcoming events found" : "No upcoming events scheduled"}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {editSearchQuery
                                        ? "Try a different search keyword."
                                        : "Use Create Event to schedule a new padel event."}
                                </p>
                            </div>
                        ) : (
                            filteredUpcomingEvents.map((ev) => {
                                const dtFormatted = formatEventDateTime(ev.dateTime || ev.eventDate);
                                return (
                                    <div
                                        key={ev.eventId}
                                        className="p-3 sm:p-4 rounded-xl bg-gray-900/80 border border-gray-800 hover:border-amber-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-semibold text-white text-base group-hover:text-amber-400 transition-colors">
                                                    {ev.eventName || ev.title || "Untitled Event"}
                                                </h4>
                                                <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">
                                                    {ev.unitType || "Players"}
                                                </Badge>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3.5 h-3.5 text-gray-500" />
                                                    {dtFormatted}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3.5 h-3.5 text-gray-500" />
                                                    {ev.locationName || ev.location || "Location TBA"}
                                                </span>
                                            </div>
                                        </div>

                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                setIsEditModalOpen(false);
                                                router.push(`/events/${ev.eventId}/edit`);
                                            }}
                                            className="bg-amber-500 hover:bg-amber-600 text-gray-950 font-semibold text-xs shrink-0"
                                        >
                                            Edit Event
                                        </Button>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <DialogFooter className="pt-2 border-t border-gray-800">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditModalOpen(false)}
                            className="border-gray-800 text-gray-400 hover:text-white"
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ========================================================================= */}
            {/* 2. DELETE EVENT MODAL (Multi-select List)                                */}
            {/* ========================================================================= */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent className="bg-gray-950 border-gray-800 text-white max-w-3xl sm:rounded-xl max-h-[85vh] flex flex-col">
                    <DialogHeader className="space-y-2 pb-2">
                        <div className="flex items-center justify-between pr-6">
                            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                                <Trash2 className="w-5 h-5 text-red-400" />
                                Delete Events
                            </DialogTitle>
                            {selectedEventIds.size > 0 && (
                                <Badge variant="destructive" className="bg-red-500/20 text-red-400 border-red-500/30">
                                    {selectedEventIds.size} Selected
                                </Badge>
                            )}
                        </div>
                        <DialogDescription className="text-xs sm:text-sm text-gray-400">
                            Select one or more events to permanently delete. Related registrations, teams, notifications, and audit logs will also be removed.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Toolbar: Search + Select All */}
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Search events to delete..."
                                value={deleteSearchQuery}
                                onChange={(e) => setDeleteSearchQuery(e.target.value)}
                                className="pl-9 bg-gray-900 border-gray-800 text-white placeholder:text-gray-500 rounded-lg text-sm h-9"
                            />
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={toggleSelectAllDelete}
                            className="border-gray-800 text-gray-300 hover:bg-gray-900 hover:text-white text-xs h-9 shrink-0 gap-1.5"
                        >
                            {selectedEventIds.size === filteredAllEvents.length && filteredAllEvents.length > 0 ? (
                                <>
                                    <CheckSquare className="w-3.5 h-3.5 text-orange-400" /> Deselect All
                                </>
                            ) : (
                                <>
                                    <Square className="w-3.5 h-3.5" /> Select All ({filteredAllEvents.length})
                                </>
                            )}
                        </Button>
                    </div>

                    {/* Multi-select Event List */}
                    <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1 max-h-[48vh]">
                        {loadingEvents ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                            </div>
                        ) : filteredAllEvents.length === 0 ? (
                            <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl bg-gray-900/30">
                                <p className="text-sm font-medium text-gray-400">No events found</p>
                            </div>
                        ) : (
                            filteredAllEvents.map((ev) => {
                                const isSelected = selectedEventIds.has(ev.eventId);
                                const isUpcoming = isUpcomingEvent(ev);
                                const dtFormatted = formatEventDateTime(ev.dateTime || ev.eventDate);

                                return (
                                    <div
                                        key={ev.eventId}
                                        onClick={() => toggleSelectEvent(ev.eventId)}
                                        className={`p-3 sm:p-3.5 rounded-xl border cursor-pointer transition-all flex items-start sm:items-center gap-3.5 ${
                                            isSelected
                                                ? "bg-red-950/20 border-red-500/50 shadow-xs"
                                                : "bg-gray-900/70 border-gray-800 hover:border-gray-700 hover:bg-gray-900"
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => {}} // Handled by parent div onClick
                                            className="mt-1 sm:mt-0 h-4 w-4 rounded border-gray-700 bg-gray-950 text-red-500 focus:ring-red-500 cursor-pointer shrink-0"
                                        />

                                        <div className="flex-1 min-w-0 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h4 className="font-semibold text-white text-sm sm:text-base truncate">
                                                    {ev.eventName || ev.title || "Untitled Event"}
                                                </h4>
                                                {isUpcoming ? (
                                                    <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px]">
                                                        Upcoming
                                                    </Badge>
                                                ) : (
                                                    <Badge className="bg-gray-800 text-gray-400 border border-gray-700 text-[10px]">
                                                        Past
                                                    </Badge>
                                                )}
                                                <span className="text-[11px] font-mono text-gray-500">
                                                    ID: {ev.eventId}
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3 text-gray-500" />
                                                    {dtFormatted}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3 h-3 text-gray-500" />
                                                    {ev.locationName || ev.location || "Location TBA"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer Actions */}
                    <DialogFooter className="pt-3 border-t border-gray-800 flex flex-row items-center justify-between sm:justify-between">
                        <span className="text-xs text-gray-400">
                            {selectedEventIds.size === 0
                                ? "No events selected"
                                : `${selectedEventIds.size} event(s) selected`}
                        </span>

                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setIsDeleteModalOpen(false)}
                                className="border-gray-800 text-gray-400 hover:text-white"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                disabled={selectedEventIds.size === 0}
                                onClick={() => setIsConfirmDeleteOpen(true)}
                                className="bg-red-600 hover:bg-red-700 text-white font-medium gap-1.5 shadow-sm"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete Selected Events ({selectedEventIds.size})
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ========================================================================= */}
            {/* 3. CONFIRMATION DIALOG FOR EVENT DELETION                                 */}
            {/* ========================================================================= */}
            <Dialog open={isConfirmDeleteOpen} onOpenChange={setIsConfirmDeleteOpen}>
                <DialogContent className="bg-gray-950 border-gray-800 text-white max-w-lg sm:rounded-xl">
                    <DialogHeader className="space-y-3">
                        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center">
                            <AlertTriangle className="w-6 h-6" />
                        </div>
                        <DialogTitle className="text-xl font-bold text-white">
                            Confirm Permanent Deletion
                        </DialogTitle>
                        <DialogDescription className="text-sm text-gray-400">
                            You are about to delete{" "}
                            <span className="font-bold text-white">{selectedEventIds.size} event(s)</span>.
                            Please review the affected events below.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Events List summary */}
                    <div className="max-h-40 overflow-y-auto rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2 text-xs">
                        {selectedEventsList.map((e) => (
                            <div key={e.eventId} className="flex items-center justify-between text-gray-300">
                                <span className="font-medium truncate max-w-[280px]">
                                    • {e.eventName || e.title || e.eventId}
                                </span>
                                {isUpcomingEvent(e) ? (
                                    <span className="text-emerald-400 font-semibold text-[10px]">Upcoming (Notifies Players)</span>
                                ) : (
                                    <span className="text-gray-500 text-[10px]">Past</span>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Warning Callout */}
                    <div className="p-3.5 rounded-lg bg-red-950/30 border border-red-500/30 text-xs text-red-300 space-y-1.5">
                        <p className="font-semibold flex items-center gap-1.5 text-red-200">
                            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                            Warning: Irreversible Action
                        </p>
                        <p className="text-gray-300 leading-relaxed text-[11px]">
                            All related <span className="text-white font-semibold">teams</span>,{" "}
                            <span className="text-white font-semibold">registrations</span>,{" "}
                            <span className="text-white font-semibold">notifications</span>, and{" "}
                            <span className="text-white font-semibold">audit logs</span> will also be permanently deleted.
                            For any <span className="text-white font-semibold">upcoming events</span>, an event cancellation notification will automatically be sent to all registered players before removal.
                        </p>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsConfirmDeleteOpen(false)}
                            disabled={isDeleting}
                            className="border-gray-800 text-gray-300 hover:bg-gray-900 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleExecuteDelete}
                            disabled={isDeleting}
                            className="bg-red-600 hover:bg-red-700 text-white font-medium"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting & Notifying...
                                </>
                            ) : (
                                `Confirm Delete (${selectedEventIds.size})`
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <BottomNav />
        </div>
    );
}

export default withAdminProtection(AdminConsolePage);

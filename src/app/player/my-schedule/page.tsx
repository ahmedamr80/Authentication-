"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, doc, getDoc, Timestamp, DocumentData } from "firebase/firestore";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, MapPin, Clock, User, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { format, addMinutes } from "date-fns";

// --- 1. UPDATED TYPES (Matching your Firestore Schema) ---

interface EventData {
    eventId: string;
    eventName: string;
    dateTime: Timestamp;
    locationName: string;
    duration: number;
    logoUrl?: string;
    pricePerPlayer?: number;
}

interface ScheduleItem {
    id: string;
    event: EventData;
    status: "CONFIRMED" | "WAITLIST" | "PENDING" | "CANCELLED";
    role: "player" | "team_captain" | "team_member";
    partnerName?: string;
    partnerStatus?: string;
    registrationId: string;
}

export default function MySchedulePage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [pendingInvitesCount, setPendingInvitesCount] = useState(0);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push("/auth/signin");
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        const fetchSchedule = async () => {
            if (!user) return;
            setLoading(true);

            try {
                const items: ScheduleItem[] = [];
                const eventIds = new Set<string>();
                let pendingCount = 0;

                // 1. Fetch Individual Registrations
                const regsRef = collection(db, "registrations");
                const regsQuery = query(regsRef, where("playerId", "==", user.uid));
                const regsSnap = await getDocs(regsQuery);

                regsSnap.forEach((doc) => {
                    const data = doc.data();
                    if (!eventIds.has(data.eventId)) {
                        items.push({
                            id: data.eventId,
                            event: {} as EventData,
                            status: data.status,
                            role: "player",
                            registrationId: doc.id,
                        });
                        if (data.status !== "CANCELLED") {
                            eventIds.add(data.eventId);
                        }
                    }
                });

                // 2. Fetch Teams
                const teamsRef = collection(db, "teams");
                const teamsQuery1 = query(teamsRef, where("player1Id", "==", user.uid));
                const teamsQuery2 = query(teamsRef, where("player2Id", "==", user.uid));

                const [teamsSnap1, teamsSnap2] = await Promise.all([
                    getDocs(teamsQuery1),
                    getDocs(teamsQuery2),
                ]);

                const processTeamDoc = (doc: DocumentData, isPlayer1: boolean) => {
                    const data = doc.data();
                    if (eventIds.has(data.eventId)) return;

                    let myStatus = data.status;
                    const partnerName = isPlayer1 ? data.player2Name : data.player1Name; // Note: Ensure database has player2Name/player1Name saved on team creation
                    const partnerStatus = isPlayer1 ? data.player2Status : data.player1Status; // These might be on Registration, not Team, but leaving for now.

                    // Check for pending invite scenario
                    if (!isPlayer1 && !data.player2Confirmed) {
                        pendingCount++;
                        myStatus = "PENDING";
                    }

                    items.push({
                        id: data.eventId,
                        event: {} as EventData,
                        status: myStatus,
                        role: isPlayer1 ? "team_captain" : "team_member",
                        partnerName: partnerName || (isPlayer1 ? data.fullNameP2 : data.fullNameP1) || "TBD",
                        partnerStatus: partnerStatus,
                        registrationId: doc.id,
                    });
                    eventIds.add(data.eventId);
                };

                teamsSnap1.forEach((d) => processTeamDoc(d, true));
                teamsSnap2.forEach((d) => processTeamDoc(d, false));

                setPendingInvitesCount(pendingCount);

                // 3. Fetch Event Details
                if (items.length > 0) {
                    const eventPromises = items.map(async (item) => {
                        const eventDocRef = doc(db, "events", item.id);
                        const eventSnap = await getDoc(eventDocRef);
                        if (eventSnap.exists()) {
                            const data = eventSnap.data();
                            item.event = {
                                eventId: eventSnap.id,
                                eventName: data.eventName,
                                dateTime: data.dateTime,
                                locationName: data.locationName,
                                duration: data.duration || 60, // Default duration
                                logoUrl: data.logoUrl,
                                pricePerPlayer: data.pricePerPlayer
                            } as EventData;
                        }
                        return item;
                    });

                    const resolvedItems = await Promise.all(eventPromises);

                    const validItems = resolvedItems.filter(i => i.event && i.event.eventName);

                    validItems.sort((a, b) => {
                        const dateA = a.event.dateTime?.toMillis() || 0;
                        const dateB = b.event.dateTime?.toMillis() || 0;
                        return dateB - dateA;
                    });

                    setScheduleItems(validItems);
                } else {
                    setScheduleItems([]);
                }

            } catch (error) {
                console.error("Error fetching schedule:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchSchedule();
    }, [user]);

    const now = new Date();
    const upcomingEvents = scheduleItems.filter(item => item.event.dateTime?.toDate() >= now).reverse();
    const pastEvents = scheduleItems.filter(item => item.event.dateTime?.toDate() < now);

    if (authLoading || (!user && loading)) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col pb-20 font-sans text-white">

            <Header user={user} showBack={true} />

            <main className="flex-1 w-full max-w-4xl mx-auto p-4 space-y-6 pt-24">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Calendar className="w-6 h-6 text-orange-500" />
                        My Schedule
                    </h1>
                </div>

                {pendingInvitesCount > 0 && (
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-semibold text-orange-400">Pending Invites</h4>
                            <p className="text-sm text-gray-300">
                                You have {pendingInvitesCount} pending team invitation(s).
                                Check your <Link href="/notifications" className="underline hover:text-white">Notifications</Link> to respond.
                            </p>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-8 h-8 text-gray-600 animate-spin" />
                    </div>
                ) : (
                    <Tabs defaultValue="upcoming" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-gray-900 border border-gray-800">
                            <TabsTrigger value="upcoming" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white">
                                Upcoming
                                {upcomingEvents.length > 0 && (
                                    <span className="ml-2 bg-orange-500 text-[10px] px-1.5 py-0.5 rounded-full text-white">
                                        {upcomingEvents.length}
                                    </span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="past" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white">
                                History
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="upcoming" className="mt-6 space-y-4">
                            {upcomingEvents.length === 0 ? (
                                <EmptyState message="No upcoming games scheduled." />
                            ) : (
                                upcomingEvents.map((item) => <ScheduleCard key={item.id} item={item} />)
                            )}
                        </TabsContent>

                        <TabsContent value="past" className="mt-6 space-y-4">
                            {pastEvents.length === 0 ? (
                                <EmptyState message="No past games found." />
                            ) : (
                                pastEvents.map((item) => <ScheduleCard key={item.id} item={item} />)
                            )}
                        </TabsContent>
                    </Tabs>
                )}
            </main>

            <BottomNav />
        </div>
    );
}

// --- Sub-components ---

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-gray-800 rounded-xl bg-gray-900/50">
            <Calendar className="w-12 h-12 text-gray-700 mb-4" />
            <p className="text-gray-400 mb-6">{message}</p>
            <Link href="/events">
                <Button className="bg-orange-600 hover:bg-orange-700 text-white">
                    Browse Events
                </Button>
            </Link>
        </div>
    );
}

function ScheduleCard({ item }: { item: ScheduleItem }) {
    const eventDate = item.event.dateTime.toDate();
    const endDate = addMinutes(eventDate, item.event.duration);

    const dayNumber = format(eventDate, "d");
    const monthName = format(eventDate, "MMM");
    const dayName = format(eventDate, "EEE");
    const startTimeStr = format(eventDate, "h:mm a");
    const endTimeStr = format(endDate, "h:mm a");

    const getStatusColor = (status: string) => {
        switch (status) {
            case "CONFIRMED": return "bg-green-500/10 text-green-400 border-green-500/20";
            case "WAITLIST": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
            case "PENDING": return "bg-orange-500/10 text-orange-400 border-orange-500/20";
            case "CANCELLED": return "bg-red-500/10 text-red-400 border-red-500/20";
            default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
        }
    };

    return (
        <div className="flex bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-sm hover:border-gray-700 transition-colors">
            {/* Left: Date Box */}
            <div className="w-20 bg-gray-800 flex flex-col items-center justify-center p-2 text-center border-r border-gray-700">
                <span className="text-xs font-medium text-gray-400 uppercase">{dayName}</span>
                <span className="text-2xl font-bold text-white leading-none my-1">{dayNumber}</span>
                <span className="text-xs font-bold text-orange-500 uppercase">{monthName}</span>
            </div>

            {/* Middle: Details */}
            <div className="flex-1 p-4 flex flex-col justify-center gap-1.5 min-w-0">
                <h3 className="font-bold text-white text-lg truncate pr-2">{item.event.eventName}</h3>

                <div className="flex items-center gap-4 text-sm text-gray-400">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Clock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        <span className="truncate">{startTimeStr} - {endTimeStr}</span>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-gray-400 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                    <span className="truncate">{item.event.locationName}</span>
                </div>

                {item.role.includes("team") && (
                    <div className="flex items-center gap-1.5 text-sm text-indigo-400 mt-1">
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Partner: {item.partnerName}</span>
                    </div>
                )}
            </div>

            {/* Right: Status & Action */}
            <div className="w-28 p-3 flex flex-col items-end justify-between border-l border-gray-800 bg-gray-900/50">
                <Badge variant="outline" className={`text-[10px] px-1.5 h-5 border ${getStatusColor(item.status)}`}>
                    {item.status}
                </Badge>

                <Link href={`/events/${item.event.eventId}`} className="w-full">
                    <Button variant="ghost" size="sm" className="w-full h-8 text-xs bg-gray-800 hover:bg-gray-700 hover:text-white mt-2">
                        View
                    </Button>
                </Link>
            </div>
        </div>
    );
}
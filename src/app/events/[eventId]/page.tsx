"use client";

import { useState, useEffect, useMemo, use, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, onSnapshot, collection, query, where, getDocs, documentId, deleteDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { EventData, Registration, User as FirestoreUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Calendar, MapPin, Clock, Users, Trophy, ArrowLeft, Share2, AlertCircle, LogOut, Settings, User, Home, Bell } from "lucide-react";
import { TeamsList, Team } from "@/components/TeamsList";
import { SinglePlayersList, SinglePlayer } from "@/components/SinglePlayersList";
import { RegisterDialog } from "@/components/RegisterDialog";
import { TeamRegisterDialog } from "@/components/TeamRegisterDialog";
import { PartnerResponseDialog } from "@/components/PartnerResponseDialog";
import { useToast } from "@/context/ToastContext";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Image from "next/image";
import Link from "next/link";

// Helper to calculate spots left
const calculateSpotsLeft = (event: EventData, registrations: Registration[], teams: Team[]) => {
    const totalSpots = event.maxPlayers || 0;

    // NEW LOGIC: Team Mode
    if (event.unitType === "Teams") {
        // Count only fully CONFIRMED teams
        const confirmedCountTeams = teams.filter(t => t.status === "CONFIRMED").length;
        console.log("DEBUG: calculateSpotsLeft (Teams)", { totalSpots, confirmedCountTeams });
        return Math.max(0, totalSpots - confirmedCountTeams);
    }

    // EXISTING LOGIC: Player Mode
    // Count confirmed registrations
    const confirmedCount = registrations.filter(r => r.status === "CONFIRMED").length;
    console.log("DEBUG: calculateSpotsLeft (Players)", { totalSpots, confirmedCount });
    return Math.max(0, totalSpots - confirmedCount);
};

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
    const { eventId } = use(params);
    const router = useRouter();
    const { user } = useAuth();
    const { showToast } = useToast();

    // State
    const [event, setEvent] = useState<EventData | null>(null);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userProfiles, setUserProfiles] = useState<Record<string, FirestoreUser>>({});
    const fetchedIds = useRef<Set<string>>(new Set());
    // Add this ref to track processed URL invites
    const handledInviteRef = useRef<string | null>(null);

    // UI State
    const [isRegisterOpen, setIsRegisterOpen] = useState(false);
    const [isTeamRegisterOpen, setIsTeamRegisterOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [inviteDialogData, setInviteDialogData] = useState<{
        teamId: string;
        requester: { uid: string; displayName?: string };
    } | null>(null);

    const searchParams = useSearchParams();
    const inviteTeamId = searchParams.get('teamId');

    // 1. Fetch Event Data (Real-time)
    useEffect(() => {
        if (!eventId) return;
        const unsub = onSnapshot(doc(db, "events", eventId), (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setEvent({
                    eventId: doc.id,
                    ...data,
                    eventDate: data.dateTime,
                    maxPlayers: data.slotsAvailable,
                    location: data.locationName,
                    eventImage: data.logoUrl,
                    price: data.pricePerPlayer
                } as EventData);
            } else {
                setError("Event not found");
            }
            setLoading(false);
        }, (err) => {
            console.error("Error fetching event:", err);
            setError("Failed to load event");
            setLoading(false);
        });
        return () => unsub();
    }, [eventId]);

    // 2. Fetch Registrations (Always needed for user check & single players)
    useEffect(() => {
        if (!eventId) return;
        const q = query(collection(db, "registrations"), where("eventId", "==", eventId));
        const unsub = onSnapshot(q, (snapshot) => {
            const regs = snapshot.docs.map(d => ({ registrationId: d.id, ...d.data() } as Registration));
            setRegistrations(regs);
        });
        return () => unsub();
    }, [eventId]);

    // 3. Fetch Teams (Conditional Optimization)
    useEffect(() => {
        if (!eventId) return;

        // OPTIMIZATION: Stop here if we know for sure this isn't a team event
        // Note: We check 'event' existence first to avoid errors
        if (event && !event.isTeamRegistration && event.unitType !== "Teams") {
            // setTeams([]); // Removed to avoid set-state-in-effect. Logic handles empty teams via conditional rendering or subsequent updates.
            return;
        }

        const q = query(collection(db, "teams"), where("eventId", "==", eventId));
        const unsub = onSnapshot(q, (snapshot) => {
            const teamsData = snapshot.docs.map(d => ({ teamId: d.id, ...d.data() } as Team));
            setTeams(teamsData);
        });
        return () => unsub();
    }, [eventId, event, event?.unitType, event?.isTeamRegistration]);

    // 4. Fetch User Profiles
    const allPlayerIdsString = useMemo(() => {
        const ids = new Set<string>();
        registrations.forEach(r => {
            if (r.playerId) ids.add(r.playerId);
            if (r.player2Id) ids.add(r.player2Id);
        });
        teams.forEach(t => {
            if (t.player1Id) ids.add(t.player1Id);
            if (t.player2Id) ids.add(t.player2Id);
        });
        if (user) ids.add(user.uid);
        return Array.from(ids).sort().join(',');
    }, [registrations, teams, user]);

    useEffect(() => {
        const fetchProfiles = async () => {
            if (!allPlayerIdsString) return;
            const playerIds = allPlayerIdsString.split(',');
            const missingIds = playerIds.filter(id =>
                id && !userProfiles[id] && !fetchedIds.current.has(id)
            );

            if (missingIds.length > 0) {
                missingIds.forEach(id => fetchedIds.current.add(id));
                const chunks = [];
                for (let i = 0; i < missingIds.length; i += 10) {
                    chunks.push(missingIds.slice(i, i + 10));
                }

                const newProfiles: Record<string, FirestoreUser> = {};
                for (const chunk of chunks) {
                    try {
                        const q = query(collection(db, "users"), where(documentId(), "in", chunk));
                        const snapshot = await getDocs(q);
                        snapshot.docs.forEach(doc => {
                            newProfiles[doc.id] = doc.data() as FirestoreUser;
                        });
                    } catch (error) {
                        console.error("Error fetching chunk:", chunk, error);
                    }
                }

                if (Object.keys(newProfiles).length > 0) {
                    setUserProfiles(prev => ({ ...prev, ...newProfiles }));
                }
            }
        };
        fetchProfiles();
    }, [allPlayerIdsString, userProfiles]);

    // 5. Handle URL Invites
    useEffect(() => {
        if (!inviteTeamId || !user || teams.length === 0) return;

        // CHECK: Have we already handled this specific invite ID?
        if (handledInviteRef.current === inviteTeamId) return;

        const team = teams.find(t => t.teamId === inviteTeamId);

        if (team && team.player2Id === user.uid && team.status === 'PENDING') {
            const requesterProfile = userProfiles[team.player1Id];

            // Wrap in setTimeout to avoid "setState in effect" warning
            setTimeout(() => {
                setInviteDialogData({
                    teamId: team.teamId,
                    requester: {
                        uid: team.player1Id,
                        displayName: requesterProfile?.displayName || requesterProfile?.fullName || "Partner"
                    }
                });
            }, 0);

            // Mark as handled so it doesn't loop
            handledInviteRef.current = inviteTeamId;
        }
    }, [inviteTeamId, user, teams, userProfiles]);

    // Derived State
    const userRegistration = useMemo(() => {
        if (!user) return undefined;

        // Check for solo registration (Players mode or looking for partner in Teams mode)
        const soloReg = registrations.find(r => r.playerId === user.uid && r.status !== "CANCELLED");
        if (soloReg) return soloReg;

        // Check if user is part of a team (Teams mode)
        const userTeam = teams.find(t =>
            t.player1Id === user.uid || t.player2Id === user.uid
        );

        // If user is in a team, create a pseudo-registration object for UI consistency
        if (userTeam) {
            return {
                registrationId: userTeam.teamId,
                eventId: event?.eventId || "",
                playerId: user.uid,
                registeredAt: userTeam.createdAt,
                status: userTeam.status as "CONFIRMED" | "PENDING",
                isPrimary: true,
                teamId: userTeam.teamId
            };
        }

        return undefined;
    }, [user, registrations, teams, event]);

    // Check for pending invites
    const hasPendingInvite = useMemo(() => {
        if (!user) return false;
        return teams.some(t => t.player2Id === user.uid && t.status === "PENDING");
    }, [user, teams]);



    const spotsLeft = useMemo(() => {
        return event ? calculateSpotsLeft(event, registrations, teams) : 0;
    }, [event, registrations, teams]);

    // C. Build the Team List (Single Source of Truth: The 'teams' collection)
    const teamsWithPlayers = useMemo(() => {
        return teams.map(team => {
            const p1 = userProfiles[team.player1Id];
            const p2 = userProfiles[team.player2Id];

            return {
                ...team,
                player1: p1 ? {
                    uid: team.player1Id,
                    displayName: p1.displayName || p1.fullName || p1.fullname || "Unknown Player",
                    photoURL: p1.photoURL || p1.photoUrl || undefined,
                    skillLevel: p1.skillLevel || p1.level || undefined
                } : undefined,
                player2: p2 ? {
                    uid: team.player2Id,
                    displayName: p2.displayName || p2.fullName || p2.fullname || "Unknown Player",
                    photoURL: p2.photoURL || p2.photoUrl || undefined,
                    skillLevel: p2.skillLevel || p2.level || undefined
                } : undefined
            };
        });
    }, [teams, userProfiles]);

    // D. Build the Single Players List (Free Agents)
    const singlePlayers = useMemo(() => {
        // 1. Create a "Block List" of players who are already in a CONFIRMED team
        // We don't want them showing up in the singles list if they are already booked.
        const committedPlayerIds = new Set<string>();
        teamsWithPlayers.forEach(t => {
            if (t.status === 'CONFIRMED') {
                committedPlayerIds.add(t.player1Id);
                if (t.player2Id) committedPlayerIds.add(t.player2Id);
            }
        });

        // 2. Filter Registrations using your specific "Free Agent" rules
        return registrations
            .filter(r => {
                // Safety: If they are already in a confirmed team, hide them.
                if (committedPlayerIds.has(r.playerId)) return false;

                // YOUR LOGIC: They are a "Single Player" if...
                const explicitlyLooking = r.lookingForPartner === true;
                const wasDenied = r.partnerStatus === 'DENIED'; // Partner said no, back to market
                const isOrphan = !r.player2Id; // Registered alone, no invite sent/received

                // If any of these are true, show them in the list
                return explicitlyLooking || wasDenied || isOrphan;
            })
            .map(r => {
                // Enrich with profile data
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.playerDisplayName || "Unknown Player",
                    photoURL: profile?.photoURL || profile?.photoUrl || r.playerPhotoURL || undefined,
                    lookingForPartner: r.lookingForPartner || false,
                    playerHand: profile?.hand || r.playerHand,
                    playerPosition: profile?.position || r.playerPosition,
                    playerSkillLevel: profile?.skillLevel || profile?.level || r.playerSkillLevel,
                    status: r.status,
                    waitlistPosition: r.waitlistPosition
                };
            });
    }, [registrations, userProfiles, teamsWithPlayers]);

    // E. Confirmed Players List (Single Player Mode)
    const confirmedPlayers = useMemo(() => {
        // 1. OPTIMIZATION: Stop if this is NOT a Single Player event
        // We assume Team events use the "Teams" logic we built earlier
        if (!event || event.unitType !== "Players") return [];

        return registrations
            .filter(r => r.status === "CONFIRMED")
            .map(r => {
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.playerDisplayName || "Unknown",
                    photoURL: profile?.photoURL || profile?.photoUrl || r.playerPhotoURL,
                    lookingForPartner: false, // In singles mode, you are just "in", not looking
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level,
                    partnerStatus: r.partnerStatus,
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event]); // Added 'event' dependency for the check

    // F. Waitlist Players List (Single Player Mode)
    const waitlistPlayers = useMemo(() => {
        // 1. OPTIMIZATION: Stop if this is NOT a Single Player event
        // We assume Team events use the "Teams" logic we built earlier
        if (!event || event.unitType !== "Players") return [];

        return registrations
            .filter(r => r.status === "WAITLIST")
            .map(r => {
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.playerDisplayName || "Unknown",
                    photoURL: profile?.photoURL || profile?.photoUrl || r.playerPhotoURL,
                    lookingForPartner: false,
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event]);

    // Handlers
    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href);
        showToast("Link copied to clipboard!", "success");
    };

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const handleManageInvite = (team: Team) => {
        // Prepare the data for the dialog
        setInviteDialogData({
            teamId: team.teamId,
            requester: {
                uid: team.player1Id,
                displayName: team.player1?.displayName || "Partner"
            }
        });
    };

    const handleWithdraw = async () => {
        if (!userRegistration) return;
        if (!confirm("Are you sure you want to withdraw from this event?")) return;

        try {
            // Check if user is part of a team (for team dissolution)
            const userTeam = teams.find(t => t.player1Id === user?.uid || t.player2Id === user?.uid);
            const partnerId = userTeam ? (userTeam.player1Id === user?.uid ? userTeam.player2Id : userTeam.player1Id) : null;

            // Query partner's registration BEFORE transaction (if part of a team)
            let partnerRegistrationId: string | null = null;
            if (userTeam && partnerId && event) {
                const partnerRegQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", event.eventId),
                    where("playerId", "==", partnerId)
                );
                const partnerRegSnapshot = await getDocs(partnerRegQuery);
                if (!partnerRegSnapshot.empty) {
                    partnerRegistrationId = partnerRegSnapshot.docs[0].id;
                }
            }

            // Query waitlist players BEFORE transaction (if withdrawing a confirmed registration)
            let waitlistPlayersToPromote: { id: string; playerId: string; waitlistPosition?: number;[key: string]: any }[] = [];

            if (userRegistration.status === "CONFIRMED" && event) {
                const waitlistQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", event.eventId),
                    where("status", "==", "WAITLIST")
                );
                const waitlistSnapshot = await getDocs(waitlistQuery);

                if (!waitlistSnapshot.empty) {
                    // Sort by waitlistPosition to get FIFO order
                    const allWaitlistPlayers = waitlistSnapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() } as { id: string; playerId: string; waitlistPosition?: number;[key: string]: any }))
                        .sort((a, b) => (a.waitlistPosition || 0) - (b.waitlistPosition || 0));

                    // Calculate how many slots will be available
                    const currentConfirmed = registrations.filter(r => r.status === "CONFIRMED").length;
                    const slotsAfterWithdrawal = (event.maxPlayers || 0) - (currentConfirmed - 1);
                    const slotsToFill = Math.max(0, slotsAfterWithdrawal);

                    // Promote as many waitlist players as there are available slots
                    waitlistPlayersToPromote = allWaitlistPlayers.slice(0, Math.min(slotsToFill, allWaitlistPlayers.length));
                }
            }

            // Import runTransaction and Timestamp
            const { runTransaction, Timestamp } = await import("firebase/firestore");

            await runTransaction(db, async (transaction) => {
                if (!event) throw new Error("Event not found");

                const eventRef = doc(db, "events", event.eventId);
                const regRef = doc(db, "registrations", userRegistration.registrationId);

                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("Event not found");

                const currentEventData = eventDoc.data();

                // TEAM DISSOLUTION LOGIC: If user is part of a team
                if (userTeam && partnerId) {
                    // 1. Delete the team document
                    const teamRef = doc(db, "teams", userTeam.teamId);
                    transaction.delete(teamRef);

                    // 2. Delete Withdrawer's Registration (as requested)
                    transaction.delete(regRef);

                    // 3. Update Partner (The Fix)
                    if (partnerRegistrationId) {
                        const partnerRegRef = doc(db, "registrations", partnerRegistrationId);
                        transaction.update(partnerRegRef, {
                            teamId: null,
                            lookingForPartner: true,
                            partnerStatus: "NONE",
                            status: "CONFIRMED" // Keep as confirmed but looking for partner
                        });

                        // Create notification for partner
                        const notificationRef = doc(collection(db, "notifications"));
                        transaction.set(notificationRef, {
                            userId: partnerId,
                            type: "TEAM_DISSOLVED",
                            message: `Your partner has withdrawn from ${event.eventName}. You've been moved to the "Looking for Partner" list.`,
                            eventId: event.eventId,
                            eventName: event.eventName,
                            read: false,
                            createdAt: Timestamp.now()
                        });
                    }

                    // 4. Update Event: Decrement registrationsCount
                    // One team dissolved = 1 slot freed (assuming 1 team = 1 count)
                    // If the partner stays confirmed, they take up 1 spot as a player?
                    // But for Team events, registrationsCount usually counts TEAMS.
                    // If we have 1 team, count is 1.
                    // If team dissolves, count becomes 0.
                    // Partner is now "Looking for Partner", do they count as a registration?
                    // Usually "Looking for Partner" players are NOT counted in registrationsCount until they form a team.
                    // So yes, decrement by 1 is correct.

                    let newRegistrationsCount = Math.max(0, (currentEventData.registrationsCount || 0) - 1);
                    let newWaitlistCount = currentEventData.waitlistCount || 0;

                    // Promote waitlist players if any exist
                    if (waitlistPlayersToPromote.length > 0) {
                        waitlistPlayersToPromote.forEach((waitlistPlayer) => {
                            const waitlistRef = doc(db, "registrations", waitlistPlayer.id);

                            // Promote to CONFIRMED
                            transaction.update(waitlistRef, {
                                status: "CONFIRMED",
                                waitlistPosition: 0,
                                promotedAt: Timestamp.now()
                            });

                            // Create notification for promoted player
                            const notifRef = doc(collection(db, "notifications"));
                            transaction.set(notifRef, {
                                userId: waitlistPlayer.playerId,
                                type: "WAITLIST_PROMOTED",
                                message: `You've been promoted from the waitlist for ${event.eventName}!`,
                                eventId: event.eventId,
                                eventName: event.eventName,
                                read: false,
                                createdAt: Timestamp.now()
                            });
                        });

                        // Adjust counts: -1 for withdrawal, +N for promotions
                        newRegistrationsCount += waitlistPlayersToPromote.length;
                        newWaitlistCount = Math.max(0, newWaitlistCount - waitlistPlayersToPromote.length);
                    }

                    transaction.update(eventRef, {
                        registrationsCount: newRegistrationsCount,
                        waitlistCount: newWaitlistCount
                    });

                } else {
                    // Standard Individual Withdrawal
                    transaction.update(regRef, {
                        status: "CANCELLED",
                        cancelledAt: Timestamp.now()
                    });

                    let newRegistrationsCount = Math.max(0, (currentEventData.registrationsCount || 0) - 1);
                    let newWaitlistCount = currentEventData.waitlistCount || 0;

                    if (userRegistration.status === "CONFIRMED") {
                        // Promote waitlist players if any exist
                        if (waitlistPlayersToPromote.length > 0) {
                            waitlistPlayersToPromote.forEach((waitlistPlayer) => {
                                const waitlistRef = doc(db, "registrations", waitlistPlayer.id);
                                transaction.update(waitlistRef, {
                                    status: "CONFIRMED",
                                    waitlistPosition: 0,
                                    promotedAt: Timestamp.now()
                                });

                                const notifRef = doc(collection(db, "notifications"));
                                transaction.set(notifRef, {
                                    userId: waitlistPlayer.playerId,
                                    type: "WAITLIST_PROMOTED",
                                    message: `You've been promoted from the waitlist for ${event.eventName}!`,
                                    eventId: event.eventId,
                                    eventName: event.eventName,
                                    read: false,
                                    createdAt: Timestamp.now()
                                });
                            });
                            newRegistrationsCount += waitlistPlayersToPromote.length;
                            newWaitlistCount = Math.max(0, newWaitlistCount - waitlistPlayersToPromote.length);
                        }
                    } else if (userRegistration.status === "WAITLIST") {
                        newWaitlistCount = Math.max(0, newWaitlistCount - 1);
                        // If withdrawing from waitlist, registrationsCount doesn't change (it was already excluded)
                        // But we calculated newRegistrationsCount as -1 above, so we need to reset it or handle it differently.
                        // Actually, for WAITLIST withdrawal, we shouldn't decrement registrationsCount.
                        newRegistrationsCount = currentEventData.registrationsCount || 0;
                    }

                    transaction.update(eventRef, {
                        registrationsCount: newRegistrationsCount,
                        waitlistCount: newWaitlistCount
                    });
                }
            });

            showToast("Successfully withdrawn from event", "success");
            window.location.reload();

        } catch (error) {
            console.error("Error withdrawing:", error);
            showToast("Failed to withdraw", "error");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
            </div>
        );
    }

    if (error || !event) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-4">
                <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2">Event Not Found</h1>
                <p className="text-gray-400 mb-6">{error || "The event you are looking for does not exist."}</p>
                <Button onClick={() => router.push("/events")} variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Events
                </Button>
            </div>
        );
    }

    const isPastEvent = event.eventDate ? event.eventDate.toDate() < new Date() : false;
    const showTeams = event.unitType === "Teams";

    return (
        <div className="min-h-screen bg-black text-white pb-24 relative">
            {/* Background Image */}
            <div className="fixed inset-0 z-0">
                <Image
                    src={event.logoUrl || event.eventImage || event.image || "/placeholder-event.jpg"}
                    alt={event.title || "Event Image"}
                    fill
                    className="object-cover opacity-60"
                    priority
                />
                <div className="absolute inset-0 bg-linear-to-b from-black/40 via-black/80 to-black" />
            </div>

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
                                <button className="text-gray-400 hover:text-white transition-colors">
                                    <span className="sr-only">Notifications</span>
                                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                </button>
                                <div className="relative">
                                    <Avatar
                                        className="h-8 w-8 cursor-pointer border-2 border-transparent hover:border-orange-500 transition-all"
                                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                                    >
                                        <AvatarImage src={userProfiles[user.uid]?.photoURL || userProfiles[user.uid]?.photoUrl || user.photoURL || undefined} />
                                        <AvatarFallback className="bg-orange-500 text-white">
                                            {(userProfiles[user.uid]?.displayName || userProfiles[user.uid]?.fullName || user.displayName || "U").charAt(0)}
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
                                                        <User className="h-4 w-4" /> Profile
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
            <div className="container mx-auto px-4 pt-24 relative z-10">
                {/* Event Card */}
                <div className="bg-gray-900/40 backdrop-blur-2xl rounded-2xl border border-gray-800/50 p-6 mb-8 relative overflow-hidden shadow-2xl">
                    {/* Pending Invite Notification */}
                    {hasPendingInvite && (
                        <div className="absolute top-4 left-4 z-20 animate-pulse">
                            <div className="bg-orange-500 text-white p-2 rounded-full shadow-lg shadow-orange-500/20" title="You have a pending team invite!">
                                <Bell className="h-6 w-6" />
                            </div>
                        </div>
                    )}
                    {/* Background Glow */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                    {/* Top Bar: Back & Share */}
                    <div className="flex justify-between items-center mb-6">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-white hover:bg-gray-800"
                            onClick={() => router.push("/events")}
                        >
                            <ArrowLeft className="h-4 w-4 mr-2" /> Back
                        </Button>
                        <div className="flex gap-2">
                            <Badge variant={isPastEvent ? "secondary" : "default"} className={`${isPastEvent ? "bg-gray-800 text-gray-400" : "bg-orange-500 text-white"} border-0`}>
                                {isPastEvent ? "Past Event" : "Upcoming"}
                            </Badge>
                            <Badge variant="outline" className="border-gray-700 text-gray-400">
                                {event.unitType}
                            </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-gray-400 hover:text-white hover:bg-gray-800"
                            onClick={handleShare}
                        >
                            <Share2 className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Event Details Content */}
                    <div className="flex flex-col md:flex-row justify-between gap-8">
                        <div className="flex-1">
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-6">
                                {event.eventName}
                            </h1>

                            {/* Info Grid */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="bg-gray-950/50 p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-xs uppercase tracking-wider">
                                        <Calendar className="h-3 w-3" /> Date
                                    </div>
                                    <div className="font-semibold text-white">
                                        {event.eventDate ? format(event.eventDate.toDate(), "MMM d, yyyy") : "TBD"}
                                    </div>
                                </div>
                                <div className="bg-gray-950/50 p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-xs uppercase tracking-wider">
                                        <Clock className="h-3 w-3" /> Time
                                    </div>
                                    <div className="font-semibold text-white">
                                        {event.eventDate ? format(event.eventDate.toDate(), "h:mm a") : "TBD"}
                                        {event.duration && <span className="text-gray-500 text-xs ml-1">({event.duration} min)</span>}
                                    </div>
                                </div>
                                <div className="text-center p-3 bg-gray-900/50 rounded-xl border border-gray-800 flex flex-col justify-center">
                                    <p className="text-sm text-gray-400 mb-1">
                                        {event.unitType === "Teams" ? "Teams Left" : "Spots Left"}
                                    </p>
                                    <p className="text-2xl font-bold text-white">
                                        {event.unitType === "Teams"
                                            ? Math.floor(spotsLeft)
                                            : spotsLeft}
                                    </p>
                                    <p className="text-xs text-orange-400 mt-1">
                                        {event.unitType === "Teams"
                                            ? `${teams.filter(t => t.status === 'CONFIRMED').length} / ${event.slotsAvailable ? event.slotsAvailable : 0} Total Teams`
                                            : `${confirmedPlayers.length} / ${event.maxPlayers || event.slotsAvailable} Total Spots`
                                        }
                                    </p>
                                </div>
                                <div className="bg-gray-950/50 p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-xs uppercase tracking-wider">
                                        <Trophy className="h-3 w-3" /> Level
                                    </div>
                                    <div className="font-semibold text-white">
                                        {event.level || "Open"}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Price & Location Side */}
                        <div className="flex flex-col justify-between items-end min-w-[200px]">
                            <div className="text-right">
                                <div className="text-3xl font-bold text-green-400">
                                    {event.price ? `${event.price} AED` : "Free"}
                                </div>
                                <div className="text-sm text-gray-500">per player</div>
                            </div>

                            <div className="mt-4 flex items-center gap-2 text-gray-400 bg-gray-950/50 px-3 py-2 rounded-lg border border-gray-800">
                                <MapPin className="h-4 w-4 text-orange-500" />
                                <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location || "")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-orange-400 hover:underline transition-colors text-sm"
                                >
                                    {event.location || "TBD"}
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-8">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-white font-medium flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                {event.unitType === "Teams"
                                    ? `${teams.filter(t => t.status === 'CONFIRMED').length} / ${event.maxPlayers ? event.maxPlayers : 0} Teams`
                                    : `${confirmedPlayers.length} / ${event.maxPlayers || 0} Players`
                                }
                            </span>
                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                                {event.unitType === "Teams" ? Math.floor(spotsLeft) : spotsLeft} {event.unitType === "Teams" ? "teams" : "spots"} left
                            </Badge>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-linear-to-r from-orange-500 to-red-500 transition-all duration-500"
                                style={{ width: `${Math.min(100, ((event.maxPlayers! - spotsLeft) / event.maxPlayers!) * 100)}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {event.unitType === "Teams"
                                ? "This is a team event. Register with a partner or find one from the single players list."
                                : "This is a single player event. Register to secure your spot."
                            }
                        </p>
                    </div>

                    {/* Register Buttons */}
                    {!isPastEvent && (
                        <div className="mt-8 pt-6 border-t border-gray-800 flex flex-col items-center justify-center gap-6 text-center">
                            <div className="text-sm text-gray-400">
                                <span className="block">Registration closes soon</span>
                                <span className="font-bold text-white">
                                    {event.unitType === "Players" && spotsLeft <= 0
                                        ? "Event is full - Join waitlist"
                                        : `${spotsLeft} spots remaining`}
                                </span>
                            </div>

                            <div className="flex gap-3 w-full md:w-auto justify-center">
                                {userRegistration ? (
                                    <Button
                                        className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white font-bold"
                                        onClick={handleWithdraw}
                                    >
                                        Withdraw
                                    </Button>
                                ) : (
                                    <>
                                        {/* Only show Register to Event for Players mode */}
                                        {event.unitType === "Players" && (
                                            <Button
                                                className="md:w-auto bg-orange-500 hover:bg-orange-600 text-white font-bold"
                                                onClick={() => {
                                                    if (!user) {
                                                        router.push(`/auth/signin?returnTo=/events/${eventId}`);
                                                        return;
                                                    }
                                                    setIsRegisterOpen(true);
                                                }}
                                            >
                                                {spotsLeft <= 0 ? "Join Waitlist" : "Register to Event"}
                                            </Button>
                                        )}
                                        {/* Only show Register Team for Teams mode */}
                                        {event.unitType === "Teams" && (
                                            <Button
                                                className="md:w-auto bg-gray-800 hover:bg-gray-700 text-white font-bold border border-gray-700"
                                                onClick={() => {
                                                    if (!user) {
                                                        router.push(`/auth/signin?returnTo=/events/${eventId}`);
                                                        return;
                                                    }
                                                    setIsTeamRegisterOpen(true);
                                                }}
                                                disabled={spotsLeft <= 1}
                                            >
                                                Register Team
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Tabs */}
                    {showTeams ? (
                        <Tabs defaultValue="teams" className="w-full">
                            <TabsList className="w-full grid grid-cols-2 bg-gray-900 border border-gray-800 p-1 rounded-xl mb-6">
                                <TabsTrigger
                                    value="teams"
                                    className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400 rounded-lg transition-all"
                                >
                                    Teams ({teamsWithPlayers.length})
                                </TabsTrigger>
                                <TabsTrigger
                                    value="players"
                                    className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400 rounded-lg transition-all"
                                >
                                    Looking for Partner ({singlePlayers.length})
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="teams" className="mt-0">
                                <TeamsList
                                    currentUser={user}
                                    teams={teamsWithPlayers}
                                    loading={false}
                                    onManageInvite={handleManageInvite} // <--- Pass it here
                                />
                            </TabsContent>

                            <TabsContent value="players" className="mt-0">
                                <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                    <h3 className="text-sm font-medium text-blue-400 flex items-center gap-2">
                                        <Users className="h-4 w-4" />
                                        Free Agents
                                    </h3>
                                    <p className="text-xs text-blue-300/70 mt-1">
                                        These players have registered but don&apos;t have a partner yet.
                                        {userRegistration?.lookingForPartner
                                            ? " Invite someone below to form a team!"
                                            : " Register as a Single Player to appear here."}
                                    </p>
                                </div>
                                <SinglePlayersList
                                    event={event}
                                    currentUser={user}
                                    userRegistration={userRegistration}
                                    players={singlePlayers}
                                    loading={false}
                                />
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="w-full space-y-8">
                            <div>
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Users className="h-5 w-5 text-green-500" />
                                    Confirmed Players ({confirmedPlayers.length})
                                </h3>
                                <SinglePlayersList
                                    event={event}
                                    currentUser={user}
                                    userRegistration={userRegistration}
                                    players={confirmedPlayers}
                                    loading={false}
                                />
                            </div>

                            {waitlistPlayers.length > 0 && (
                                <div>
                                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-yellow-500">
                                        <Clock className="h-5 w-5" />
                                        Waitlist ({waitlistPlayers.length})
                                    </h3>
                                    <SinglePlayersList
                                        event={event}
                                        currentUser={user}
                                        userRegistration={userRegistration}
                                        players={waitlistPlayers}
                                        loading={false}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div> {/* End of Event Card */}
            </div> {/* End of Container */}

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
                        <Users className="w-6 h-6" />
                        <span className="text-xs font-medium">Community</span>
                    </Link>
                </div>
            </nav>

            {/* Dialogs */}
            {event && (
                event.unitType === "Teams" ? (
                    <TeamRegisterDialog
                        event={event}
                        user={user!}
                        onSuccess={() => setIsTeamRegisterOpen(false)}
                        open={isTeamRegisterOpen}
                        onOpenChange={setIsTeamRegisterOpen}
                        trigger={<span className="hidden" />}
                    />
                ) : (
                    <RegisterDialog
                        event={event}
                        user={user!}
                        onSuccess={() => setIsRegisterOpen(false)}
                        open={isRegisterOpen}
                        onOpenChange={setIsRegisterOpen}
                        trigger={<span className="hidden" />}
                    />
                )
            )}

            {inviteDialogData && event && (
                <PartnerResponseDialog
                    open={!!inviteDialogData}
                    onOpenChange={(open) => !open && setInviteDialogData(null)}
                    notification={{ teamId: inviteDialogData.teamId, notificationId: 'from_url' }}
                    event={event}
                    requester={inviteDialogData.requester}
                    currentUser={user}
                    onSuccess={() => {
                        setInviteDialogData(null);
                        router.replace(`/events/${eventId}`, { scroll: false });
                    }}
                />
            )}
        </div>
    );
}

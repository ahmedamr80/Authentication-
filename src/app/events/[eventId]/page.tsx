"use client";

import { useState, useEffect, useMemo, use, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, onSnapshot, collection, query, where, getDocs, documentId, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { EventData, Registration, User as FirestoreUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Calendar, MapPin, Clock, Users, Trophy, ArrowLeft, Share2, AlertCircle, Bell, Copy, Pencil, Loader2 } from "lucide-react";
import { TeamsList, Team } from "@/components/TeamsList";
import { SinglePlayersList, SinglePlayer } from "@/components/SinglePlayersList";
import { RegisterDialog } from "@/components/RegisterDialog";
import { TeamRegisterDialog } from "@/components/TeamRegisterDialog";
import { PartnerResponseDialog } from "@/components/PartnerResponseDialog";
import { useEventWithdraw } from "@/hooks/useEventWithdraw";

import { useToast } from "@/context/ToastContext";
import { AddToCalendarButton } from "@/components/AddToCalendarButton";
import { format } from "date-fns";
import Image from "next/image";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { EventTermsSection } from "@/components/EventTermsSection";
import { EligibilityGateDialog } from "@/components/EligibilityGateDialog";
import { checkPlayerEligibility } from "@/lib/authRequirements";

// Define a legacy interface for teams that might have direct name properties
// This solves the 'any' casting issue while keeping Type safety
interface TeamWithLegacyData extends Team {
    player1Name?: string;
    fullNameP1?: string;
    player1PhotoURL?: string;
    player2Name?: string;
    fullNameP2?: string;
    player2PhotoURL?: string;
}

// Helper to calculate spots left
const calculateSpotsLeft = (event: EventData, registrations: Registration[], teams: Team[]) => {
    const totalSpots = event.maxPlayers || 0;

    // Updated Logic: Count occupied spots strictly based on CONFIRMED status
    if (event.unitType === "Teams") {
        const occupiedTeams = teams.filter(t => t.status === 'CONFIRMED');
        return Math.max(0, totalSpots - occupiedTeams.length);
    }

    // Player Mode
    const occupiedPlayers = registrations.filter(r => r.status === 'CONFIRMED');
    return Math.max(0, totalSpots - occupiedPlayers.length);
};

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
    const { eventId } = use(params);
    const router = useRouter();
    const { user, isAdmin } = useAuth();
    const { showToast } = useToast();
    const { withdraw, loading: withdrawLoading } = useEventWithdraw();
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
    const [isEligibilityGateOpen, setIsEligibilityGateOpen] = useState(false);
    const [eligibilityState, setEligibilityState] = useState<{ isEmailVerified: boolean; hasPhone: boolean }>({
        isEmailVerified: true,
        hasPhone: true,
    });
    const [inviteDialogData, setInviteDialogData] = useState<{
        teamId: string;
        requester: { uid: string; displayName?: string };
    } | null>(null);

    const handleOpenRegistration = async (isTeam: boolean) => {
        if (!user) {
            router.push(`/auth/signin?returnTo=/events/${eventId}`);
            return;
        }

        const eligibility = await checkPlayerEligibility(user, userProfiles[user.uid]);
        if (!eligibility.eligible) {
            setEligibilityState({
                isEmailVerified: eligibility.isEmailVerified,
                hasPhone: eligibility.hasPhone,
            });
            setIsEligibilityGateOpen(true);
            return;
        }

        if (isTeam) {
            setIsTeamRegisterOpen(true);
        } else {
            setIsRegisterOpen(true);
        }
    };

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
            const regs = snapshot.docs.map(d => ({ ...d.data(), id: d.id, registrationId: d.id } as unknown as Registration));
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
                    } catch (error: unknown) {
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

    // 6. Fetch Club Coordinates
    const [clubCoordinates, setClubCoordinates] = useState<{ lat: number, lng: number } | null>(null);

    useEffect(() => {
        if (event?.clubId) {
            const fetchClubData = async () => {
                const clubDoc = await getDoc(doc(db, "clubs", event.clubId!));
                if (clubDoc.exists()) {
                    setClubCoordinates(clubDoc.data().location.coordinates);
                }
            };
            fetchClubData();
        }
    }, [event?.clubId]);

    // Derived State
    const userRegistration = useMemo(() => {
        if (!user) return undefined;

        // Check for solo registration (Players mode or looking for partner in Teams mode)
        const soloReg = registrations.find(r => 
            (r.playerId === user.uid || r.player2Id === user.uid) && r.status !== "CANCELLED"
        );
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
        return [...teams]
            .sort((a, b) => (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0) - (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0))
            .map(team => {
                const p1 = userProfiles[team.player1Id];
                const p2 = userProfiles[team.player2Id];
                const teamLegacy = team as TeamWithLegacyData;

                return {
                    ...team,
                    player1: p1 ? {
                        uid: team.player1Id,
                        displayName: p1.fullName || p1.fullname || p1.displayName || teamLegacy.player1Name || teamLegacy.fullNameP1 || "Unknown Player",
                        // Prioritize LIVE profile photo -> team-stored snapshot -> fallback
                        photoURL: p1.photoUrl || p1.photoURL || teamLegacy.player1PhotoURL || undefined,
                        skillLevel: p1.skillLevel || p1.level || undefined
                    } : undefined,
                    player2: p2 ? {
                        uid: team.player2Id,
                        displayName: p2.fullName || p2.fullname || p2.displayName || teamLegacy.player2Name || teamLegacy.fullNameP2 || "Unknown Player",
                        // Prioritize LIVE profile photo -> team-stored snapshot -> fallback
                        photoURL: p2.photoUrl || p2.photoURL || teamLegacy.player2PhotoURL || undefined,
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
                // const wasDenied = r.partnerStatus === 'DENIED'; // Partner said no, back to market
                //const isOrphan = !r.player2Id; // Registered alone, no invite sent/received

                // If any of these are true, show them in the list
                return explicitlyLooking //|| wasDenied || isOrphan;
            })
            .sort((a, b) => (a.registeredAt?.toMillis ? a.registeredAt.toMillis() : 0) - (b.registeredAt?.toMillis ? b.registeredAt.toMillis() : 0))
            .map(r => {
                // Enrich with profile data
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || "Unknown Player",
                    // Prioritize LIVE profile photo -> registration snapshot -> fallback
                    photoURL: profile?.photoUrl || profile?.photoURL || r.playerPhotoURL || undefined,
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
            .sort((a, b) => (a.registeredAt?.toMillis ? a.registeredAt.toMillis() : 0) - (b.registeredAt?.toMillis ? b.registeredAt.toMillis() : 0))
            .map(r => {
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || "Unknown",
                    photoURL: profile?.photoUrl || profile?.photoURL || r.playerPhotoURL || undefined,
                    lookingForPartner: false, // In singles mode, you are just "in", not looking
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level,
                    partnerStatus: r.partnerStatus,
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event]);

    // F. Waitlist Players List (Single Player Mode)
    const waitlistPlayers = useMemo(() => {
        // 1. OPTIMIZATION: Stop if this is NOT a Single Player event
        // We assume Team events use the "Teams" logic we built earlier
        if (!event || event.unitType !== "Players") return [];

        return registrations
            .filter(r => r.status === "WAITLIST")
            .sort((a, b) => (a.registeredAt?.toMillis ? a.registeredAt.toMillis() : 0) - (b.registeredAt?.toMillis ? b.registeredAt.toMillis() : 0))
            .map(r => {
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || "Unknown",
                    photoURL: profile?.photoUrl || profile?.photoURL || r.playerPhotoURL || undefined,
                    lookingForPartner: false,
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event]);

    // G. Changed Minds Players List (All Modes)
    const changedMindPlayers = useMemo(() => {
        if (!event) return [];

        return registrations
            .filter(r => r.status !== "CONFIRMED" && r.status !== "WAITLIST" && r.status !== "PENDING")
            .sort((a, b) => (a.registeredAt?.toMillis ? a.registeredAt.toMillis() : 0) - (b.registeredAt?.toMillis ? b.registeredAt.toMillis() : 0))
            .map(r => {
                const profile = userProfiles[r.playerId];
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || "Unknown",
                    photoURL: profile?.photoUrl || profile?.photoURL || r.playerPhotoURL || undefined,
                    lookingForPartner: false,
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event]);

    // Handlers
    const handleShare = () => {
        if (!event) {
            navigator.clipboard.writeText(window.location.href);
            showToast("Event link copied to clipboard!", "success");
            return;
        }

        // 1. Format Date & Time & Links
        const eventTimestamp = event.eventDate || event.dateTime;
        const dateStr = eventTimestamp ? format(eventTimestamp.toDate(), "EEEE, dd MMM yyyy") : "TBD";
        const timeStr = eventTimestamp ? format(eventTimestamp.toDate(), "hh:mm a") : "TBD";
        const durationStr = event.duration ? ` (${event.duration} mins)` : "";
        const locationStr = event.location || event.locationName || "TBD";
        const priceValue = event.price !== undefined ? event.price : event.pricePerPlayer;
        const priceStr = priceValue ? `${priceValue} AED` : "Free";

        const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
        const eventUrl = isLocal
            ? `https://ewpuae.com/events/${event.eventId}`
            : (typeof window !== "undefined" ? window.location.href : `https://ewpuae.com/events/${event.eventId}`);

        const mapsUrl = clubCoordinates
            ? `https://maps.google.com/?q=${clubCoordinates.lat},${clubCoordinates.lng}`
            : `https://maps.google.com/?q=${encodeURIComponent(locationStr)}`;

        // 2. Build WhatsApp Formatted String
        let message = `🎾 *${event.eventName.toUpperCase()}*\n`;
        message += `🔗 *Register / Details:*\n${eventUrl}\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📅 *Date:* ${dateStr}\n`;
        message += `⏰ *Time:* ${timeStr}${durationStr}\n`;
        message += `📍 *Location:* ${locationStr}\n`;
        message += `🗺️ *Google Maps:*\n${mapsUrl}\n`;
        message += `💰 *Price:* ${priceStr} / player\n`;

        if (event.unitType === "Players") {
            const max = event.maxPlayers || event.slotsAvailable || 0;
            message += `👥 *Spots:* ${confirmedPlayers.length}/${max} Players\n\n`;

            message += `📋 *CONFIRMED PLAYERS (${confirmedPlayers.length}):*\n`;
            if (confirmedPlayers.length > 0) {
                confirmedPlayers.forEach((p, idx) => {
                    message += `${idx + 1}. ${p.displayName}\n`;
                });
            } else {
                message += `_No confirmed players yet_\n`;
            }

            if (waitlistPlayers.length > 0) {
                message += `\n⏳ *WAITLIST (${waitlistPlayers.length}):*\n`;
                waitlistPlayers.forEach((p, idx) => {
                    message += `${idx + 1}. ${p.displayName}\n`;
                });
            }
        } else {
            // Teams mode
            const confirmedTeams = teamsWithPlayers.filter(t => t.status === "CONFIRMED");
            const waitlistTeams = teamsWithPlayers.filter(t => t.status === "WAITLIST");
            const totalTeams = event.slotsAvailable || 0;

            message += `👥 *Spots:* ${confirmedTeams.length}/${totalTeams} Teams\n\n`;

            message += `📋 *CONFIRMED TEAMS (${confirmedTeams.length}):*\n`;
            if (confirmedTeams.length > 0) {
                confirmedTeams.forEach((t, idx) => {
                    const p1 = t.player1?.displayName || "Player 1";
                    const p2 = t.player2?.displayName || "Player 2";
                    message += `${idx + 1}. ${p1} & ${p2}\n`;
                });
            } else {
                message += `_No confirmed teams yet_\n`;
            }

            if (singlePlayers.length > 0) {
                message += `\n🔍 *LOOKING FOR PARTNER (${singlePlayers.length}):*\n`;
                singlePlayers.forEach((p, idx) => {
                    message += `${idx + 1}. ${p.displayName}\n`;
                });
            }

            if (waitlistTeams.length > 0) {
                message += `\n⏳ *WAITLIST TEAMS (${waitlistTeams.length}):*\n`;
                waitlistTeams.forEach((t, idx) => {
                    const p1 = t.player1?.displayName || "Player 1";
                    const p2 = t.player2?.displayName || "Player 2";
                    message += `${idx + 1}. ${p1} & ${p2}\n`;
                });
            }
        }

        // 3. Copy to Clipboard
        navigator.clipboard.writeText(message);
        showToast("Event details copied for WhatsApp!", "success");
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
        console.log("[DEBUG handleWithdraw Triggered]", {
            userUid: user?.uid,
            userEmail: user?.email,
            userRegistration,
            eventId: event?.eventId,
            eventUnitType: event?.unitType,
            totalRegistrationsCount: registrations.length,
            registrationsList: registrations.map(r => ({ id: r.registrationId || (r as unknown as { id?: string }).id, playerId: r.playerId, status: r.status })),
            teamsCount: teams.length,
        });

        if (!user) {
            console.error("[DEBUG handleWithdraw] No user logged in!");
            showToast("Debug: You must be logged in to withdraw", "error");
            return;
        }

        if (!event) {
            console.error("[DEBUG handleWithdraw] Event data not loaded!");
            showToast("Debug: Event data is missing", "error");
            return;
        }

        // Find active registration if userRegistration memo was not populated
        let effectiveReg = userRegistration;
        if (!effectiveReg) {
            console.warn("[DEBUG handleWithdraw] userRegistration was undefined in state. Searching registrations array directly...");
            const directMatch = registrations.find(r => 
                (r.playerId === user.uid || r.player2Id === user.uid) && r.status !== "CANCELLED"
            );
            if (directMatch) {
                console.log("[DEBUG handleWithdraw] Found direct match in registrations:", directMatch);
                effectiveReg = directMatch;
            }
        }
        
        console.log("[DEBUG handleWithdraw] Proceeding with withdrawal execution...");

        try {
            showToast("Processing withdrawal...", "info");
            const userTeam = teams.find(t => t.player1Id === user.uid || t.player2Id === user.uid);
            const teamId = userTeam ? userTeam.teamId : (effectiveReg?.teamId || null);

            console.log("[DEBUG handleWithdraw] Calling withdraw hook with:", {
                userId: user.uid,
                eventId: event.eventId,
                registrationId: effectiveReg?.registrationId || (effectiveReg as unknown as { id?: string })?.id,
                teamId
            });

            await withdraw(user, event, effectiveReg as Registration || null, teamId, () => {
                console.log("[DEBUG handleWithdraw] withdraw onSuccess callback fired!");
                showToast("Successfully withdrawn from event!", "success");
            });

        } catch (error: unknown) {
            console.error("[DEBUG handleWithdraw] Error caught during withdraw:", error);
            showToast(error instanceof Error ? `Withdraw Error: ${error.message}` : "Failed to withdraw", "error");
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
    const isCancelledEvent = event.status === "Cancelled" || !!event.cancellationMessage;
    const showTeams = event.unitType === "Teams";

    return (
        <div className="min-h-screen bg-black text-white pb-24 relative">
            {/* Background Image */}
            <div className="fixed inset-0 z-0">
                <Image
                    src={event.logoUrl || event.eventImage || event.image || "/placeholder-event.jpg"}
                    alt={event.title || "Event Image"}
                    fill
                    sizes="100vw"
                    className="object-cover opacity-60"
                    priority
                />
                <div className="absolute inset-0 bg-linear-to-b from-black/40 via-black/80 to-black" />
            </div>

            {/* Sticky Header */}
            <Header user={user} showBack={true} onBack={() => router.back()} />

            {/* Main Content */}
            <div className="container mx-auto px-4 pt-24 relative z-10">
                {/* Event Card */}
                <div className="bg-gray-900/40 backdrop-blur-2xl rounded-2xl border border-gray-800/50 p-6 mb-8 relative overflow-hidden shadow-2xl">
                    {/* Pending Invite Notification */}
                    {hasPendingInvite && (
                        <div className="absolute top-4 right-4 z-20 animate-pulse">
                            <div className="bg-orange-500 text-white p-2 rounded-full shadow-lg shadow-orange-500/20" title="You have a pending team invite!">
                                <Bell className="h-6 w-6" />
                            </div>
                        </div>
                    )}
                    {/* Background Glow */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                    {/* Top Bar: Back, Badges, & Actions */}
                    <div className="flex flex-wrap sm:flex-nowrap justify-between items-center gap-2 mb-6">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-white hover:bg-gray-800"
                            onClick={() => router.push("/events")}
                        >
                            <ArrowLeft className="h-4 w-4 mr-2" /> Back
                        </Button>
                        <div className="flex gap-2">
                            <Badge variant={isCancelledEvent ? "destructive" : isPastEvent ? "secondary" : "default"} className={`${isCancelledEvent ? "bg-red-600 text-white animate-pulse" : isPastEvent ? "bg-gray-800 text-gray-400" : "bg-orange-500 text-white"} border-0`}>
                                {isCancelledEvent ? "Cancelled" : isPastEvent ? "Past Event" : "Upcoming"}
                            </Badge>
                            <Badge variant="outline" className="border-gray-700 text-gray-400">
                                {event.unitType}
                            </Badge>
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-2">
                            {isAdmin && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 px-2.5 sm:px-3 text-blue-400 border-blue-500/40 hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-500 transition-all flex items-center gap-1.5"
                                        onClick={() => router.push(`/events/create?cloneFrom=${eventId}`)}
                                        title="Clone Event"
                                        aria-label="Clone Event"
                                    >
                                        <Copy className="w-4 h-4 shrink-0" />
                                        <span className="hidden sm:inline font-medium">Clone</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 px-2.5 sm:px-3 text-orange-400 border-orange-500/40 hover:bg-orange-500/20 hover:text-orange-300 hover:border-orange-500 transition-all flex items-center gap-1.5"
                                        onClick={() => router.push(`/events/${eventId}/edit`)}
                                        title="Edit Event"
                                        aria-label="Edit Event"
                                    >
                                        <Pencil className="w-4 h-4 shrink-0" />
                                        <span className="hidden sm:inline font-medium">Edit</span>
                                    </Button>
                                </>
                            )}
                            {!isPastEvent && <AddToCalendarButton event={event} />}

                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-gray-400 hover:text-white hover:bg-gray-800"
                                onClick={handleShare}
                            >
                                <Share2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {isCancelledEvent && (
                        <div className="bg-red-950/40 backdrop-blur-xl border border-red-500/30 rounded-2xl p-6 mb-8 flex flex-col sm:flex-row items-start gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
                            <div className="p-3 bg-red-500/10 rounded-full shrink-0">
                                <AlertCircle className="w-6 h-6 text-red-500" />
                            </div>
                            <div className="space-y-1 grow">
                                <h3 className="text-lg font-bold text-red-400">This Event Has Been Cancelled</h3>
                                <p className="text-white font-medium bg-black/40 p-4 rounded-lg border border-red-900/20 mt-2 italic leading-relaxed">
                                    &ldquo;{event.cancellationMessage || "No cancellation message provided."}&rdquo;
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Event Details Content */}
                    <div className="flex flex-col md:flex-row justify-between gap-8">
                        <div className="flex-1">
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-6">
                                {event.eventName}
                            </h1>

                            {/* Info Grid */}
                            <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                <div className="bg-gray-950/50 p-3 sm:p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-[10px] sm:text-xs uppercase tracking-wider">
                                        <Calendar className="h-3 w-3" /> Date
                                    </div>
                                    <div className="text-sm sm:text-base font-semibold text-white">
                                        {event.eventDate ? format(event.eventDate.toDate(), "MMM d, yyyy") : "TBD"}
                                    </div>
                                </div>
                                <div className="bg-gray-950/50 p-3 sm:p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-[10px] sm:text-xs uppercase tracking-wider">
                                        <Clock className="h-3 w-3" /> Time
                                    </div>
                                    <div className="text-sm sm:text-base font-semibold text-white">
                                        {event.eventDate ? format(event.eventDate.toDate(), "h:mm a") : "TBD"}
                                        {event.duration && <span className="text-gray-500 text-[10px] sm:text-xs ml-1">({event.duration}m)</span>}
                                    </div>
                                </div>
                                <div className="text-center p-3 sm:p-4 bg-gray-900/50 rounded-xl border border-gray-800 flex flex-col justify-center">
                                    <p className="text-xs sm:text-sm text-gray-400 mb-1">
                                        {event.unitType === "Teams" ? "Teams Left" : "Spots Left"}
                                    </p>
                                    <p className="text-xl sm:text-2xl font-bold text-white">
                                        {event.unitType === "Teams"
                                            ? Math.floor(spotsLeft)
                                            : spotsLeft}
                                    </p>
                                    <p className="text-[10px] sm:text-xs text-orange-400 mt-1">
                                        {event.unitType === "Teams"
                                            ? `${teams.filter(t => t.status === 'CONFIRMED').length}/${event.slotsAvailable || 0} Teams`
                                            : `${confirmedPlayers.length}/${event.maxPlayers || event.slotsAvailable} Players`
                                        }
                                    </p>
                                </div>
                                <div className="bg-gray-950/50 p-3 sm:p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-[10px] sm:text-xs uppercase tracking-wider">
                                        <Trophy className="h-3 w-3" /> Level
                                    </div>
                                    <div className="text-sm sm:text-base font-semibold text-white">
                                        {event.level || "Open"}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Price & Location Side */}
                        <div className="flex flex-col sm:flex-row md:flex-col justify-between items-start sm:items-center md:items-end gap-4 min-w-[200px]">
                            <div className="text-left sm:text-center md:text-right">
                                <div className="text-2xl sm:text-3xl font-bold text-green-400">
                                    {event.price ? `${event.price} AED` : "Free"}
                                </div>
                                <div className="text-xs sm:text-sm text-gray-500">per player</div>
                            </div>

                            <div className="flex items-center gap-2 text-gray-400 bg-gray-950/50 px-3 py-2 rounded-lg border border-gray-800 w-full sm:w-auto">
                                <MapPin className="h-4 w-4 text-orange-500 shrink-0" />
                                <a
                                    href={clubCoordinates
                                        ? `https://www.google.com/maps/search/?api=1&query=${clubCoordinates.lat},${clubCoordinates.lng}`
                                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location || "")}`
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-orange-400 hover:underline transition-colors text-xs sm:text-sm truncate"
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
                        isCancelledEvent ? (
                            <div className="mt-8 mb-8 pt-6 border-t border-gray-800 flex flex-col items-center justify-center gap-2 text-center">
                                <Badge variant="destructive" className="bg-red-600 text-white font-bold px-4 py-1.5 text-sm uppercase">
                                    Registration Closed
                                </Badge>
                                <p className="text-gray-400 text-sm mt-1">This event has been cancelled and registrations are disabled.</p>
                            </div>
                        ) : (
                            <div className="mt-8 mb-8 pt-6 border-t border-gray-800 flex flex-col items-center justify-center gap-6 text-center">
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
                                            className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white font-bold flex items-center justify-center gap-2 cursor-pointer"
                                            onClick={() => {
                                                console.log("[DEBUG Withdraw Button Clicked in DOM]");
                                                handleWithdraw();
                                            }}
                                            disabled={withdrawLoading}
                                        >
                                            {withdrawLoading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Withdrawing...
                                                </>
                                            ) : (
                                                "Withdraw"
                                            )}
                                        </Button>
                                    ) : (
                                        <>
                                            {/* Only show Register to Event for Players mode */}
                                            {event.unitType === "Players" && (
                                                <Button
                                                    className="md:w-auto bg-orange-500 hover:bg-orange-600 text-white font-bold"
                                                    onClick={() => handleOpenRegistration(false)}
                                                >
                                                    {spotsLeft <= 0 ? "Join Waitlist" : "Register to Event"}
                                                </Button>
                                            )}
                                            {/* Only show Register Team for Teams mode */}
                                            {event.unitType === "Teams" && (
                                                <Button
                                                    className="md:w-auto bg-orange-500 hover:bg-orange-600 text-white font-bold"
                                                    onClick={() => handleOpenRegistration(true)}
                                                >
                                                    {spotsLeft === 0 ? "Register Team to Waitlist" : "Register Team"}
                                                </Button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    )}

                    {/* Event Terms & Conditions Section */}
                    <EventTermsSection event={event} />

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
                                    onManageInvite={handleManageInvite}
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
                                    teams={teams}
                                    loading={false}
                                    onManageInvite={handleManageInvite}
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
                                    teams={teams}
                                    loading={false}
                                    onManageInvite={handleManageInvite}
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
                                        teams={teams}
                                        loading={false}
                                        onManageInvite={handleManageInvite}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Changed Minds Section at the very bottom */}
                    {changedMindPlayers.length > 0 && (
                        <div className="w-full mt-12 pt-8 border-t border-gray-800">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-red-500">
                                <AlertCircle className="h-5 w-5" />
                                Changed Minds ({changedMindPlayers.length})
                            </h3>
                            <p className="text-sm text-gray-400 mb-4">
                                Players who registered but later cancelled or changed their minds.
                            </p>
                            <SinglePlayersList
                                event={event}
                                currentUser={user}
                                userRegistration={userRegistration}
                                players={changedMindPlayers}
                                teams={teams}
                                loading={false}
                                onManageInvite={handleManageInvite}
                            />
                        </div>
                    )}
                </div> {/* End of Event Card */}
            </div> {/* End of Container */}

            {/* Sticky Bottom Nav */}
            <BottomNav />

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

            <EligibilityGateDialog
                open={isEligibilityGateOpen}
                onOpenChange={setIsEligibilityGateOpen}
                user={user}
                isEmailVerified={eligibilityState.isEmailVerified}
                hasPhone={eligibilityState.hasPhone}
                onVerifiedRefresh={() => {
                    setIsEligibilityGateOpen(false);
                    if (event) {
                        handleOpenRegistration(event.unitType === "Teams");
                    }
                }}
            />
        </div>
    );
}
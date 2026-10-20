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
import { Calendar, MapPin, Clock, Users, Trophy, ArrowLeft, Share2, AlertCircle, Bell, Copy, Pencil, Loader2, Activity } from "lucide-react";
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
import { getTimestampMillis, parseFirebaseDate } from "@/lib/date-utils";

import { LateWithdrawalWarningDialog } from "@/components/LateWithdrawalWarningDialog";

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

// Resolve player photo:
// 1. First check if the player has an uploaded/custom picture on his user account
// 2. If not, check the Google photo associated with his account (from Google Auth or user profile)
// 3. Fallback to registration snapshots
const resolvePlayerPhoto = (profile: any, r?: any, isCurrentUser: boolean = false, authUser?: any): string | undefined => {
    // 1. User account custom/uploaded picture
    const customPhoto = profile?.customPhotoUrl || profile?.avatarUrl || profile?.avatar;
    if (typeof customPhoto === "string") {
        const trimmed = customPhoto.trim();
        if (trimmed && trimmed !== "null" && trimmed !== "undefined") {
            return trimmed;
        }
    }
    // Also check if profile.photoUrl is a custom uploaded photo (e.g. Firebase storage) and not a Google photo
    if (typeof profile?.photoUrl === "string") {
        const trimmed = profile.photoUrl.trim();
        if (trimmed && !trimmed.includes("googleusercontent.com") && trimmed !== "null" && trimmed !== "undefined") {
            return trimmed;
        }
    }

    // 2. Google photo associated with Google account
    const googlePhotoCandidates = [
        (typeof profile?.photoUrl === "string" && profile.photoUrl.includes("googleusercontent.com")) ? profile.photoUrl : null,
        profile?.photoURL,
        profile?.googlePhotoUrl,
        profile?.googlePhotoURL,
        isCurrentUser ? authUser?.photoURL : null,
        isCurrentUser ? authUser?.providerData?.find((p: any) => p?.providerId === "google.com" || p?.photoURL?.includes("googleusercontent.com"))?.photoURL : null,
    ];

    for (const candidate of googlePhotoCandidates) {
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (trimmed && trimmed !== "null" && trimmed !== "undefined") {
                return trimmed;
            }
        }
    }

    // 3. Fallback: Any photoUrl or photoURL on profile
    const anyProfilePhoto = profile?.photoUrl || profile?.photoURL;
    if (typeof anyProfilePhoto === "string") {
        const trimmed = anyProfilePhoto.trim();
        if (trimmed && trimmed !== "null" && trimmed !== "undefined") {
            return trimmed;
        }
    }

    // 4. Registration snapshot fallbacks
    const regPhotoCandidates = [
        r?.playerPhotoURL,
        r?.playerPhotoUrl,
        r?.photoURL,
        r?.photoUrl,
    ];
    for (const candidate of regPhotoCandidates) {
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (trimmed && trimmed !== "null" && trimmed !== "undefined") {
                return trimmed;
            }
        }
    }

    return undefined;
};

// Helper to calculate spots left
const calculateSpotsLeft = (event: EventData, registrations: Registration[], teams: Team[], isLoggedIn: boolean = false) => {
    const totalSpots = event.slotsAvailable || event.maxPlayers || 0;

    // Spec Rule 4.1: Count occupied spots for both CONFIRMED and active REPLACEMENT_GRACE teams
    if (event.unitType === "Teams") {
        const occupiedTeams = teams.filter(t => 
            t.status === 'CONFIRMED' || 
            (t.status === 'REPLACEMENT_GRACE' && !!(t.player1Id || t.player2Id) && (!t.replacementDeadlineAt || getTimestampMillis(t.replacementDeadlineAt) > Date.now()))
        );
        const count = isLoggedIn ? occupiedTeams.length : (event.confirmedTeamsCount ?? occupiedTeams.length);
        return Math.max(0, totalSpots - count);
    }

    // Player Mode
    const occupiedPlayers = registrations.filter(r => r.status === 'CONFIRMED');
    const count = isLoggedIn ? occupiedPlayers.length : (event.registrationsCount || 0);
    return Math.max(0, totalSpots - count);
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
    const handledInviteRef = useRef<string | null>(null);
    const [tournamentId, setTournamentId] = useState<string | null>(null);
    const [tournamentData, setTournamentData] = useState<{ status?: string; title?: string; mode?: string } | null>(null);

    // UI State
    const [isRegisterOpen, setIsRegisterOpen] = useState(false);
    const [isTeamRegisterOpen, setIsTeamRegisterOpen] = useState(false);
    const [isEligibilityGateOpen, setIsEligibilityGateOpen] = useState(false);
    const [eligibilityState, setEligibilityState] = useState<{
        isEmailVerified: boolean;
        hasPhone: boolean;
        isRedflagged?: boolean;
        redflagReason?: string;
    }>({
        isEmailVerified: true,
        hasPhone: true,
    });
    const [isLateWarningOpen, setIsLateWarningOpen] = useState(false);
    const [lateWarningMessage, setLateWarningMessage] = useState("");
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
                isRedflagged: eligibility.isRedflagged,
                redflagReason: eligibility.redflagReason,
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
        if (!user) {
            setRegistrations([]);
            return;
        }
        const q = query(collection(db, "registrations"), where("eventId", "==", eventId));
        const unsub = onSnapshot(q, (snapshot) => {
            const regs = snapshot.docs.map(d => ({ ...d.data(), id: d.id, registrationId: d.id } as unknown as Registration));
            setRegistrations(regs);
        }, (err) => {
            if (err.code !== "permission-denied") {
                console.error("Error fetching registrations:", err);
            }
        });
        return () => unsub();
    }, [eventId, user]);

    // 4. Fetch Tournament linked to this Event (1-to-1)
    useEffect(() => {
        if (!eventId) return;
        const qTournament = query(collection(db, "tournaments"), where("eventId", "==", eventId));
        const unsub = onSnapshot(qTournament, (snap) => {
            if (!snap.empty) {
                setTournamentId(snap.docs[0].id);
                setTournamentData(snap.docs[0].data() as any);
            } else {
                setTournamentId(null);
                setTournamentData(null);
            }
        }, (err) => {
            console.error("Error listening to tournament for event:", err);
        });
        return () => unsub();
    }, [eventId]);

    // 3. Fetch Teams (Conditional Optimization)
    useEffect(() => {
        if (!eventId) return;
        if (!user) {
            setTeams([]);
            return;
        }

        // OPTIMIZATION: Stop here if we know for sure this isn't a team event
        // Note: We check 'event' existence first to avoid errors
        if (event && !event.isTeamRegistration && event.unitType !== "Teams") {
            return;
        }

        const q = query(collection(db, "teams"), where("eventId", "==", eventId));
        const unsub = onSnapshot(q, (snapshot) => {
            const teamsData = snapshot.docs.map(d => ({ teamId: d.id, ...d.data() } as Team));
            setTeams(teamsData);
        }, (err) => {
            if (err.code !== "permission-denied") {
                console.error("Error fetching teams:", err);
            }
        });
        return () => unsub();
    }, [eventId, event, event?.unitType, event?.isTeamRegistration, user]);

    // 4. Fetch User Profiles
    const allPlayerIdsString = useMemo(() => {
        const ids = new Set<string>();
        registrations.forEach(r => {
            if (r.playerId) ids.add(r.playerId);
            if (r.player2Id) ids.add(r.player2Id);
            if ((r as any).userId) ids.add((r as any).userId);
            if ((r as any).uid) ids.add((r as any).uid);
        });
        teams.forEach(t => {
            if (t.player1Id) ids.add(t.player1Id);
            if (t.player2Id) ids.add(t.player2Id);
        });
        if (user) ids.add(user.uid);
        return Array.from(ids).filter(Boolean).sort().join(',');
    }, [registrations, teams, user]);

    useEffect(() => {
        const fetchProfiles = async () => {
            if (!allPlayerIdsString || !user) return;
            const playerIds = allPlayerIdsString.split(',');
            const missingIds = playerIds.filter(id =>
                id && !userProfiles[id] && !fetchedIds.current.has(id)
            );

            if (missingIds.length > 0) {
                const chunks = [];
                for (let i = 0; i < missingIds.length; i += 10) {
                    chunks.push(missingIds.slice(i, i + 10));
                }

                const newProfiles: Record<string, FirestoreUser> = {};
                for (const chunk of chunks) {
                    try {
                        const q = query(collection(db, "users"), where(documentId(), "in", chunk));
                        const snapshot = await getDocs(q);
                        snapshot.docs.forEach(docSnap => {
                            fetchedIds.current.add(docSnap.id);
                            newProfiles[docSnap.id] = docSnap.data() as FirestoreUser;
                        });
                    } catch (error: unknown) {
                        console.error("Error fetching chunk:", chunk, error);
                        // Fallback: try individual getDoc
                        for (const id of chunk) {
                            try {
                                const singleSnap = await getDoc(doc(db, "users", id));
                                if (singleSnap.exists()) {
                                    fetchedIds.current.add(id);
                                    newProfiles[id] = singleSnap.data() as FirestoreUser;
                                }
                            } catch {
                                // Will retry next time
                            }
                        }
                    }
                }

                if (Object.keys(newProfiles).length > 0) {
                    setUserProfiles(prev => ({ ...prev, ...newProfiles }));
                }
            }
        };
        fetchProfiles();
    }, [allPlayerIdsString, userProfiles, user]);

    // Profile listener for the logged-in user to guarantee instant avatar and profile sync
    useEffect(() => {
        if (!user) return;
        const userDocRef = doc(db, "users", user.uid);
        const unsub = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as FirestoreUser;
                setUserProfiles(prev => ({
                    ...prev,
                    [user.uid]: {
                        ...data,
                        photoURL: data.photoUrl || data.photoURL || user.photoURL || undefined,
                        photoUrl: data.photoUrl || data.photoURL || user.photoURL || undefined,
                    }
                }));
            } else if (user.photoURL || user.displayName) {
                setUserProfiles(prev => ({
                    ...prev,
                    [user.uid]: {
                        uid: user.uid,
                        displayName: user.displayName || "Me",
                        photoURL: user.photoURL || undefined,
                        photoUrl: user.photoURL || undefined,
                    } as FirestoreUser
                }));
            }
        }, (err) => {
            if (err.code !== "permission-denied") console.error("Current user profile listener error:", err);
        });
        return () => unsub();
    }, [user]);

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

    // 7. Auto-expiry trigger for teams in REPLACEMENT_GRACE
    useEffect(() => {
        if (!eventId || teams.length === 0) return;

        const graceTeams = teams.filter(t => t.status === "REPLACEMENT_GRACE");
        if (graceTeams.length === 0) return;

        const now = Date.now();
        let earliestUpcomingDeadline: number | null = null;
        let hasExpiredGraceTeam = false;

        for (const team of graceTeams) {
            const deadlineMs = getTimestampMillis(team.replacementDeadlineAt);
            if (deadlineMs > 0) {
                if (now >= deadlineMs) {
                    hasExpiredGraceTeam = true;
                } else {
                    if (earliestUpcomingDeadline === null || deadlineMs < earliestUpcomingDeadline) {
                        earliestUpcomingDeadline = deadlineMs;
                    }
                }
            }
        }

        const triggerCheckExpiry = async () => {
            try {
                await fetch("/api/events/teams/check-expiry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ eventId }),
                });
            } catch (err) {
                console.error("[check-expiry] Failed to check grace expiry:", err);
            }
        };

        if (hasExpiredGraceTeam) {
            triggerCheckExpiry();
        }

        if (earliestUpcomingDeadline !== null) {
            const delay = Math.max(500, earliestUpcomingDeadline - now + 500);
            const timer = setTimeout(() => {
                triggerCheckExpiry();
            }, delay);
            return () => clearTimeout(timer);
        }
    }, [eventId, teams]);

    // Derived State
    const userRegistration = useMemo<Registration | undefined>(() => {
        if (!user) return undefined;

        // Check for solo registration (Players mode or looking for partner in Teams mode)
        const soloReg = registrations.find(r => 
            (r.playerId === user.uid || r.player2Id === user.uid) && r.status !== "CANCELLED"
        );
        if (soloReg) {
            if ((soloReg.status === "CONFIRMED" || soloReg.status === "WAITLIST") && event?.unitType === "Players") {
                return {
                    ...soloReg,
                    lookingForPartner: false,
                };
            }
            if (soloReg.teamId) {
                const targetTeam = teams.find(t => t.teamId === soloReg.teamId);
                if (!targetTeam || targetTeam.status === "CANCELLED" || targetTeam.status === "EXPIRED") {
                    return {
                        ...soloReg,
                        teamId: null,
                        lookingForPartner: true,
                        partnerStatus: undefined,
                    };
                }
            } else if (soloReg.status === "PENDING" || soloReg.lookingForPartner === true) {
                return {
                    ...soloReg,
                    lookingForPartner: true,
                };
            }
            return soloReg;
        }

        // Check if user is part of a team (Teams mode)
        const userTeam = teams.find(t => {
            if (t.status === "CANCELLED" || t.status === "EXPIRED") return false;
            if (t.status === "REPLACEMENT_GRACE") {
                // If the user is the one who withdrew, they have no active registration here
                if (t.replacementForPlayerId === user.uid) return false;
                if (t.vacantSlot === "PLAYER1" && t.player1Id === user.uid) return false;
                if (t.vacantSlot === "PLAYER2" && t.player2Id === user.uid) return false;
                return t.player1Id === user.uid || t.player2Id === user.uid;
            }
            if (t.status === "PENDING") {
                // An unconfirmed invitee in a pending proposal is not registered yet
                return t.player1Id === user.uid;
            }
            return t.player1Id === user.uid || t.player2Id === user.uid;
        });

        // If user is in a team, create a pseudo-registration object for UI consistency
        if (userTeam) {
            return {
                registrationId: userTeam.teamId,
                eventId: event?.eventId || "",
                playerId: user.uid,
                registeredAt: userTeam.createdAt,
                status: userTeam.status as "CONFIRMED" | "PENDING",
                isPrimary: true,
                teamId: userTeam.teamId,
                lookingForPartner: false
            } as Registration;
        }

        return undefined;
    }, [user, registrations, teams, event]);

    // Check for pending invites
    const hasPendingInvite = useMemo(() => {
        if (!user) return false;
        return teams.some(t => t.player2Id === user.uid && t.status === "PENDING");
    }, [user, teams]);

    const spotsLeft = useMemo(() => {
        return event ? calculateSpotsLeft(event, registrations, teams, !!user) : 0;
    }, [event, registrations, teams, user]);

    const isEventCompleted = useMemo(() => {
        if (!event) return false;
        const isCancelled = event.status === "Cancelled" || event.status === "cancelled" || !!event.cancellationMessage;
        if (isCancelled) return false;
        const isPast = event.eventDate ? event.eventDate.toDate() < new Date() : false;
        return spotsLeft === 0 || isPast;
    }, [event, spotsLeft]);

    // C. Build the Team List (Single Source of Truth: The 'teams' collection)
    const teamsWithPlayers = useMemo(() => {
        return [...teams]
            .filter(team => team.status !== "CANCELLED" && team.status !== "EXPIRED")
            .sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt))
            .map(team => {
                const p1 = userProfiles[team.player1Id];
                const p2 = userProfiles[team.player2Id];
                const teamLegacy = team as TeamWithLegacyData;

                const p1Photo = resolvePlayerPhoto(p1, null, user?.uid === team.player1Id, user) || teamLegacy.player1PhotoURL || undefined;
                const p2Photo = resolvePlayerPhoto(p2, null, user?.uid === team.player2Id, user) || teamLegacy.player2PhotoURL || undefined;

                return {
                    ...team,
                    player1: (p1 || team.player1Id === user?.uid || teamLegacy.player1Name) ? {
                        uid: team.player1Id,
                        displayName: p1?.fullName || p1?.fullname || p1?.displayName || teamLegacy.player1Name || teamLegacy.fullNameP1 || (user?.uid === team.player1Id ? user.displayName : undefined) || "Unknown Player",
                        photoURL: p1Photo,
                        photoUrl: p1Photo,
                        skillLevel: p1?.skillLevel || p1?.level || undefined
                    } : undefined,
                    player2: (p2 || team.player2Id === user?.uid || teamLegacy.player2Name) ? {
                        uid: team.player2Id,
                        displayName: p2?.fullName || p2?.fullname || p2?.displayName || teamLegacy.player2Name || teamLegacy.fullNameP2 || (user?.uid === team.player2Id ? user.displayName : undefined) || "Unknown Player",
                        photoURL: p2Photo,
                        photoUrl: p2Photo,
                        skillLevel: p2?.skillLevel || p2?.level || undefined
                    } : undefined
                };
            });
    }, [teams, userProfiles, user]);

    const confirmedTeams = useMemo(() => {
        return teamsWithPlayers.filter(t => t.status === "CONFIRMED");
    }, [teamsWithPlayers]);

    // D. Build the Single Players List (Free Agents)
    const singlePlayers = useMemo(() => {
        // 1. Create a "Block List" of players who are already in a committed team (CONFIRMED, WAITLIST, REPLACEMENT_GRACE)
        const committedPlayerIds = new Set<string>();
        teamsWithPlayers.forEach(t => {
            if (t.status === 'CONFIRMED' || t.status === 'WAITLIST') {
                if (t.player1Id) committedPlayerIds.add(t.player1Id);
                if (t.player2Id) committedPlayerIds.add(t.player2Id);
            } else if (t.status === 'REPLACEMENT_GRACE') {
                // In REPLACEMENT_GRACE, only the surviving player is committed; the withdrawn player is free
                const survivingId = t.vacantSlot === 'PLAYER2' ? t.player1Id : t.player2Id;
                if (survivingId) committedPlayerIds.add(survivingId);
            }
        });

        // 2. Set of active teams (not cancelled or expired)
        const activeTeamIds = new Set(
            teams
                .filter(t => t.status !== 'CANCELLED' && t.status !== 'EXPIRED')
                .map(t => t.teamId)
        );

        // 3. Filter Registrations using master spec "Free Agent" rules (Spec Section 2.3)
        return registrations
            .filter(r => {
                if (r.status === 'CANCELLED') return false;
                if (committedPlayerIds.has(r.playerId)) return false;

                const hasActiveTeam = r.teamId ? activeTeamIds.has(r.teamId) : false;

                // Free Agent: status === PENDING && !hasActiveTeam, or explicitly lookingForPartner
                const isFreeAgent = (r.status === 'PENDING' && !hasActiveTeam) || r.lookingForPartner === true;
                return isFreeAgent;
            })
            .sort((a, b) => getTimestampMillis(a.registeredAt || a.createdAt) - getTimestampMillis(b.registeredAt || b.createdAt))
            .map(r => {
                // Enrich with profile data
                const profile = userProfiles[r.playerId];
                const photo = resolvePlayerPhoto(profile, r, user?.uid === r.playerId, user);
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || (user?.uid === r.playerId ? user.displayName : undefined) || "Unknown Player",
                    photoURL: photo,
                    photoUrl: photo,
                    lookingForPartner: true,
                    playerHand: profile?.hand || r.playerHand,
                    playerPosition: profile?.position || r.playerPosition,
                    playerSkillLevel: profile?.skillLevel || profile?.level || r.playerSkillLevel,
                    status: r.status,
                    waitlistPosition: r.waitlistPosition,
                    registeredAt: r.registeredAt || r.createdAt,
                };
            });
    }, [registrations, userProfiles, teamsWithPlayers, user]);

    // E. Confirmed Players List (Single Player Mode)
    const confirmedPlayers = useMemo(() => {
        // 1. OPTIMIZATION: Stop if this is NOT a Single Player event
        // We assume Team events use the "Teams" logic we built earlier
        if (!event || event.unitType !== "Players") return [];

        return registrations
            .filter(r => r.status === "CONFIRMED")
            .sort((a, b) => getTimestampMillis(a.registeredAt || a.createdAt) - getTimestampMillis(b.registeredAt || b.createdAt))
            .map(r => {
                const profile = userProfiles[r.playerId];
                const photo = resolvePlayerPhoto(profile, r, user?.uid === r.playerId, user);
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || (user?.uid === r.playerId ? user.displayName : undefined) || "Unknown",
                    photoURL: photo,
                    photoUrl: photo,
                    lookingForPartner: false, // In singles mode, you are just "in", not looking
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level,
                    partnerStatus: r.partnerStatus,
                    registeredAt: r.registeredAt || r.createdAt,
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event, user]);

    // F. Waitlist Players List (Single Player Mode)
    const waitlistPlayers = useMemo(() => {
        // 1. OPTIMIZATION: Stop if this is NOT a Single Player event
        // We assume Team events use the "Teams" logic we built earlier
        if (!event || event.unitType !== "Players") return [];

        const seenPlayerIds = new Set<string>();

        return registrations
            .filter(r => {
                if (!r.playerId) return false;
                if (r.status === "CANCELLED") return false;
                if (r.status === "CONFIRMED") return false;

                // In Single Player mode, both explicit WAITLIST registrations
                // and Free Agents / PENDING players (looking for a partner or converted from teams mode)
                // must be included in the waitlist.
                const isWaitlistOrFreeAgent =
                    r.status === "WAITLIST" ||
                    r.status === "PENDING" ||
                    r.lookingForPartner === true;

                if (!isWaitlistOrFreeAgent) return false;
                if (seenPlayerIds.has(r.playerId)) return false;
                seenPlayerIds.add(r.playerId);
                return true;
            })
            .sort((a, b) => {
                const posA = a.waitlistPosition ?? a.waitlistSequence;
                const posB = b.waitlistPosition ?? b.waitlistSequence;
                if (typeof posA === "number" && typeof posB === "number" && posA !== posB) {
                    return posA - posB;
                }
                return getTimestampMillis(a.registeredAt || a.createdAt) - getTimestampMillis(b.registeredAt || b.createdAt);
            })
            .map(r => {
                const profile = userProfiles[r.playerId];
                const photo = resolvePlayerPhoto(profile, r, user?.uid === r.playerId, user);
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || (user?.uid === r.playerId ? user.displayName : undefined) || "Unknown",
                    photoURL: photo,
                    photoUrl: photo,
                    lookingForPartner: false,
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level,
                    waitlistPosition: r.waitlistPosition,
                    waitlistSequence: r.waitlistSequence,
                    partnerStatus: r.partnerStatus,
                    status: r.status,
                    registeredAt: r.registeredAt || r.createdAt,
                } as SinglePlayer;
            });
    }, [registrations, userProfiles, event, user]);

    // G. Changed Minds Players List (All Modes)
    const changedMindPlayers = useMemo(() => {
        if (!event) return [];

        // Build a set of all players who currently have an active registration or team commitment
        const activePlayerIds = new Set<string>();
        registrations.forEach(r => {
            if (r.status === "CONFIRMED" || r.status === "WAITLIST" || r.status === "PENDING") {
                if (r.playerId) activePlayerIds.add(r.playerId);
                if (r.player2Id) activePlayerIds.add(r.player2Id);
            }
        });
        if (event.unitType === "Teams") {
            teams.forEach(t => {
                if (['CONFIRMED', 'WAITLIST', 'PENDING', 'REPLACEMENT_GRACE'].includes(t.status)) {
                    if (t.player1Id) activePlayerIds.add(t.player1Id);
                    if (t.player2Id) activePlayerIds.add(t.player2Id);
                }
            });
        }

        const seenPlayerIds = new Set<string>();

        return registrations
            .filter(r => {
                if (!r.playerId) return false;
                // Exclude any player who currently has an active commitment
                if (activePlayerIds.has(r.playerId)) return false;
                // Only consider non-active statuses (e.g. CANCELLED)
                if (r.status === "CONFIRMED" || r.status === "WAITLIST" || r.status === "PENDING") return false;
                // Deduplicate by playerId
                if (seenPlayerIds.has(r.playerId)) return false;
                seenPlayerIds.add(r.playerId);
                return true;
            })
            .sort((a, b) => {
                const timeA = getTimestampMillis(a.cancelledAt || a.registeredAt || a.createdAt);
                const timeB = getTimestampMillis(b.cancelledAt || b.registeredAt || b.createdAt);
                return timeB - timeA;
            })
            .map(r => {
                const profile = userProfiles[r.playerId];
                const photo = resolvePlayerPhoto(profile, r, user?.uid === r.playerId, user);
                return {
                    registrationId: r.registrationId,
                    playerId: r.playerId,
                    displayName: profile?.displayName || profile?.fullName || profile?.fullname || r.fullNameP1 || r.playerDisplayName || (user?.uid === r.playerId ? user.displayName : undefined) || "Unknown",
                    photoURL: photo,
                    photoUrl: photo,
                    lookingForPartner: false,
                    playerHand: profile?.hand,
                    playerPosition: profile?.position,
                    playerSkillLevel: profile?.skillLevel || profile?.level,
                    registeredAt: r.cancelledAt || r.registeredAt || r.createdAt,
                } as SinglePlayer;
            });
    }, [registrations, teams, userProfiles, event, user]);

    // Single source of truth for waiting list count and unit
    const waitlistCount = useMemo(() => {
        if (!event) return 0;
        return event.unitType === "Teams"
            ? teams.filter(t => t.status === "WAITLIST").length
            : waitlistPlayers.length;
    }, [event, teams, waitlistPlayers]);

    const waitlistUnit = useMemo(() => {
        if (!event) return "players";
        const isTeam = event.unitType === "Teams";
        return isTeam
            ? (waitlistCount === 1 ? "team" : "teams")
            : (waitlistCount === 1 ? "player" : "players");
    }, [event, waitlistCount]);

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
            const waitlistTeams = teamsWithPlayers
                .filter(t => t.status === "WAITLIST")
                .sort((a, b) => {
                    const seqA = a.waitlistSequence;
                    const seqB = b.waitlistSequence;
                    if (typeof seqA === "number" && typeof seqB === "number" && seqA !== seqB) {
                        return seqA - seqB;
                    }
                    return getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt);
                });
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

    const executeWithdraw = async (confirmLate: boolean = false) => {
        if (!user) {
            showToast("You must be logged in to withdraw", "error");
            return;
        }

        if (!event) {
            showToast("Event data is missing", "error");
            return;
        }

        let effectiveReg = userRegistration;
        if (!effectiveReg) {
            const directMatch = registrations.find(r => 
                (r.playerId === user.uid || r.player2Id === user.uid) && r.status !== "CANCELLED"
            );
            if (directMatch) {
                effectiveReg = directMatch;
            }
        }

        try {
            showToast("Processing withdrawal...", "info");
            const userTeam = teams.find(t => {
                if (t.status === "CANCELLED" || t.status === "EXPIRED") return false;
                if (t.status === "REPLACEMENT_GRACE") {
                    if (t.replacementForPlayerId === user.uid) return false;
                    if (t.vacantSlot === "PLAYER1" && t.player1Id === user.uid) return false;
                    if (t.vacantSlot === "PLAYER2" && t.player2Id === user.uid) return false;
                }
                return t.player1Id === user.uid || t.player2Id === user.uid;
            });
            const teamId = userTeam ? userTeam.teamId : (effectiveReg?.teamId || null);

            const result = await withdraw(user, event, effectiveReg as Registration || null, teamId, () => {
                showToast("Successfully withdrawn from event!", "success");
            }, confirmLate);

            if (result?.requiresConfirmation) {
                setLateWarningMessage(result.message || "Withdrawing within the late-withdrawal window (18/12 hours before event start) will apply a red flag to your account.");
                setIsLateWarningOpen(true);
            }
        } catch (error: unknown) {
            console.error("[handleWithdraw] Error caught during withdraw:", error);
            showToast(error instanceof Error ? error.message : "Failed to withdraw", "error");
        }
    };

    const handleWithdraw = () => executeWithdraw(false);

    const handleConfirmLateWithdrawal = async () => {
        setIsLateWarningOpen(false);
        await executeWithdraw(true);
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
                            {/* Tournament Button: Visible to ALL users when tournament exists */}
                            {tournamentId ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 px-2.5 sm:px-3 text-amber-400 bg-amber-500/10 border-amber-500/50 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-400 transition-all flex items-center gap-1.5 shadow-sm font-semibold cursor-pointer"
                                    onClick={() => router.push(`/events/${eventId}/tournament`)}
                                    title={isAdmin || (user && event?.adminId === user.uid) ? "Open Tournament Workspace" : "View Live Tournament & Scores"}
                                    aria-label={isAdmin || (user && event?.adminId === user.uid) ? "Open Tournament Workspace" : "View Live Tournament & Scores"}
                                >
                                    <Trophy className="w-4 h-4 shrink-0 text-amber-400" />
                                    <span className="hidden sm:inline font-medium">
                                        {isAdmin || (user && event?.adminId === user.uid) ? "Tournament Workspace" : "Tournament & Scores"}
                                    </span>
                                </Button>
                            ) : (isAdmin || (user && event?.adminId === user.uid)) && isEventCompleted ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 px-2.5 sm:px-3 text-amber-400 bg-gray-900/90 border-amber-500/50 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-400 transition-all flex items-center gap-1.5 shadow-sm font-semibold cursor-pointer"
                                    onClick={() => router.push(`/events/${eventId}/tournament/create`)}
                                    title="Create a Tournament"
                                    aria-label="Create a Tournament"
                                >
                                    <Trophy className="w-4 h-4 shrink-0 text-amber-400" />
                                    <span className="hidden sm:inline font-medium">Create a Tournament</span>
                                </Button>
                            ) : null}

                            {(isAdmin || (user && event?.adminId === user.uid)) && (
                                <>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 px-2.5 sm:px-3 text-emerald-400 bg-gray-900/90 border-emerald-500/50 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-400 transition-all flex items-center gap-1.5 shadow-sm"
                                        onClick={() => router.push(`/events/${eventId}/admin`)}
                                        title="Activity Feed"
                                        aria-label="Activity Feed"
                                    >
                                        <Activity className="w-4 h-4 shrink-0" />
                                        <span className="hidden sm:inline font-medium">Activity</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 px-2.5 sm:px-3 text-blue-400 bg-gray-900/90 border-blue-500/50 hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-400 transition-all flex items-center gap-1.5 shadow-sm"
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
                                        className="h-9 px-2.5 sm:px-3 text-orange-400 bg-gray-900/90 border-orange-500/50 hover:bg-orange-500/20 hover:text-orange-300 hover:border-orange-400 transition-all flex items-center gap-1.5 shadow-sm"
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
                                        {(() => {
                                            const d = parseFirebaseDate(event.eventDate || event.dateTime);
                                            return d ? format(d, "MMM d, yyyy") : "TBD";
                                        })()}
                                    </div>
                                </div>
                                <div className="bg-gray-950/50 p-3 sm:p-4 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-2 text-gray-500 mb-1 text-[10px] sm:text-xs uppercase tracking-wider">
                                        <Clock className="h-3 w-3" /> Time
                                    </div>
                                    <div className="text-sm sm:text-base font-semibold text-white">
                                        {(() => {
                                            const d = parseFirebaseDate(event.eventDate || event.dateTime);
                                            return d ? format(d, "h:mm a") : "TBD";
                                        })()}
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
                                    ? `${teams.filter(t => t.status === 'CONFIRMED').length} / ${event.slotsAvailable || event.maxPlayers || 0} Teams`
                                    : `${confirmedPlayers.length} / ${event.maxPlayers || event.slotsAvailable || 0} Players`
                                }
                            </span>
                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                                {event.unitType === "Teams" ? Math.floor(spotsLeft) : spotsLeft} {event.unitType === "Teams" ? "teams" : "spots"} left
                            </Badge>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-linear-to-r from-orange-500 to-red-500 transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, (((event.unitType === "Teams" ? (event.slotsAvailable || event.maxPlayers || 1) : (event.maxPlayers || event.slotsAvailable || 1)) - spotsLeft) / (event.unitType === "Teams" ? (event.slotsAvailable || event.maxPlayers || 1) : (event.maxPlayers || event.slotsAvailable || 1))) * 100))}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {event.unitType === "Teams"
                                ? "This is a team event. Register with a partner or find one from the single players list."
                                : "This is a single player event. Register to secure your spot."
                            }
                        </p>
                        <div className={`flex items-center gap-1.5 text-xs font-medium mt-2.5 ${waitlistCount > 0 ? 'text-amber-500' : 'text-gray-400'}`}>
                            <Clock className={`w-3.5 h-3.5 ${waitlistCount > 0 ? 'text-amber-500/80' : 'text-gray-500'}`} />
                            <span>Waiting list: {waitlistCount} {waitlistUnit}</span>
                        </div>
                    </div>

                    {/* Active/Completed Tournament Banner (Visible to ALL users) */}
                    {tournamentId && (
                        <div className="mt-8 p-4 sm:p-5 rounded-2xl bg-linear-to-r from-amber-950/40 via-slate-900 to-amber-950/20 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg shadow-amber-500/5 animate-in fade-in duration-300">
                            <div className="flex items-center gap-3.5">
                                <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                                    <Trophy className="w-6 h-6 text-amber-400" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-bold text-white">
                                            {tournamentData?.title || "Tournament In Progress"}
                                        </span>
                                        <Badge className="bg-amber-500 text-slate-950 font-bold text-[10px] px-2 py-0.5">
                                            {tournamentData?.status === "completed" ? "COMPLETED" : "LIVE SCORES"}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {tournamentData?.status === "completed"
                                            ? "Tournament finalized. View official podium, rankings, and match results."
                                            : "Track live court matches, scores, and official leaderboard in real time."}
                                    </p>
                                </div>
                            </div>
                            <Button
                                onClick={() => router.push(`/events/${eventId}/tournament`)}
                                className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs h-10 px-5 rounded-xl shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                            >
                                <Trophy className="w-4 h-4 text-slate-950" />
                                {isAdmin || (user && event?.adminId === user.uid)
                                    ? "Open Tournament Workspace"
                                    : "View Live Scores & Rankings"}
                            </Button>
                        </div>
                    )}

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
                                    Teams ({confirmedTeams.length})
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
                isRedflagged={eligibilityState.isRedflagged}
                redflagReason={eligibilityState.redflagReason}
                onVerifiedRefresh={() => {
                    setIsEligibilityGateOpen(false);
                    if (event) {
                        handleOpenRegistration(event.unitType === "Teams");
                    }
                }}
            />

            <LateWithdrawalWarningDialog
                open={isLateWarningOpen}
                onOpenChange={setIsLateWarningOpen}
                onConfirm={handleConfirmLateWithdrawal}
                message={lateWarningMessage}
            />
        </div>
    );
}
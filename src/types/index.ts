import { Timestamp } from "firebase/firestore";
import { StorageReference } from "firebase/storage";

export interface EventData {
    adminId: string;
    cancellationMessage?: string;
    createdAt: Timestamp;
    dateTime: Timestamp;
    duration: number;
    eventId: string;
    eventName: string;
    isPublic: boolean;
    isTeamRegistration: boolean;
    locationName: string;
    logoUrl?: string;
    pricePerPlayer: number;
    slotsAvailable: number;
    status: string;
    termsAndConditions?: string;
    unitType: "Players" | "Teams";
    clubId?: string;
    coordinates?: {
        lat: number;
        lng: number;
    };
    registrationsCount?: number;
    waitlistCount?: number;
    // UI compatibility fields
    maxPlayers?: number;
    eventDate?: Timestamp;
    eventImage?: string;
    eventType?: string;
    location?: string;
    price?: number;
    level?: string;
    image?: string;
    title?: string;
}

export type Event = EventData;

export interface Registration {
    registrationId: string;
    eventId: string;
    playerId: string;
    registeredAt: Timestamp;
    status: "CONFIRMED" | "WAITLIST" | "PENDING" | "CANCELLED";
    isPrimary: boolean;
    teamId?: string;
    partnerStatus?: "CONFIRMED" | "PENDING" | "NONE" | "DENIED";
    waitlistPosition?: number;
    fullNameP1?: string;
    fullNameP2?: string;
    playerDisplayName?: string;
    playerPhotoURL?: string;
    playerLevel?: string;
    playerSkillLevel?: string;
    playerHand?: string;
    playerPosition?: string;
    lookingForPartner?: boolean;
    player2Id?: string;
}

export interface User {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    // Compatibility fields
    photoUrl?: string;
    fullName?: string;
    fullname?: string;
    firstName?: string;
    lastName?: string;
    skillLevel?: string;
    level?: string;
    hand?: string;
    position?: string;
}

export interface TeamMember {
    uid: string;
    displayName: string;
    photoURL?: string;
}

export interface Team {
    teamId: string;
    eventId: string;
    player1Id: string;
    player2Id: string;
    player1Confirmed: boolean;
    player2Confirmed: boolean;
    status: "CONFIRMED" | "PENDING" | "WAITLIST";
    createdAt: Timestamp;
}

export interface UserProfile extends User {
    bio?: string;
    location?: string;
    role?: string;
    createdAt?: Timestamp | { seconds: number; nanoseconds: number };
    nickname?: string;
    dateOfBirth?: Timestamp | { seconds: number; nanoseconds: number } | null;
    // Admin fields
    notes?: string;
    phone?: string;
    gender?: string;
    registrationStatus?: string;
    isShadow?: boolean;
    isAdmin?: boolean;
}

export interface Notification {
    notificationId: string;
    type: "partner_invite" | "partner_accepted" | "partner_declined" | "welcome" | "system" | "EVENT_CANCELLED" | "WAITLIST_PROMOTED" | "WAITLIST_DEMOTED";
    title: string;
    message: string;
    read: boolean;
    createdAt: Timestamp;
    eventId?: string;
    eventName?: string;
    eventDate?: Timestamp;
    fromUserId?: string;
    teamId?: string;
    action?: string;
    redirect?: string;
}

export interface ClubData {
    id: string;
    name: string;
    location?: {
        address?: string;
        coordinates?: {
            lat: number;
            lng: number;
        };
    };
    phone?: string;
    pictureUrl?: string;
    notes?: string;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

export interface StorageItem {
    name: string;
    fullPath: string;
    url?: string;
    isFolder: boolean;
    ref: StorageReference;
}

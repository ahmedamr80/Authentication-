import { Timestamp } from "firebase/firestore";

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
    // UI fields
    maxPlayers?: number; // Alias for slotsAvailable
    eventDate?: Timestamp; // Alias for dateTime
    eventImage?: string; // Alias for logoUrl
    eventType?: string;
    location?: string; // Alias for locationName
    price?: number; // Alias for pricePerPlayer
    level?: string;
    image?: string;
    title?: string;
}

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
    playerDisplayName?: string;
    playerPhotoURL?: string;
    playerLevel?: string;
    playerSkillLevel?: string;
    playerHand?: string;
    playerPosition?: string;
    lookingForPartner?: boolean;
    player2Id?: string; // For legacy/denormalized team registrations
}


export interface User {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    // Compatibility fields for different user document structures
    photoUrl?: string;
    fullName?: string;
    fullname?: string; // Handle lowercase variant
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
    status: "CONFIRMED" | "PENDING";
    createdAt: Timestamp;
}

// Alias for compatibility if needed
export type Event = EventData;

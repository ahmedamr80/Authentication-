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
    confirmedTeamsCount?: number;
    waitlistCount?: number;
    registrationStatus?: "OPEN" | "CLOSED";
    eventStatus?: "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED";
    registrationDeadline?: Timestamp;
    eventStartAt?: Timestamp;
    inviteTtlHours?: number;
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
    isPrimary?: boolean;
    teamId?: string | null;
    partnerStatus?: "CONFIRMED" | "PENDING" | "NONE" | "DENIED" | "CANCELLED" | "REPLACEMENT_GRACE";
    lookingForPartner?: boolean;
    waitlistPosition?: number | null;
    waitlistSequence?: number | null;
    fullName?: string;
    fullNameP1?: string;
    fullNameP2?: string;
    playerDisplayName?: string;
    playerPhotoURL?: string;
    playerLevel?: string;
    playerSkillLevel?: string;
    playerHand?: string;
    playerPosition?: string;
    player2Id?: string | null;
    confirmedAt?: Timestamp | null;
    withdrawnAt?: Timestamp | null;
    cancelledAt?: Timestamp | null;
    createdAt?: Timestamp | null;
}

export interface User {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    redflagged?: boolean;
    redflaggedAt?: Timestamp | null;
    redflagReason?: string | null;
    redflagEventId?: string | null;
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
    role?: string;
    isAdmin?: boolean | string;
}

export interface TeamMember {
    uid: string;
    displayName: string;
    photoURL?: string;
    photoUrl?: string;
    skillLevel?: string;
}

export interface Team {
    teamId: string;
    eventId: string;
    player1Id: string;
    player2Id: string;
    player1Confirmed: boolean;
    player2Confirmed: boolean;
    status: "PENDING" | "CONFIRMED" | "WAITLIST" | "REPLACEMENT_GRACE" | "CANCELLED" | "EXPIRED";
    invitationType?: "STANDARD" | "REPLACEMENT";
    invitationExpiresAt?: Timestamp | null;
    waitlistSequence?: number | null;
    replacementForPlayerId?: string | null;
    replacementCandidateId?: string | null;
    replacementInviteExpiresAt?: Timestamp | null;
    replacementDeadlineAt?: Timestamp | null;
    vacantSlot?: "PLAYER1" | "PLAYER2" | null;
    fullNameP1?: string;
    fullNameP2?: string;
    createdAt: Timestamp;
    acceptedAt?: Timestamp | null;
    promotedAt?: Timestamp | null;
    cancelledAt?: Timestamp | null;
    cancelledBy?: string | null;
    cancelReason?: string | null;
    player1?: TeamMember;
    player2?: TeamMember;
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

export type NotificationType =
    | "partner_invite"
    | "partner_accepted"
    | "partner_declined"
    | "welcome"
    | "system"
    | "EVENT_CANCELLED"
    | "EVENT_DELETED"
    | "WAITLIST_PROMOTED"
    | "WAITLIST_DEMOTED"
    | "PARTNER_INVITE"
    | "PARTNER_ACCEPTED"
    | "PARTNER_DECLINED"
    | "INVITATION_CANCELLED"
    | "INVITATION_EXPIRED"
    | "INVITATION_SUPERSEDED"
    | "REGISTRATION_CONFIRMED"
    | "REGISTRATION_WAITLISTED"
    | "TEAM_CANCELLED"
    | "REPLACEMENT_GRACE_STARTED"
    | "REPLACEMENT_INVITE"
    | "REPLACEMENT_INVITE_CANCELLED"
    | "REPLACEMENT_ACCEPTED"
    | "REPLACEMENT_GRACE_EXPIRED";

export interface Notification {
    notificationId: string;
    type: NotificationType;
    title: string;
    message: string;
    read: boolean;
    createdAt: Timestamp;
    userId?: string;
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

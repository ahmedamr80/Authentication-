import type { Metadata } from "next";
import { getAdminFirestore } from "@/lib/firebase-admin";

interface Props {
    params: Promise<{ eventId: string }>;
    children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { eventId } = await params;

    try {
        const adminDb = getAdminFirestore();
        const eventDoc = await adminDb.collection("events").doc(eventId).get();

        if (eventDoc.exists) {
            const event = eventDoc.data();
            const eventName = event?.eventName || "Padel Event";
            const location = event?.location || event?.locationName || "Padel Club";
            const logoUrl = event?.logoUrl || event?.eventImage || "https://ewpuae.com/logo.png";

            return {
                title: `${eventName} | EveryWherePadel`,
                description: `Join ${eventName} at ${location}. Register now on EveryWherePadel!`,
                openGraph: {
                    title: eventName,
                    description: `Join ${eventName} at ${location}. Register now on EveryWherePadel!`,
                    url: `https://ewpuae.com/events/${eventId}`,
                    siteName: "EveryWherePadel",
                    images: [
                        {
                            url: logoUrl,
                            width: 800,
                            height: 600,
                            alt: eventName,
                        },
                    ],
                    type: "website",
                },
                twitter: {
                    card: "summary_large_image",
                    title: eventName,
                    description: `Join ${eventName} at ${location}.`,
                    images: [logoUrl],
                },
            };
        }
    } catch (e) {
        console.error("Error generating event metadata:", e);
    }

    return {
        title: "Event Details | EveryWherePadel",
        description: "View padel event details, roster, and registrations on EveryWherePadel.",
    };
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}

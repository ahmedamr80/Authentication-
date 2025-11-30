import { Calendar, Clock, MapPin, Users } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Timestamp } from "firebase/firestore";
import Link from "next/link";

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
}

interface EventCardProps {
    event: EventData;
}

export function EventCard({ event }: EventCardProps) {
    const eventDate = event.dateTime.toDate();
    const formattedDate = eventDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
    const formattedTime = eventDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });

    const mapsUrl = event.coordinates
        ? `https://www.google.com/maps/search/?api=1&query=${event.coordinates.lat},${event.coordinates.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationName)}`;

    return (
        <Card className="overflow-hidden hover:shadow-md transition-shadow">
            <div className="relative h-48 w-full bg-gray-100">
                {event.logoUrl ? (
                    <Image
                        src={event.logoUrl}
                        alt={event.eventName}
                        fill
                        className="object-cover"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Calendar className="w-12 h-12" />
                    </div>
                )}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-semibold text-gray-900 shadow-sm">
                    {event.pricePerPlayer === 0 ? "Free" : `${event.pricePerPlayer} AED`}
                </div>
                <div className={`absolute top-4 left-4 px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm ${event.status === 'Active' ? 'bg-green-500' :
                    event.status === 'Upcoming' ? 'bg-blue-500' :
                        event.status === 'Cancelled' ? 'bg-red-500' :
                            'bg-gray-500'
                    }`}>
                    {event.status}
                </div>
            </div>

            <CardHeader className="pb-2">
                <CardTitle className="text-xl font-bold text-gray-900 line-clamp-1">
                    {event.eventName}
                </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
                <div className="flex items-center text-gray-600 text-sm">
                    <Calendar className="w-4 h-4 mr-2 shrink-0" />
                    <span>{formattedDate} • {formattedTime}</span>
                </div>

                <div className="flex items-center text-gray-600 text-sm">
                    <Clock className="w-4 h-4 mr-2 shrink-0" />
                    <span>{event.duration} min</span>
                </div>

                <div className="flex items-center text-gray-600 text-sm">
                    <MapPin className="w-4 h-4 mr-2 shrink-0" />
                    <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-1 hover:text-blue-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {event.locationName}
                    </a>
                </div>

                <div className="flex items-center text-gray-600 text-sm">
                    <Users className="w-4 h-4 mr-2 shrink-0" />
                    <span>{event.slotsAvailable} slots left ({event.unitType})</span>
                </div>
            </CardContent>

            <CardFooter className="pt-2">
                <Link href={`/events/${event.eventId}`} className="w-full">
                    <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                        View Details
                    </Button>
                </Link>
            </CardFooter>
        </Card>
    );
}

import { MapPin, Phone, Info, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import Image from "next/image";
import { Timestamp } from "firebase/firestore";

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

interface ClubCardProps {
    club: ClubData;
}

export function ClubCard({ club }: ClubCardProps) {
    return (
        <Card className="overflow-hidden hover:shadow-md transition-shadow h-full flex flex-col bg-gray-900 border-gray-800">
            <div className="relative h-48 w-full bg-gray-800">
                {club.pictureUrl ? (
                    <Image
                        src={club.pictureUrl}
                        alt={club.name}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        className="object-cover"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-600 bg-gray-800">
                        <Building2 className="w-12 h-12" />
                    </div>
                )}
            </div>

            <CardHeader className="pb-2">
                <h3 className="text-xl font-bold text-white line-clamp-1">
                    {club.name}
                </h3>
            </CardHeader>

            <CardContent className="space-y-3 grow">
                {club.location?.address && (
                    <div className="flex items-start text-gray-400 text-sm">
                        <MapPin className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{club.location.address}</span>
                    </div>
                )}

                {club.phone && (
                    <div className="flex items-center text-gray-400 text-sm">
                        <Phone className="w-4 h-4 mr-2 shrink-0" />
                        <span>{club.phone}</span>
                    </div>
                )}

                {club.notes && (
                    <div className="flex items-start text-gray-400 text-sm">
                        <Info className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                        <p className="line-clamp-3 text-sm text-gray-500 italic">
                            {club.notes}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

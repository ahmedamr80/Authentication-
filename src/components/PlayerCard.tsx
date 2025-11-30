import { User, Calendar, Trophy, Hand, Activity } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { Timestamp } from "firebase/firestore";

export interface PlayerData {
    uid: string;
    photoUrl?: string;
    fullName: string;
    position?: string;
    hand?: string;
    createdAt?: Timestamp;
    skillLevel?: string;
    createdBy?: string;
}

interface PlayerCardProps {
    player: PlayerData;
}

export function PlayerCard({ player }: PlayerCardProps) {
    const formattedDate = player.createdAt
        ? player.createdAt.toDate().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
        : 'Unknown';

    return (
        <Link href={`/community/${player.uid}`} className="block h-full">
            <Card className="overflow-hidden hover:shadow-md transition-shadow h-full cursor-pointer">
                <CardHeader className="p-0">
                    <div className="relative h-32 w-full bg-linear-to-r from-blue-500 to-purple-600">
                        <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2">
                            <div className="relative h-24 w-24 rounded-full border-4 border-white overflow-hidden bg-gray-100 shadow-md">
                                {player.photoUrl ? (
                                    <Image
                                        src={player.photoUrl}
                                        alt={player.fullName}
                                        fill
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-400">
                                        <User className="w-12 h-12" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-14 pb-6 px-6 text-center space-y-4">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 line-clamp-1">
                            {player.fullName}
                        </h3>
                        <p className="text-sm text-gray-500 capitalize">
                            {player.skillLevel || "Beginner"}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm text-left">
                        <div className="flex items-center text-gray-600">
                            <Activity className="w-4 h-4 mr-2 shrink-0 text-blue-500" />
                            <span className="capitalize line-clamp-1">
                                {player.position || "Unknown Pos"}
                            </span>
                        </div>
                        <div className="flex items-center text-gray-600">
                            <Hand className="w-4 h-4 mr-2 shrink-0 text-orange-500" />
                            <span className="capitalize">
                                {player.hand || "Unknown Hand"}
                            </span>
                        </div>
                        <div className="flex items-center text-gray-600 col-span-2">
                            <Calendar className="w-4 h-4 mr-2 shrink-0 text-green-500" />
                            <span>Joined {formattedDate}</span>
                        </div>
                        {player.createdBy && (
                            <div className="flex items-center text-gray-400 text-xs col-span-2">
                                <span>Created by: {player.createdBy}</span>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ClubCard, ClubData } from "@/components/ClubCard";
import { Loader2, Building2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";

export default function ClubsPage() {
    const [clubs, setClubs] = useState<ClubData[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    useEffect(() => {
        const fetchClubs = async () => {
            try {
                const clubsRef = collection(db, "clubs");
                // Order by name if possible, or createdAt. 
                // Since 'name' ordering might require an index if combined with other filters, 
                // we'll stick to a simple fetch or order by createdAt if available.
                // For now, let's try ordering by createdAt desc to show newest first.
                const q = query(clubsRef, orderBy("createdAt", "desc"));
                const querySnapshot = await getDocs(q);

                const clubsList: ClubData[] = [];
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    clubsList.push({
                        id: doc.id,
                        name: data.name || "Unknown Club",
                        location: data.location,
                        phone: data.phone,
                        pictureUrl: data.pictureUrl,
                        notes: data.notes,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt,
                    } as ClubData);
                });

                setClubs(clubsList);
            } catch (error) {
                console.error("Error fetching clubs:", error);
                showToast("Failed to load clubs.", "error");
            } finally {
                setLoading(false);
            }
        };

        fetchClubs();
    }, [showToast]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-orange-100 rounded-full">
                        <Building2 className="w-8 h-8 text-orange-600" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Clubs</h1>
                        <p className="text-gray-600 mt-1">Explore our partner clubs</p>
                    </div>
                </div>

                {clubs.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 text-lg">No clubs found.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {clubs.map((club) => (
                            <ClubCard key={club.id} club={club} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

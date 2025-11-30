"use client";

import { useRouter } from "next/navigation";
import { Calendar, Users, Image as ImageIcon, User, Building2 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";

export default function DashboardPage() {
    const router = useRouter();

    const menuItems = [
        {
            title: "Events",
            icon: Calendar,
            path: "/events",
            color: "text-blue-600",
            bgColor: "bg-blue-100",
            description: "Browse and join padel events"
        },
        {
            title: "Media Library",
            icon: ImageIcon,
            path: "/media",
            color: "text-purple-600",
            bgColor: "bg-purple-100",
            description: "View your saved photos and videos"
        },
        {
            title: "Community",
            icon: Users,
            path: "/community",
            color: "text-green-600",
            bgColor: "bg-green-100",
            description: "Connect with other players"
        },
        {
            title: "Clubs",
            icon: Building2,
            path: "/clubs",
            color: "text-red-600",
            bgColor: "bg-red-100",
            description: "Find courts and clubs near you"
        },
        {
            title: "My Profile",
            icon: User,
            path: "/player",
            color: "text-orange-600",
            bgColor: "bg-orange-100",
            description: "Manage your profile and stats"
        }
    ];

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <div className="text-center space-y-2">
                    <h1 className="text-3xl font-bold text-gray-900">Welcome Back</h1>
                    <p className="text-gray-600">What would you like to do today?</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {menuItems.map((item) => (
                        <Card
                            key={item.title}
                            className="cursor-pointer hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
                            onClick={() => router.push(item.path)}
                        >
                            <CardContent className="p-6 flex items-center space-x-6">
                                <div className={`p-4 rounded-full ${item.bgColor}`}>
                                    <item.icon className={`w-8 h-8 ${item.color}`} />
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-semibold text-gray-900">{item.title}</h2>
                                    <p className="text-sm text-gray-500">{item.description}</p>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}

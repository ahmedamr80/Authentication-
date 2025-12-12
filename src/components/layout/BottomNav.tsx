"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Users } from "lucide-react";

export function BottomNav() {
    const pathname = usePathname();

    const isActive = (path: string) => {
        if (path === "/events" && pathname.startsWith("/events")) return true;
        return pathname === path;
    };

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-md border-t border-gray-800 px-6 py-3">
            <div className="max-w-md mx-auto flex items-center justify-between">
                <Link
                    href="/dashboard"
                    className={`flex flex-col items-center gap-1 transition-colors ${isActive("/dashboard") ? "text-orange-500" : "text-gray-400 hover:text-orange-500"
                        }`}
                >
                    <Home className="w-6 h-6" />
                    <span className="text-xs font-medium">Home</span>
                </Link>
                <Link
                    href="/events"
                    className={`flex flex-col items-center gap-1 transition-colors ${isActive("/events") ? "text-orange-500" : "text-gray-400 hover:text-orange-500"
                        }`}
                >
                    <Calendar className="w-6 h-6" />
                    <span className="text-xs font-medium">Events</span>
                </Link>
                <Link
                    href="/community"
                    className={`flex flex-col items-center gap-1 transition-colors ${isActive("/community") ? "text-orange-500" : "text-gray-400 hover:text-orange-500"
                        }`}
                >
                    <Users className="w-6 h-6" />
                    <span className="text-xs font-medium">Community</span>
                </Link>
            </div>
        </nav>
    );
}

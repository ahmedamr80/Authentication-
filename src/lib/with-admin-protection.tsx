"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export function withAdminProtection<P extends object>(
    Component: React.ComponentType<P>
) {
    return function AdminProtectedComponent(props: P) {
        const { user, isAdmin, loading } = useAuth();
        const router = useRouter();

        useEffect(() => {
            if (!loading && (!user || !isAdmin)) {
                router.push("/");
            }
        }, [user, isAdmin, loading, router]);

        if (loading) {
            return (
                <div className="flex h-screen w-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
                </div>
            );
        }

        if (!user || !isAdmin) {
            return null;
        }

        return <Component {...props} />;
    };
}

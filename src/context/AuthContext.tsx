"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

interface AuthContextType {
    user: User | null;
    loading: boolean;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    isAdmin: false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);

            if (currentUser) {
                try {
                    // 1. FAST CHECK: Custom Claims
                    const tokenResult = await currentUser.getIdTokenResult();
                    let adminStatus = !!tokenResult.claims.admin;

                    // 2. FALLBACK CHECK: Firestore Document
                    // Useful if you manually set "role: admin" in the database console
                    if (!adminStatus) {
                        const userDocRef = doc(db, "users", currentUser.uid);
                        const userDocSnap = await getDoc(userDocRef);

                        // Check if document exists and role is explicitly 'admin'
                        if (userDocSnap.exists() && userDocSnap.data()?.role === "admin") {
                            adminStatus = true;
                        }
                    }

                    setIsAdmin(adminStatus);
                } catch (e) {
                    console.error("Error checking admin status", e);
                    setIsAdmin(false);
                }
            } else {
                // No user logged in
                setIsAdmin(false);
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, isAdmin }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
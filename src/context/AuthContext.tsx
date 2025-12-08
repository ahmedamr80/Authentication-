"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

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
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setUser(user);
            if (user) {
                try {
                    const tokenResult = await user.getIdTokenResult();
                    let adminStatus = !!tokenResult.claims.admin;

                    // Fallback: Check Firestore if custom claim is not present
                    if (!adminStatus) {
                        const { doc, getDoc, getFirestore } = await import("firebase/firestore");
                        const db = getFirestore();
                        const userDocRef = doc(db, "users", user.uid);
                        const userDocSnap = await getDoc(userDocRef);
                        if (userDocSnap.exists() && userDocSnap.data().role === "admin") {
                            adminStatus = true;
                        }
                    }
                    setIsAdmin(adminStatus);
                } catch (e) {
                    console.error("Error checking admin status", e);
                    setIsAdmin(false);
                }
            } else {
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

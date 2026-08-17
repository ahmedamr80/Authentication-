"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

interface AuthContextType {
    user: User | null;
    loading: boolean;
    isAdmin: boolean;
    isEmailVerified: boolean;
    accessToken: string | null; // Kept strictly IN MEMORY (JS React state only)
    setAccessToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    isAdmin: false,
    isEmailVerified: false,
    accessToken: null,
    setAccessToken: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isEmailVerified, setIsEmailVerified] = useState(false);
    // Access token is held in-memory ONLY. Disappears automatically on tab reload.
    const [accessToken, setAccessToken] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);

            if (currentUser) {
                setIsEmailVerified(currentUser.emailVerified);
                try {
                    // FAST CHECK: Custom Claims (cached token)
                    const tokenResult = await currentUser.getIdTokenResult(false);
                    let adminStatus = !!tokenResult.claims.admin;

                    // FALLBACK CHECK: Firestore Document
                    if (!adminStatus) {
                        const userDocRef = doc(db, "users", currentUser.uid);
                        const userDocSnap = await getDoc(userDocRef);

                        if (userDocSnap.exists()) {
                            const uData = userDocSnap.data();
                            if (uData?.isAdmin === true || uData?.role?.toLowerCase?.() === "admin") {
                                adminStatus = true;
                            }
                        }
                    }

                    setIsAdmin(adminStatus);
                } catch (e) {
                    console.error("Error checking admin status", e);
                    setIsAdmin(false);
                }
            } else {
                setIsAdmin(false);
                setIsEmailVerified(false);
                setAccessToken(null);
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, isAdmin, isEmailVerified, accessToken, setAccessToken }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
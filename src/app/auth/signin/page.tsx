//1. Imports and Setup

"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,

    GoogleAuthProvider,
    signInWithPopup,
    UserCredential,
    setPersistence,
    browserLocalPersistence,
    onAuthStateChanged
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp, runTransaction, collection, query, where, getDocs, deleteDoc, writeBatch, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";

// 2. Form Validation Schema
// The code uses Zod to define a validation schema for the authentication form:
const authSchema = z.object({
    mode: z.enum(["signin", "signup"]),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().optional(),
    fullName: z.string().optional(),
    rememberMe: z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.mode === "signup") {
        if (!data.fullName || data.fullName.trim() === "") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Full Name is required",
                path: ["fullName"],
            });
        }
        if (!data.confirmPassword) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Confirm Password is required",
                path: ["confirmPassword"],
            });
        } else if (data.password !== data.confirmPassword) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Passwords do not match",
                path: ["confirmPassword"],
            });
        }
    }
});

type AuthFormValues = z.infer<typeof authSchema>;

export default function SignInPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);

    // Account Linking State
    const [showLinkAccountModal, setShowLinkAccountModal] = useState(false);
    const [pendingCred, setPendingCred] = useState<any>(null);
    const [existingEmail, setExistingEmail] = useState("");

    //4. Form Setup
    //The component uses react-hook-form with Zod validation:
    const form = useForm<AuthFormValues>({
        resolver: zodResolver(authSchema),
        defaultValues: {
            mode: "signin",
            email: "",
            password: "",
            confirmPassword: "",
            fullName: "",
            rememberMe: false,
        },
    });

    // Load saved email
    useEffect(() => {
        const savedEmail = localStorage.getItem("rememberedEmail");
        if (savedEmail && !isSignUp) {
            form.setValue("email", savedEmail);
            form.setValue("rememberMe", true);
        }
    }, [form, isSignUp]);

    // Add this debugging code to your component
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                console.log("Current authenticated user:", {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    providerData: user.providerData
                });
            } else {
                console.log("No user is currently authenticated");
            }
        });

        return () => unsubscribe();
    }, []);

    const handleSuccess = (user: UserCredential) => {
        showToast(isSignUp ? "Account created successfully!" : "Signed in successfully!", "success");
        const returnTo = searchParams.get("returnTo") || "/player";
        router.push(returnTo);
    };

    const handleError = (error: any) => {
        let message = "An error occurred.";
        if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
            message = "Invalid email or password.";
            console.warn("Auth Error:", error.code);
        } else if (error.code === "auth/email-already-in-use") {
            message = "Email is already in use. Please sign in.";
            console.warn("Auth Error:", error.code);
        } else if (error.code === "auth/account-exists-with-different-credential") {
            message = "An account already exists with the same email address but different sign-in credentials.";
            console.warn("Auth Error:", error.code);
        } else if (error.code === "auth/popup-closed-by-user") {
            message = "Sign-in popup closed.";
            console.warn("Auth Error:", error.code);
        } else {
            console.error("Auth Error:", error);
            message = error.message || message;
        }
        showToast(message, "error");
    };

    //5. Main Authentication Functions
    //Email/Password Authentication
    const onSubmit = async (data: AuthFormValues) => {
        setIsLoading(true);
        try {
            let userCred: UserCredential | undefined;
            if (isSignUp) {
                // Validation handled by Zod schema
                userCred = await createUserWithEmailAndPassword(auth, data.email, data.password);



                const user = userCred.user;
                const userDocRef = doc(db, "users", user.uid);

                // Check for Shadow Profile
                const usersRef = collection(db, "users");
                const q = query(usersRef, where("email", "==", data.email), where("isShadow", "==", true));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    // --- MERGE SCENARIO ---
                    const shadowDoc = querySnapshot.docs[0];
                    const shadowData = shadowDoc.data();
                    const shadowUid = shadowDoc.id;

                    console.log(`Found shadow profile (${shadowUid}). Merging into new account (${user.uid})...`);

                    const batch = writeBatch(db);

                    batch.set(userDocRef, {
                        ...shadowData,
                        uid: user.uid,
                        email: data.email,
                        fullName: data.fullName || shadowData.fullName || "",
                        registrationStatus: "active",
                        isShadow: false,
                        createdAt: shadowData.createdAt || serverTimestamp(),
                        claimedAt: serverTimestamp(),
                        previousUid: shadowUid
                    });

                    batch.delete(doc(db, "users", shadowUid));
                    await batch.commit();
                    showToast("Account reclaimed successfully!", "success");


                    // TODO: When implementing Admin User Creation, ensure 'createdBy' is set to the Admin's UID.

                    if (data.rememberMe) {
                        localStorage.setItem("rememberedEmail", data.email);
                    } else {
                        localStorage.removeItem("rememberedEmail");
                    }
                } else {
                    // --- NEW USER ---
                    await setDoc(userDocRef, {
                        uid: user.uid,
                        email: data.email,
                        fullName: data.fullName || "",
                        registrationStatus: "active",
                        createdBy: user.uid, // Self-created
                        createdAt: serverTimestamp(),
                    });
                }
            } else {
                userCred = await signInWithEmailAndPassword(auth, data.email, data.password);
                if (!userCred) throw new Error("Failed to sign in");
                const currentUserCred = userCred;

                const userDocRef = doc(db, "users", currentUserCred.user.uid);
                await runTransaction(db, async (transaction) => {
                    const userDoc = await transaction.get(userDocRef);
                    if (!userDoc.exists()) {
                        transaction.set(userDocRef, {
                            uid: currentUserCred.user.uid,
                            email: currentUserCred.user.email,
                            fullName: currentUserCred.user.displayName || "", // Mapping Auth displayName to fullName
                            registrationStatus: "active",
                            createdBy: currentUserCred.user.uid, // Self-created
                            createdAt: serverTimestamp(),
                        });
                    } else {
                        // Update existing user to active
                        transaction.update(userDocRef, {
                            registrationStatus: "active"
                        });
                    }
                });

                if (data.rememberMe) {
                    localStorage.setItem("rememberedEmail", data.email);
                } else {
                    localStorage.removeItem("rememberedEmail");
                }
            }

            if (userCred) {
                handleSuccess(userCred);
            }
        } catch (error) {
            handleError(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setIsLoading(true);
        const provider = new GoogleAuthProvider();

        try {
            await setPersistence(auth, browserLocalPersistence);
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const userDocRef = doc(db, "users", user.uid);

            // 1. Check if the REAL user profile already exists
            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                console.log("New user detected. Checking for Shadow Profile...");

                // 2. Query for a Shadow User with the same email
                const usersRef = collection(db, "users");
                const q = query(usersRef, where("email", "==", user.email), where("isShadow", "==", true));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    // --- MERGE SCENARIO ---
                    const shadowDoc = querySnapshot.docs[0]; // Assuming only 1 shadow profile per email
                    const shadowData = shadowDoc.data();
                    const shadowUid = shadowDoc.id;

                    console.log(`Found shadow profile (${shadowUid}). Merging into new account (${user.uid})...`);

                    const batch = writeBatch(db);

                    // A. Create NEW document with merged data
                    batch.set(userDocRef, {
                        ...shadowData, // Copy all stats/notes from shadow
                        uid: user.uid, // OVERWRITE with new Real UID
                        email: user.email,
                        fullName: user.displayName || shadowData.fullName || "", // Mapping Auth displayName to fullName
                        photoUrl: user.photoURL || "", // Mapping Auth photoURL to photoUrl
                        isShadow: false, // No longer a shadow
                        registrationStatus: "active",
                        createdAt: shadowData.createdAt || serverTimestamp(), // Keep original creation date if possible
                        claimedAt: serverTimestamp(), // Track when they claimed it
                        previousUid: shadowUid // OPTIONAL: Keep ref to old ID in case you need to fix links later
                    });

                    // B. Delete the OLD shadow document
                    const shadowDocRef = doc(db, "users", shadowUid);
                    batch.delete(shadowDocRef);

                    await batch.commit();
                    showToast("Account reclaimed successfully! Your stats are merged.", "success");

                } else {
                    // --- BRAND NEW USER SCENARIO ---
                    console.log("No shadow profile found. Creating fresh account.");
                    await setDoc(userDocRef, {
                        uid: user.uid,
                        email: user.email,
                        fullName: user.displayName || "", // Mapping Auth displayName to fullName
                        photoUrl: user.photoURL || "", // Mapping Auth photoURL to photoUrl
                        role: "player",
                        isShadow: false,
                        registrationStatus: "active",
                        createdBy: user.uid, // Self-created
                        createdAt: serverTimestamp(),
                    });
                }
            } else {
                // --- EXISTING USER LOGIN ---
                // Just update the photo if needed
                if (user.photoURL && userDocSnap.data().photoUrl !== user.photoURL) {
                    await updateDoc(userDocRef, { photoUrl: user.photoURL });
                }
                // Ensure active status
                if (userDocSnap.data().registrationStatus !== "active") {
                    await updateDoc(userDocRef, { registrationStatus: "active" });
                }
            }

            handleSuccess(result);
        } catch (error: any) {
            console.error("Sign-in failed:", error);
            if (error.code === "auth/account-exists-with-different-credential") {
                const email = error.customData?.email;
                const pendingCredential = GoogleAuthProvider.credentialFromError(error);
                if (email && pendingCredential) {
                    setExistingEmail(email);
                    setPendingCred(pendingCredential);
                    setShowLinkAccountModal(true);
                    return;
                }
            }
            handleError(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAppleSignIn = () => {
        showToast("Apple Sign-In is not configured (requires Developer Account).", "info");
    };

    const toggleMode = () => {
        const newMode = !isSignUp;
        setIsSignUp(newMode);
        form.setValue("mode", newMode ? "signup" : "signin");
        form.clearErrors();
        form.reset({
            mode: newMode ? "signup" : "signin",
            email: form.getValues("email"),
            password: "",
            confirmPassword: "",
            fullName: "",
            rememberMe: false
        });
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
                <div className="text-center">
                    <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
                        {isSignUp ? "Create an account" : "Welcome back"}
                    </h2>
                    <p className="mt-2 text-sm text-gray-600">
                        {isSignUp ? "Sign up to get started" : "Sign in to your account"}
                    </p>
                </div>

                <div className="space-y-4">
                    <Button
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2 h-12 text-base"
                        onClick={handleGoogleSignIn}
                        isLoading={isLoading}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                fill="#4285F4"
                            />
                            <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                            />
                            <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                            />
                            <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                            />
                        </svg>
                        Continue with Google
                    </Button>

                    <Button
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2 h-12 text-base"
                        onClick={handleAppleSignIn}
                        isLoading={isLoading}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.74 1.18 0 2.45-1.62 4.37-1.54 1.81.07 3.2 1.06 4.08 2.35-3.52 1.87-3.21 5.92.26 7.72-.65 1.78-1.58 3.53-3.79 3.7zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                        </svg>
                        Continue with Apple
                    </Button>
                </div>

                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="bg-white px-2 text-gray-500">Or continue with</span>
                    </div>
                </div>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* Hidden Mode Field */}
                    <input type="hidden" {...form.register("mode")} />

                    {isSignUp && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none" htmlFor="fullName">
                                Full Name
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                                <Input
                                    id="fullName"
                                    type="text"
                                    placeholder="John Doe"
                                    className="pl-10"
                                    {...form.register("fullName")}
                                    disabled={isLoading}
                                />
                            </div>
                            {form.formState.errors.fullName && (
                                <p className="text-sm text-red-500">{form.formState.errors.fullName.message}</p>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none" htmlFor="email">
                            Email address
                        </label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@example.com"
                                className="pl-10"
                                {...form.register("email")}
                                disabled={isLoading}
                            />
                        </div>
                        {form.formState.errors.email && (
                            <p className="text-sm text-red-500">{form.formState.errors.email.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none" htmlFor="password">
                            Password
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                            <Input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••"
                                className="pl-10 pr-10"
                                {...form.register("password")}
                                disabled={isLoading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                        </div>
                        {form.formState.errors.password && (
                            <p className="text-sm text-red-500">{form.formState.errors.password.message}</p>
                        )}
                    </div>

                    {
                        isSignUp && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none" htmlFor="confirmPassword">
                                    Confirm Password
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="confirmPassword"
                                        type={showConfirmPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        className="pl-10 pr-10"
                                        {...form.register("confirmPassword")}
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                                    >
                                        {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                                {form.formState.errors.confirmPassword && (
                                    <p className="text-sm text-red-500">{form.formState.errors.confirmPassword.message}</p>
                                )}
                            </div>
                        )
                    }

                    {
                        !isSignUp && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="rememberMe"
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        {...form.register("rememberMe")}
                                        disabled={isLoading}
                                    />
                                    <label
                                        htmlFor="rememberMe"
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        Remember me
                                    </label>
                                </div>
                                <a href="#" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                                    Forgot password?
                                </a>
                            </div>
                        )
                    }

                    <Button type="submit" className="w-full h-11 text-base" isLoading={isLoading}>
                        {isSignUp ? "Create account" : "Sign in"}
                    </Button>
                </form >

                <div className="text-center text-sm">
                    <span className="text-gray-600">
                        {isSignUp ? "Already have an account? " : "Don't have an account? "}
                    </span>
                    <button
                        onClick={toggleMode}
                        className="font-medium text-blue-600 hover:text-blue-500"
                        disabled={isLoading}
                    >
                        {isSignUp ? "Sign in" : "Sign up"}
                    </button>
                </div>
            </div >

            {/* Account Linking Modal (Simplified) */}
            {
                showLinkAccountModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="w-full max-w-md bg-white rounded-xl p-6 space-y-4">
                            <h3 className="text-lg font-bold">Account Exists</h3>
                            <p className="text-sm text-gray-600">
                                An account with the email <strong>{existingEmail}</strong> already exists.
                                Please sign in with your password to link your Google account.
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setShowLinkAccountModal(false)}>Cancel</Button>
                                <Button onClick={() => {
                                    setShowLinkAccountModal(false);
                                    setIsSignUp(false); // Ensure we are in sign-in mode
                                    form.setValue("mode", "signin"); // Update mode
                                    form.setValue("email", existingEmail);
                                    // Focus password
                                    document.getElementById("password")?.focus();
                                    showToast("Please enter your password to link accounts", "info");
                                }}>
                                    Sign in to Link
                                </Button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}

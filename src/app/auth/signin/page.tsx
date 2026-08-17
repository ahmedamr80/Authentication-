"use client";

import { useState, useEffect, Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    sendEmailVerification,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup,
    UserCredential,
    setPersistence,
    browserLocalPersistence,
    sendPasswordResetEmail
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp, runTransaction, collection, query, where, getDocs, writeBatch, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import Image from "next/image";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";

// ------------------------------------------------------------------
// 📧 EMAIL VERIFICATION SWITCH 📧
// "on" = Enforce verification and send emails.
// "off" = Skip verification entirely (allows unverified users to login).
export const EMAIL_VERIFICATION_ON: string = "on";
// Note: I exported this so other components can theoretically import it, 
// but you likely need to apply this logic in your Layout file too.
// ------------------------------------------------------------------

// Form Validation Schema
const authSchema = z.object({
    mode: z.enum(["signin", "signup"]),
    email: z.string().trim().toLowerCase().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
    confirmPassword: z.string().optional(),
    fullName: z.string().optional(),
    rememberMe: z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.mode === "signup") {
        const password = data.password;
        if (password.length < 12) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Password must be at least 12 characters",
                path: ["password"],
            });
        }

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

function SignInContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);

    // Account Linking State
    const [showLinkAccountModal, setShowLinkAccountModal] = useState(false);
    const [existingEmail, setExistingEmail] = useState("");

    // Forgot Password State
    const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
    const [resetEmail, setResetEmail] = useState("");
    const [isResetLoading, setIsResetLoading] = useState(false);

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

    const handleSuccess = async (userCred: UserCredential, isNewSignUp = false) => {
        const uid = userCred.user.uid;
        let hasPhone = false;

        try {
            const userDocSnap = await getDoc(doc(db, "users", uid));
            if (userDocSnap.exists()) {
                const data = userDocSnap.data();
                hasPhone = !!(data?.phone && data.phone.trim().length >= 8);
            }
        } catch (err) {
            console.warn("Could not check user phone status:", err);
        }

        if (isNewSignUp || !hasPhone) {
            showToast("Please enter your phone number to complete your profile.", "info");
            router.replace("/player?completeProfile=true");
            return;
        }

        showToast("Signed in successfully!", "success");
        const returnTo = searchParams.get("returnTo") || "/dashboard";
        router.replace(returnTo);
    };

    const handleError = (error: unknown) => {
        const err = error as { code?: string; message?: string };
        // Silently ignore popup-closed / cancelled
        if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;

        let message = "An error occurred during authentication.";
        if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
            message = "Invalid email or password.";
        } else if (err.code === "auth/email-already-in-use") {
            message = "An account with this email address already exists. Please sign in instead.";
        } else if (err.code === "auth/account-exists-with-different-credential") {
            message = "An account already exists with this email using a different sign-in method.";
        } else if (err.code === "auth/unauthorized-domain") {
            message = "This domain/hostname is not authorized in Firebase Console Authentication settings.";
        } else if (err.code === "auth/operation-not-allowed") {
            message = "Google Sign-In is not enabled in your Firebase Authentication Console.";
        } else if (err.code === "auth/popup-blocked") {
            message = "The sign-in popup was blocked by your browser. Please enable popups for this site.";
        } else if (err.code === "auth/network-request-failed") {
            message = "Network error connecting to Firebase. Please check your internet connection.";
        } else {
            console.error("Auth Error:", error);
            message = err.message || message;
        }
        showToast(message, "error");
    };

    const onSubmit = async (data: AuthFormValues) => {
        setIsLoading(true);
        try {
            await setPersistence(auth, browserLocalPersistence);
            let userCred: UserCredential | undefined;
            if (isSignUp) {
                // 1. Firebase standard user creation
                userCred = await createUserWithEmailAndPassword(auth, data.email, data.password);

                // 2. Update display name
                if (data.fullName) {
                    try {
                        await updateProfile(userCred.user, { displayName: data.fullName });
                    } catch (profErr) {
                        console.warn("Profile name update error:", profErr);
                    }
                }

                // 3. Send official Firebase Email Verification
                try {
                    await sendEmailVerification(userCred.user);
                } catch (verErr) {
                    console.warn("Verification email send error:", verErr);
                }

                // 4. Create or Claim Firestore User Document
                const userDocRef = doc(db, "users", userCred.user.uid);
                const usersRef = collection(db, "users");
                const shadowQ = query(usersRef, where("email", "==", data.email.toLowerCase()), where("isShadow", "==", true));
                const shadowSnap = await getDocs(shadowQ);

                if (!shadowSnap.empty) {
                    const shadowDoc = shadowSnap.docs[0];
                    const shadowData = shadowDoc.data();
                    const shadowUid = shadowDoc.id;

                    const batch = writeBatch(db);
                    batch.set(userDocRef, {
                        ...shadowData,
                        uid: userCred.user.uid,
                        email: data.email.toLowerCase(),
                        fullName: data.fullName || shadowData.fullName || "",
                        isShadow: false,
                        isAdmin: false,
                        role: "player",
                        registrationStatus: "active",
                        createdAt: shadowData.createdAt || serverTimestamp(),
                        claimedAt: serverTimestamp(),
                        previousUid: shadowUid,
                    });
                    batch.delete(doc(db, "users", shadowUid));
                    await batch.commit();
                } else {
                    await setDoc(userDocRef, {
                        uid: userCred.user.uid,
                        email: data.email.toLowerCase(),
                        fullName: data.fullName || "",
                        role: "player",
                        isShadow: false,
                        isAdmin: false,
                        registrationStatus: "active",
                        createdBy: userCred.user.uid,
                        createdAt: serverTimestamp(),
                    });
                }

                showToast("Account created! Verification email sent. Please add your phone number to complete your profile.", "success");
                router.replace("/player?completeProfile=true");
                return;
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
                            fullName: currentUserCred.user.displayName || "",
                            registrationStatus: "active",
                            createdBy: currentUserCred.user.uid,
                            isShadow: false,
                            isAdmin: false,
                            role: "player",
                            createdAt: serverTimestamp(),
                        });
                    } else {
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

                await handleSuccess(userCred);
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
        provider.setCustomParameters({ prompt: "select_account" });

        try {
            await setPersistence(auth, browserLocalPersistence);
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const userDocRef = doc(db, "users", user.uid);

            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                const usersRef = collection(db, "users");
                const q = query(usersRef, where("email", "==", user.email), where("isShadow", "==", true));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const shadowDoc = querySnapshot.docs[0];
                    const shadowData = shadowDoc.data();
                    const shadowUid = shadowDoc.id;

                    const batch = writeBatch(db);
                    batch.set(userDocRef, {
                        ...shadowData,
                        uid: user.uid,
                        email: user.email,
                        fullName: user.displayName || shadowData.fullName || "",
                        photoUrl: user.photoURL || "",
                        isShadow: false,
                        isAdmin: false,
                        registrationStatus: "active",
                        role: "player",
                        createdAt: shadowData.createdAt || serverTimestamp(),
                        claimedAt: serverTimestamp(),
                        previousUid: shadowUid
                    });
                    const shadowDocRef = doc(db, "users", shadowUid);
                    batch.delete(shadowDocRef);
                    await batch.commit();
                    showToast("Account reclaimed successfully!", "success");

                } else {
                    await setDoc(userDocRef, {
                        uid: user.uid,
                        email: user.email,
                        fullName: user.displayName || "",
                        photoUrl: user.photoURL || "",
                        role: "player",
                        isShadow: false,
                        isAdmin: false,
                        registrationStatus: "active",
                        createdBy: user.uid,
                        createdAt: serverTimestamp(),
                    });
                }
            } else {
                const updatePayload: Record<string, unknown> = {};
                if (user.photoURL && userDocSnap.data()?.photoUrl !== user.photoURL) {
                    updatePayload.photoUrl = user.photoURL;
                }
                if (userDocSnap.data()?.registrationStatus !== "active") {
                    updatePayload.registrationStatus = "active";
                }
                if (Object.keys(updatePayload).length > 0) {
                    await updateDoc(userDocRef, updatePayload);
                }
            }
            await handleSuccess(result);
        } catch (error: unknown) {
            const err = error as { code?: string; customData?: { email?: string }; message?: string };
            if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
                return;
            }
            console.error("Google Sign-in failed:", error);
            if (err.code === "auth/account-exists-with-different-credential") {
                const email = err.customData?.email;
                if (email) {
                    setExistingEmail(email);
                    setShowLinkAccountModal(true);
                    return;
                }
            }
            handleError(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAppleSignIn = async () => {
        setIsLoading(true);
        try {
            await setPersistence(auth, browserLocalPersistence);
            const provider = new OAuthProvider("apple.com");
            provider.addScope("email");
            provider.addScope("name");

            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Send payload to backend social login processor (sub claim mapping + first-time name preservation)
            const idToken = await user.getIdToken();
            const res = await fetch("/api/auth/oauth/callback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: "apple",
                    idToken,
                    userPayload: {
                        sub: user.uid,
                        email: user.email || "",
                        fullName: user.displayName || "",
                        photoUrl: user.photoURL || "",
                    },
                }),
            });

            const callbackData = await res.json();
            if (!res.ok || !callbackData.success) {
                showToast(callbackData.error || "Apple Sign-In process failed.", "error");
                setIsLoading(false);
                return;
            }

            await handleSuccess(result);
        } catch (error: unknown) {
            const err = error as { code?: string; message?: string };
            if (err.code === "auth/popup-closed-by-user") return;
            console.error("Apple Sign-In Error:", error);
            handleError(error);
        } finally {
            setIsLoading(false);
        }
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

    const handleForgotPassword = async () => {
        if (!resetEmail || !/\S+@\S+\.\S+/.test(resetEmail)) {
            showToast("Please enter a valid email address.", "error");
            return;
        }

        setIsResetLoading(true);
        try {
            await sendPasswordResetEmail(auth, resetEmail);
        } catch (error: unknown) {
            // Log error internally, but do NOT leak email existence to client
            console.log("Password reset internal trace:", error);
        } finally {
            showToast("If an account exists with this email, a reset link has been sent to your inbox.", "success");
            setForgotPasswordOpen(false);
            setResetEmail("");
            setIsResetLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
            <div className="w-full max-w-md space-y-8 bg-gray-900 p-8 rounded-xl shadow-lg border border-gray-800">
                <div className="text-center">
                    <div className="flex justify-center mb-4">
                        <Image src="/logo.svg" alt="EveryWherePadel Logo" width={80} height={80} priority className="w-20 h-20" />
                    </div>
                    <h2 className="mt-6 text-3xl font-extrabold text-white">
                        {isSignUp ? "Create an account" : "Welcome back"}
                    </h2>
                    <p className="mt-2 text-sm text-gray-400">
                        {isSignUp ? "Sign up to get started" : "Sign in to your account"}
                    </p>
                </div>

                <div className="space-y-4">
                    <Button
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2 h-12 text-base bg-transparent border-gray-700 text-white hover:bg-gray-800 hover:text-white"
                        onClick={handleGoogleSignIn}
                        isLoading={isLoading}
                    >
                        {/* Google SVG */}
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
                        className="w-full flex items-center justify-center gap-2 h-12 text-base bg-transparent border-gray-700 text-white hover:bg-gray-800 hover:text-white"
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
                        <div className="w-full border-t border-gray-800" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="bg-gray-900 px-2 text-gray-400">Or continue with</span>
                    </div>
                </div>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <input type="hidden" {...form.register("mode")} />

                    {isSignUp && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none text-gray-300" htmlFor="fullName">Full Name</label>
                            <div className="relative">
                                <User className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                <Input
                                    id="fullName"
                                    type="text"
                                    placeholder="John Doe"
                                    className="pl-10 bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500"
                                    {...form.register("fullName")}
                                    disabled={isLoading}
                                />
                            </div>
                            {form.formState.errors.fullName && (
                                <p className="text-sm text-red-400">{form.formState.errors.fullName.message}</p>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none text-gray-300" htmlFor="email">Email address</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@example.com"
                                className="pl-10 bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500"
                                {...form.register("email")}
                                disabled={isLoading}
                            />
                        </div>
                        {form.formState.errors.email && (
                            <p className="text-sm text-red-400">{form.formState.errors.email.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none text-gray-300" htmlFor="password">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                            <Input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••"
                                className="pl-10 pr-10 bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500"
                                {...form.register("password")}
                                disabled={isLoading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-300"
                            >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                        </div>
                        {form.formState.errors.password && (
                            <p className="text-sm text-red-400">{form.formState.errors.password.message}</p>
                        )}
                    </div>

                    {isSignUp && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none text-gray-300" htmlFor="confirmPassword">Confirm Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                <Input
                                    id="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    className="pl-10 pr-10 bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500"
                                    {...form.register("confirmPassword")}
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-300"
                                >
                                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {form.formState.errors.confirmPassword && (
                                <p className="text-sm text-red-400">{form.formState.errors.confirmPassword.message}</p>
                            )}
                        </div>
                    )}

                    {!isSignUp && (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="rememberMe"
                                    className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-orange-500 focus:ring-orange-500"
                                    {...form.register("rememberMe")}
                                    disabled={isLoading}
                                />
                                <label
                                    htmlFor="rememberMe"
                                    className="text-sm font-medium leading-none text-gray-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    Remember me
                                </label>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setResetEmail(form.getValues("email") || ""); // Pre-fill if typed
                                    setForgotPasswordOpen(true);
                                }}
                                className="text-sm font-medium text-orange-500 hover:text-orange-400"
                            >
                                Forgot password?
                            </button>
                        </div>
                    )}

                    <Button type="submit" className="w-full h-11 text-base bg-orange-500 hover:bg-orange-600 text-white" isLoading={isLoading}>
                        {isSignUp ? "Create account" : "Sign in"}
                    </Button>
                </form>

                <div className="text-center text-sm">
                    <span className="text-gray-400">
                        {isSignUp ? "Already have an account? " : "Don't have an account? "}
                    </span>
                    <button
                        onClick={toggleMode}
                        className="font-medium text-orange-500 hover:text-orange-400"
                        disabled={isLoading}
                    >
                        {isSignUp ? "Sign in" : "Sign up"}
                    </button>
                </div>
            </div>

            {/* Account Linking Modal */}
            {showLinkAccountModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md bg-gray-900 rounded-xl p-6 space-y-4 border border-gray-800 text-white">
                        <h3 className="text-lg font-bold">Account Exists</h3>
                        <p className="text-sm text-gray-400">
                            An account with the email <strong>{existingEmail}</strong> already exists.
                            Please sign in with your password to link your Google account.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setShowLinkAccountModal(false)} className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white">Cancel</Button>
                            <Button onClick={() => {
                                setShowLinkAccountModal(false);
                                setIsSignUp(false);
                                form.setValue("mode", "signin");
                                form.setValue("email", existingEmail);
                                document.getElementById("password")?.focus();
                                showToast("Please enter your password to link accounts", "info");
                            }} className="bg-orange-500 hover:bg-orange-600 text-white">
                                Sign in to Link
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Forgot Password Dialog */}
            <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                <DialogContent className="bg-gray-900 border-gray-800 text-white sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reset Password</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Enter your email address to receive a password reset link.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label htmlFor="reset-email" className="text-sm font-medium text-gray-300">Email</label>
                            <Input
                                id="reset-email"
                                type="email"
                                placeholder="name@example.com"
                                value={resetEmail}
                                onChange={(e) => setResetEmail(e.target.value)}
                                className="bg-gray-950 border-gray-800 text-white placeholder:text-gray-600 focus:border-orange-500"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setForgotPasswordOpen(false)}
                            className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleForgotPassword}
                            disabled={isResetLoading}
                            className="bg-orange-500 hover:bg-orange-600 text-white"
                        >
                            {isResetLoading ? "Sending..." : "Send Reset Link"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function SignInPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">Loading...</div>}>
            <SignInContent />
        </Suspense>
    );

}

// src/hooks/useEventWithdraw.ts
import { useState } from "react";
import { auth } from "@/lib/firebase";
import { User } from "firebase/auth";
import { EventData, Registration } from "@/lib/types";

export const useEventWithdraw = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const withdraw = async (
        user: User,
        event: EventData,
        registration: Registration | null,
        teamId: string | null,
        onSuccess?: () => void,
        confirmedLateWithdrawal?: boolean
    ) => {
        if (!user || !event) return;
        setLoading(true);
        setError(null);

        try {
            console.log(`[useEventWithdraw] Requesting withdrawal for user ${user.uid} in event ${event.eventId} (${event.unitType})`);

            const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : "";
            const res = await fetch("/api/events/withdraw", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify({
                    eventId: event.eventId,
                    targetUid: user.uid,
                    confirmedLateWithdrawal: !!confirmedLateWithdrawal,
                    acknowledgePenalty: !!confirmedLateWithdrawal,
                }),
            });

            const data = await res.json();

            if (data.requiresConfirmation || data.requiresAcknowledgment) {
                return {
                    requiresConfirmation: true,
                    requiresAcknowledgment: true,
                    isLate: data.isLate,
                    message: data.message || data.warningMessage,
                };
            }

            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to withdraw from event.");
            }

            console.log("[useEventWithdraw] Withdrawal completed successfully.");
            if (onSuccess) onSuccess();

            return data;
        } catch (err: unknown) {
            console.error("[useEventWithdraw] Error:", err);
            const msg = err instanceof Error ? err.message : "Failed to withdraw";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return { withdraw, loading, error };
};
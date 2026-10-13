"use client";

import { useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

export interface TeamWithdrawalResult {
    success: boolean;
    requiresConfirmation?: boolean;
    isLate?: boolean;
    warningMessage?: string;
    redflagged?: boolean;
    action?: string;
    error?: string;
}

export function useTeamRegistration() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getAuthHeaders = useCallback(async () => {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : "";
        return {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
    }, []);

    // SC-01 & SC-22: Solo Free Agent Registration
    const registerSolo = useCallback(async (eventId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/register-solo", {
                method: "POST",
                headers,
                body: JSON.stringify({ eventId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to register as free agent.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Registration error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-03: Send Standard Team Invitation
    const sendInvite = useCallback(async (eventId: string, inviteeId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/invite", {
                method: "POST",
                headers,
                body: JSON.stringify({ eventId, inviteeId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to send invitation.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Invitation error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-07: Accept Standard Team Invitation
    const acceptInvite = useCallback(async (teamId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/accept-invite", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to accept invitation.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Acceptance error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-04: Reject Standard Team Invitation
    const rejectInvite = useCallback(async (teamId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/reject-invite", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to decline invitation.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Decline error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-05: Cancel Standard Team Invitation
    const cancelInvite = useCallback(async (teamId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/cancel-invite", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to cancel invitation.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Cancel error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-02, SC-09, SC-14, SC-15: Withdraw from Team Event
    const withdraw = useCallback(async (
        eventId: string,
        confirmedLateWithdrawal?: boolean
    ): Promise<TeamWithdrawalResult> => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/withdraw", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    eventId,
                    confirmedLateWithdrawal: !!confirmedLateWithdrawal,
                }),
            });
            const data = await res.json();
            if (data.requiresConfirmation) {
                return {
                    success: false,
                    requiresConfirmation: true,
                    isLate: data.isLate,
                    warningMessage: data.warningMessage,
                };
            }
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to withdraw.");
            }
            return {
                success: true,
                action: data.data?.action,
                redflagged: data.data?.redflagged,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Withdrawal error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-10: Invite Replacement Partner
    const inviteReplacement = useCallback(async (teamId: string, candidateId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/invite-replacement", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId, candidateId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to invite replacement partner.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Replacement invite error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-11: Cancel Replacement Partner Invite
    const cancelReplacementInvite = useCallback(async (teamId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/cancel-replacement-invite", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to cancel replacement invite.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Cancel replacement error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-12: Accept Replacement Partner Vacancy
    const acceptReplacement = useCallback(async (teamId: string) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/accept-replacement", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to accept replacement.");
            }
            return data.data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Accept replacement error";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    // SC-13: Process Grace Period Expiry
    const checkExpiry = useCallback(async (teamId: string) => {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/events/teams/check-expiry", {
                method: "POST",
                headers,
                body: JSON.stringify({ teamId }),
            });
            return await res.json();
        } catch {
            return null;
        }
    }, [getAuthHeaders]);

    return {
        registerSolo,
        sendInvite,
        acceptInvite,
        rejectInvite,
        cancelInvite,
        withdraw,
        inviteReplacement,
        cancelReplacementInvite,
        acceptReplacement,
        checkExpiry,
        loading,
        error,
    };
}

"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";

interface LateWithdrawalWarningDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    loading?: boolean;
    warningMessage?: string;
    message?: string;
}

export function LateWithdrawalWarningDialog({
    open,
    onOpenChange,
    onConfirm,
    loading = false,
    warningMessage,
    message,
}: LateWithdrawalWarningDialogProps) {
    const displayMessage = message || warningMessage;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px] bg-gray-950 border border-red-500/40 text-white">
                <DialogHeader>
                    <div className="flex items-center gap-3 text-red-500 mb-2">
                        <div className="p-2 rounded-full bg-red-500/10 border border-red-500/20">
                            <AlertTriangle className="h-6 w-6 text-red-500" />
                        </div>
                        <DialogTitle className="text-xl font-bold text-red-400">
                            Late Withdrawal Warning
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-gray-300 text-sm leading-relaxed pt-2">
                        {displayMessage || (
                            <>
                                This withdrawal is within the <strong>final 3 hours</strong> before the event start.
                                <br /><br />
                                Continuing will withdraw you from the event and mark your account as{" "}
                                <strong className="text-red-400">RED-FLAGGED</strong>. Red-flagged players cannot participate
                                in or register for future events until cleared by an administrator.
                                <br /><br />
                                Your teammate will remain in the event as a Free Agent.
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter className="mt-6 flex flex-col sm:flex-row gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                        className="border-gray-700 text-gray-300 hover:bg-gray-800"
                    >
                        Keep My Registration
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={loading}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Confirming Withdrawal...
                            </>
                        ) : (
                            "Confirm Late Withdrawal"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

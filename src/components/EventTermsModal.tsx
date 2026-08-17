"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, FileText, Clock, AlertTriangle, UserCheck, Camera } from "lucide-react";
import { EventData } from "@/types";

interface EventTermsModalProps {
    event: EventData;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EventTermsModal({ event, open, onOpenChange }: EventTermsModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto bg-gray-950 border-gray-800 text-white p-6">
                <DialogHeader className="border-b border-gray-800 pb-4 mb-4">
                    <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                        <ShieldCheck className="h-6 w-6 text-orange-500" />
                        Terms & Conditions — {event.eventName}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
                        Please review the rules, policies, and health waiver for this event.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 text-sm text-gray-300">
                    {/* Custom Organizer Terms (if provided) */}
                    {event.termsAndConditions && event.termsAndConditions.trim().length > 0 && (
                        <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl space-y-2">
                            <h4 className="font-semibold text-orange-400 flex items-center gap-2 text-base">
                                <FileText className="h-4 w-4" /> Organizer&apos;s Specific Rules
                            </h4>
                            <p className="whitespace-pre-line text-gray-200 leading-relaxed text-sm">
                                {event.termsAndConditions}
                            </p>
                        </div>
                    )}

                    {/* Standard Platform Terms */}
                    <div className="space-y-4">
                        <h4 className="font-semibold text-white text-base border-b border-gray-800 pb-2">
                            Platform Event Rules & Policies
                        </h4>

                        {/* 1. Cancellation */}
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-900 rounded-lg shrink-0 mt-0.5">
                                <Clock className="h-4 w-4 text-orange-400" />
                            </div>
                            <div>
                                <h5 className="font-medium text-white">1. Cancellation & Withdrawal Policy</h5>
                                <p className="text-xs text-gray-400 mt-0.5 leading-normal">
                                    Withdrawals must be requested at least 24 hours prior to match start time. Late withdrawals or no-shows without notification may lead to waitlist promotion penalties or account restrictions.
                                </p>
                            </div>
                        </div>

                        {/* 2. Punctuality */}
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-900 rounded-lg shrink-0 mt-0.5">
                                <AlertTriangle className="h-4 w-4 text-amber-400" />
                            </div>
                            <div>
                                <h5 className="font-medium text-white">2. Punctuality & Match Start</h5>
                                <p className="text-xs text-gray-400 mt-0.5 leading-normal">
                                    Please arrive at the venue at least 15 minutes before scheduled start time. Players arriving more than 10 minutes past start time risk forfeiting their spot to an on-site waitlist player.
                                </p>
                            </div>
                        </div>

                        {/* 3. Etiquette & Gear */}
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-900 rounded-lg shrink-0 mt-0.5">
                                <UserCheck className="h-4 w-4 text-green-400" />
                            </div>
                            <div>
                                <h5 className="font-medium text-white">3. Court Etiquette & Equipment</h5>
                                <p className="text-xs text-gray-400 mt-0.5 leading-normal">
                                    Non-marking padel or tennis shoes and proper sportswear are mandatory. Fair play, sportsmanship, and respect towards opponents, court staff, and referees are required at all times.
                                </p>
                            </div>
                        </div>

                        {/* 4. Health & Safety Waiver */}
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-900 rounded-lg shrink-0 mt-0.5">
                                <ShieldCheck className="h-4 w-4 text-blue-400" />
                            </div>
                            <div>
                                <h5 className="font-medium text-white">4. Health & Liability Waiver</h5>
                                <p className="text-xs text-gray-400 mt-0.5 leading-normal">
                                    By registering, participants confirm they are physically fit for active play. EveryWherePadel and venue operators are not liable for accidental physical injuries or personal property loss occurring during events.
                                </p>
                            </div>
                        </div>

                        {/* 5. Media Release */}
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-900 rounded-lg shrink-0 mt-0.5">
                                <Camera className="h-4 w-4 text-purple-400" />
                            </div>
                            <div>
                                <h5 className="font-medium text-white">5. Event Media & Photography</h5>
                                <p className="text-xs text-gray-400 mt-0.5 leading-normal">
                                    Photos and highlight videos taken during the event may be shared on the EveryWherePadel media gallery and official social channels.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-6 border-t border-gray-800 pt-4">
                    <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white font-medium">
                        I Understand & Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

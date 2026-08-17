"use client";

import { useState } from "react";
import { ShieldCheck, FileText, ExternalLink, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventData } from "@/types";
import { EventTermsModal } from "@/components/EventTermsModal";

interface EventTermsSectionProps {
    event: EventData;
}

export function EventTermsSection({ event }: EventTermsSectionProps) {
    const [modalOpen, setModalOpen] = useState(false);

    return (
        <>
            <div className="bg-gray-900/40 backdrop-blur-2xl rounded-2xl border border-gray-800/50 p-6 mb-8 relative overflow-hidden shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-800/80 pb-4 mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-orange-500/10 rounded-xl border border-orange-500/20">
                            <ShieldCheck className="h-5 w-5 text-orange-500" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                Terms & Conditions
                            </h3>
                            <p className="text-xs text-gray-400">
                                Event rules, cancellation policy, and health waiver
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setModalOpen(true)}
                        className="border-gray-700 hover:border-orange-500/50 text-gray-300 hover:text-white bg-gray-950/50 hover:bg-gray-800 text-xs gap-1.5"
                    >
                        <span>View Details</span>
                        <ExternalLink className="h-3.5 w-3.5 text-orange-400" />
                    </Button>
                </div>

                {/* Organizer Specific Terms Highlight (if present) */}
                {event.termsAndConditions && event.termsAndConditions.trim().length > 0 ? (
                    <div className="mb-4 p-3.5 bg-orange-500/5 border border-orange-500/20 rounded-xl">
                        <div className="flex items-center gap-2 text-xs font-semibold text-orange-400 mb-1">
                            <FileText className="h-3.5 w-3.5" />
                            <span>Organizer Rules</span>
                        </div>
                        <p className="text-xs text-gray-300 line-clamp-3 leading-relaxed">
                            {event.termsAndConditions}
                        </p>
                    </div>
                ) : null}

                {/* Policy Highlights Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-gray-950/40 p-3 rounded-xl border border-gray-800/60 flex items-start gap-2.5">
                        <Clock className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-semibold text-white">24h Cancellation</p>
                            <p className="text-[11px] text-gray-400 leading-tight">Free cancellation up to 24 hours prior to match start.</p>
                        </div>
                    </div>

                    <div className="bg-gray-950/40 p-3 rounded-xl border border-gray-800/60 flex items-start gap-2.5">
                        <ShieldCheck className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-semibold text-white">Fair Play & Attire</p>
                            <p className="text-[11px] text-gray-400 leading-tight">Padel shoes and proper sportswear required.</p>
                        </div>
                    </div>

                    <div className="bg-gray-950/40 p-3 rounded-xl border border-gray-800/60 flex items-start gap-2.5">
                        <AlertCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-semibold text-white">15-Min Arrival</p>
                            <p className="text-[11px] text-gray-400 leading-tight">Arrive 15 mins early to avoid forfeiting spot.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Terms Modal */}
            <EventTermsModal
                event={event}
                open={modalOpen}
                onOpenChange={setModalOpen}
            />
        </>
    );
}

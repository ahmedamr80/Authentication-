"use client";

import { useState, useRef, useEffect } from "react";
import { CalendarPlus, Calendar, Mail, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventData } from "@/lib/types";
import { addMinutes } from "date-fns";

interface AddToCalendarButtonProps {
    event: EventData;
    className?: string;
}

export function AddToCalendarButton({ event, className }: AddToCalendarButtonProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Get event details with fallbacks
    // Use aliased fields if main ones are missing to handle different data structures
    const title = event.eventName || event.title || "Padel Event";
    const description = `Join us for ${title}!`;
    const location = event.locationName || event.location || "Padel Court";

    // Date handling
    const startTimeStamp = event.dateTime || event.eventDate;
    const startDate = startTimeStamp ? startTimeStamp.toDate() : new Date();
    const duration = event.duration || 90; // Default 90 min
    const endDate = addMinutes(startDate, duration);

    // Format for Calendar Links (YYYYMMDDTHHMMSSZ) - UTC
    const formatToISO = (date: Date) => {
        return date.toISOString().replace(/-|:|\.\d+/g, "");
    };

    const handleGoogle = () => {
        const start = formatToISO(startDate);
        const end = formatToISO(endDate);
        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;
        window.open(url, "_blank");
        setIsOpen(false);
    };

    const handleOutlook = () => {
        const start = startDate.toISOString();
        const end = endDate.toISOString();
        const url = `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&startdt=${start}&enddt=${end}&subject=${encodeURIComponent(title)}&body=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;
        window.open(url, "_blank");
        setIsOpen(false);
    };

    const handleICal = () => {
        const formatDate = (date: Date) => date.toISOString().replace(/-|:|\.\d+/g, '');

        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Padel App//Event//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `DTSTART:${formatDate(startDate)}`,
            `DTEND:${formatDate(endDate)}`,
            `SUMMARY:${title}`,
            `DESCRIPTION:${description}`,
            `LOCATION:${location}`,
            `UID:${event.eventId || new Date().getTime()}@padelapp.com`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n'); // CRLF line endings for iCal

        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${title.replace(/\s+/g, '_')}.ics`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setIsOpen(false);
    };

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            <Button
                variant="default"
                size="sm"
                className="gap-2 bg-white text-black hover:bg-gray-200 border-transparent"
                onClick={() => setIsOpen(!isOpen)}
            >
                <CalendarPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Add to Calendar</span>
            </Button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-gray-900 border border-gray-800 ring-1 ring-black ring-opacity-5 z-50">
                    <div className="py-1" role="menu" aria-orientation="vertical">
                        <button
                            onClick={handleGoogle}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white gap-2 text-left"
                            role="menuitem"
                        >
                            <Calendar className="w-4 h-4 text-orange-500" />
                            Google Calendar
                        </button>
                        <button
                            onClick={handleOutlook}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white gap-2 text-left"
                            role="menuitem"
                        >
                            <Mail className="w-4 h-4 text-blue-500" />
                            Outlook
                        </button>
                        <button
                            onClick={handleICal}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white gap-2 text-left"
                            role="menuitem"
                        >
                            <FileDown className="w-4 h-4 text-green-500" />
                            Apple / iCal
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

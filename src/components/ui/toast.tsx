"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastProps {
    message: string;
    type?: "success" | "error" | "info" | "warning";
    onClose: () => void;
}

export const Toast = ({ message, type = "info", onClose }: ToastProps) => {
    React.useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div
            className={cn(
                "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-in slide-in-from-bottom-5",
                type === "success" && "bg-green-600 text-white",
                type === "error" && "bg-red-600 text-white",
                type === "info" && "bg-gray-800 text-white",
                type === "warning" && "bg-yellow-600 text-white"
            )}
        >
            <span>{message}</span>
            <button onClick={onClose} className="ml-2 hover:opacity-80">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
};

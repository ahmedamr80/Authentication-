import { NextResponse } from "next/server";
import { validatePasswordSecurity } from "@/lib/auth/password-security";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { password } = body || {};

        if (!password || typeof password !== "string") {
            return NextResponse.json(
                { valid: false, error: "Password is required." },
                { status: 400 }
            );
        }

        const result = await validatePasswordSecurity(password);
        if (!result.valid) {
            return NextResponse.json(result, { status: 400 });
        }

        return NextResponse.json({ valid: true });
    } catch (error) {
        console.error("Error in validate-password API route:", error);
        return NextResponse.json(
            { valid: false, error: "Internal server error during password validation." },
            { status: 500 }
        );
    }
}

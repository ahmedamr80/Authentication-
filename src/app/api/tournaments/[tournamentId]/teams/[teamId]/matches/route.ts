import { NextRequest, NextResponse } from "next/server";
import {
    buildTeamTournamentSummary,
    queryTeamMatchesFromFirestore,
} from "@/lib/tournaments/teamMatchesQuery";

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ tournamentId: string; teamId: string }> }
) {
    try {
        const { tournamentId, teamId } = await context.params;
        if (!tournamentId || !teamId) {
            return NextResponse.json(
                { error: "Missing tournamentId or teamId" },
                { status: 400 }
            );
        }

        const { tournament, matches } = await queryTeamMatchesFromFirestore(
            tournamentId,
            teamId
        );

        if (!tournament) {
            return NextResponse.json(
                { error: "Tournament not found", tournamentId },
                { status: 404 }
            );
        }

        const summary = buildTeamTournamentSummary(tournament, teamId);

        return NextResponse.json({
            tournamentId,
            teamId: summary.teamId,
            summary,
            matches,
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to fetch team matches" },
            { status: 500 }
        );
    }
}


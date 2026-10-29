# Feature Request: Tournament Mode Visual Enhancements, Dynamic Scoring & Admin PDF Export

Please implement the following functional, visual, and architectural enhancements for the Tournament Mode in our application.

---

### 1. Database Schema & Query Layer Updates (Perform First)

- **Tournament Settings Schema**:
  - Add a `matchFormat` field to the tournament document/table (e.g., `setsToWin` or `numberOfSets`), configured during tournament creation. Default: `1 set`.
- **Match Document Schema**:
  - Update match status enum: `'NOT_STARTED' | 'ONGOING' | 'CLOSED'`.
  - Update score structure to support multi-set scoring and optional tie-breaks:
    
    ```typescript
    //This is only an example to convey the idea, use your current and preferred collections names
    //like sideASlots and sideBslot and so on
    
    
    interface SetScore {
      setNumber: number;
      teamAScore: number;
      teamBScore: number;
      tieBreak?: {
        teamAScore: number;
        teamBScore: number;
      };
    }
    ```
  - Ensure status flags reflect winner (`winnerTeamId: string | null`), loser (`loserTeamId: string | null`), or draw (`isDraw: boolean`).
    also the above is just a guide and suggestion, use the method you see best for your implimentation.
- **Team-Specific Querying**:
  - Implement an indexed query or route handler to fetch all matches involving a specific team:
    `WHERE (teamAId == targetTeamId OR teamBId == targetTeamId) AND tournamentId == currentTournamentId` (ensure compound indexes are created where needed).

---

### 2. Match Card Visuals & Status Transitions

Each match card must display three explicit status buttons with associated theme states:

| Status          | Theme / Accent Style                             | Functional Behavior                                                                                                                  |
|:--------------- |:------------------------------------------------ |:------------------------------------------------------------------------------------------------------------------------------------ |
| **Not Started** | Reddish theme (subtle light-red bg, red accents) | Resets match scores to 0 / empty. Locks input fields.                                                                                |
| **Ongoing**     | Yellowish / Amber theme                          | Unlocks score inputs. Retains updates in local component state **without** writing directly to the remote database until submission. |
| **Closed**      | Green theme                                      | Locks score inputs. Commits the final scores and winner/loser calculation to the database. Updates tournament standings.             |

- **Card Border Accents**:
  - Winning team container: `border: 2px solid #22c55e` (Green) or as per your standard green that you usually use
  - Losing team container: `border: 2px solid #ef4444` (Red). or as per your standard red that you usually use
  - If match is a draw: keep neutral borders. or as per your standard yellow that you usually use

---

### 3. Dynamic Sets & Tie-Break Logic

- **Set Configuration**:
  - On tournament creation/setup modal, include a dropdown or any other method you see suitable for the app to select number of sets (`1 set`, `3 sets`, `5 sets`). Default is `1 set`.
  - The match card scoring inputs must render dynamically based on this setting.
- **Tie-Break Handling**:
  - When scores in a set indicate a draw condition, conditionally display an optional **Tie-Break** input toggle/field for that set.
  - If a tie-break score is entered, use it to designate the winning team.
  - If no tie-break is entered, allow the match to conclude and record as a legitimate draw.

---

### 4. Interactive Team Navigation

- Make team names and pictuers on the match cards clickable links/buttons.
- Clicking a team navigates to a dedicated Team Filter view (e.g., `/tournament/[id]/team/[teamId]` or an inline modal/drawer view).
- This view must display:
  - Team summary (matches played, wins, draws, losses, points).
  - Filtered list of all matches involving this team (past, live, and upcoming) with current scores.
    
    p.s: for this tournamnet only

---

### 5. Admin Console: PDF Export for Standings & Schedule

- In the **Admin Console** under the tournament workspace, add an action button: **"Export / Print Tournament Summary"**.
- Generate a clean, printer-friendly, vector-crisp PDF document using standard print-stylesheet or client-side PDF generation (`jspdf` / `html2pdf.js` / server-side headless renderer).
- **PDF Layout Requirements**:
  - **Header**: Tournament logo, tournament title, venue/date, current status snapshot, and timestamp.
  - **Section 1: Live Standings**: Clean table showing Rank, Team, Played, Won, Drawn, Lost, Points/Differential.(optional, while the print request, the user can check a box to prinit this section, other wise ignore it)
  - **Section 2: Match Matrix / Fixture List**: Grouped by round and/or court, showing current scores (or empty score placeholders if 'Not Started').
  - **Print Optimization**: Black & white / grayscale-friendly styling, high contrast, compact margins (`@page { size: A4 portrait; margin: 12mm; }`), and strict page-break control (`break-inside: avoid` on tables and cards). and give option for color printing

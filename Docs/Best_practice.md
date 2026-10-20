Comprehensive Brief: Copa Fácil (`copafacil.com`)
=================================================

**Copa Fácil** is a sports competition and tournament management platform designed for tournament organizers, leagues, clubs, players, and spectators. Originating in Brazil (_José Augusto N Costa LTDA_) and operating globally across five languages (Portuguese, English, Spanish, French, and Italian), it has amassed **over 5 million downloads** across Android and iOS, with an average rating of **4.8–4.9/5.0**.

* * *

1. Executive Summary & Value Proposition

----------------------------------------

* **Core Problem Solved:** Eliminates reliance on complex spreadsheets, manual bracket drawing, and chaotic WhatsApp groups for amateur and semi-professional sports competitions.

* **Promise:** Set up an entire tournament, from team rosters to automated schedules, in under five minutes.

* **Ecosystem:** Unified across the web (`copafacil.com`), mobile apps (Google Play and Apple App Store), and embeddable widgets for third-party league websites.

* * *

2. Technical Architecture & Stack

---------------------------------

| Layer                         | Technologies & Infrastructure                            | Details                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Marketing & Portal**        | Semantic HTML5, CSS3, ES2022                             | High-performance landing page with minimal framework overhead, smooth micro-animations, dark/light theme tokens, and dynamic localized pricing.         |
| **Web Application**           | **Flutter for Web** (`main.dart.js`)                     | Rendered via **CanvasKit (Skia WebAssembly)**, with an HTML fallback for Safari. Shares the core codebase with the native Android and iOS Flutter apps. |
| **Mobile Applications**       | Cross-platform **Flutter** (Android/iOS)                 | Distributed through Google Play (`com.copafacil`) and the Apple App Store (`id1444543396`).                                                             |
| **Cloud & Backend**           | **Google Cloud Platform (GCP)** and **Firebase**         | Project `copafacil-web`, hosted in `us-central1`. Microservices implemented through GCP Cloud Functions, such as `championshipsSearch/search`.          |
| **Storage & Database**        | Firebase Firestore, Realtime Database, and Cloud Storage | Storage bucket `copafacil-web.appspot.com` handles tournament badges, team crests, sponsor banners, match reports, and media uploads.                   |
| **Content Delivery (CDN)**    | **BunnyCDN** (`copafacil.b-cdn.net`)                     | Serves Flutter Web build artifacts, video demonstrations, assets, and user-generated media through global edge caching.                                 |
| **Payments & Authentication** | **Stripe** (`js.stripe.com/v3`) and **Firebase Auth**    | Multi-currency subscriptions in USD and BRL, with OAuth sign-in through Google Sign-In.                                                                 |
| **Third-Party APIs**          | Google Maps API, Cropper.js, and Google Analytics        | Supports venue and pitch geolocation, responsive image cropping for logos and banners, and analytics.                                                   |

* * *

3. Supported Sports & Formats

-----------------------------

Copa Fácil is a multi-sport platform that supports rulesets tailored to the following categories:

* **Football / Soccer:** 11-a-side, futsal, and society / 7-a-side.

* **Court Sports:** Basketball, volleyball, beach volleyball, and handball.

* **Racquet Sports:** Tennis, padel, and table tennis.

* **Esports:** EA Sports FC / FIFA, eFootball, MOBA, and tactical shooter tournaments.

* **Custom / Other Sports:** Flexible scoring systems that adapt to points, sets, or goals.

### Tournament Formats Supported

1. **Round-Robin (Pontos Corridos):** Single- or double-leg league tables.

2. **Knockout / Single Elimination:** Automatic seeding brackets with an optional third-place playoff.

3. **Double Elimination:** Winners' and losers' brackets.

4. **Group Stage + Knockout:** World Cup / Champions League format with configurable advancement counts.

5. **Multi-Category Divisions:** Run Veterans, Under-17, Men's, and Women's divisions under one championship.

* * *

4. Key Functional Capabilities

------------------------------

### A. Automation & Scheduling

* **Automatic Fixture Generation:** Automatically generates match days, pairings, and round dates based on registered teams.

* **Live Automated Standings:** Automatically recalculates:
  
  * Points (PTS)
  
  * Played (PL)
  
  * Wins, draws, and losses
  
  * Goals for (GF)
  
  * Goals against (GA)
  
  * Goal difference (GD)
  
  * Custom tie-breaking rules

### B. Match Management & Electronic Scoresheets (_Súmula_)

* **In-Game Event Tracking:** Live logging of goals, assists, yellow and red cards, fouls, and substitutions.

* **Disciplinary Tracking:** Automatically tracks card accumulation and player suspensions for consecutive matches.

* **Printable Match Sheets:** Generates print-ready official match sheets (_súmulas_) with referee signature areas for match-day logistics.

### C. Statistics & Leaderboards

* **Top Scorer Tables (**_**Artilharia**_**):** Live player-scoring leaderboards.

* **Best Defense & Fair Play:** Tracks teams that concede the fewest goals and those with the best disciplinary records.

* **Player Profiles:** Detailed profiles featuring match history, statistics, and team affiliations.

### D. Media & Social Marketing Engine

* **Social Media Card Generator:** One-click generation of branded, shareable graphics for:
  
  * Match results
  
  * Upcoming fixtures
  
  * League standings

  Graphics are tailored for Instagram Stories, Instagram Posts, and WhatsApp.

* **Media Feed:** Live timeline featuring photos, highlight videos, and written match reports.

### E. Multi-Admin Collaboration & Sponsorship

* **Staff / Moderator Roles:** Delegates score entry and match-sheet administration to referees or pitch coordinators without granting full administrative privileges.

* **Sponsor Monetization:** Configurable sponsor-banner carousels embedded in tournament pages and match views, enabling organizers to sell advertising space to local sponsors.

* * *

5. Monetization & Business Model

--------------------------------

Copa Fácil uses a **freemium SaaS business model**.

| Tier                  | Price (USD / Global)                                     | Price (BRL / Brazil)                                        | Capacity & Key Features                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free**              | $0                                                       | R$ 0                                                        | Core tournament creation, bracket generation, and result logging; ad-supported experience.                                                                                                                 |
| **Custom (Flexible)** | Starting at **$4.70/month**, billed annually at $39/year | Starting at **R$ 25/month**, billed annually at R$ 210/year | Ad-free experience for players and fans; capacity tiers of 300, 600, or 900 players; 3–12 sponsor slots; social media graphic exports; custom tournament URL/slug; printable match sheets and PDF reports. |
| **Professional**      | **$10.30/month**, billed annually at $86.50/year         | **R$ 55/month**, billed annually at R$ 462/year             | Unlimited players and sponsors; all Custom features; REST JSON API access; website embed widgets using iframe/embed code; Excel/CSV spreadsheet imports.                                                   |

* * *

6. Competitive Advantages & Market Positioning

----------------------------------------------

### 6.1. Low Friction for Grassroots Leagues

Eliminates barriers to entry for amateur leagues through free access, mobile-first tournament management, and simplified administration.

### 6.2. True Cross-Platform Synchronization

Changes made on a mobile device by a pitch-side referee are reflected in the web scoreboard and fan apps through GCP/Firebase real-time synchronization.

### 6.3. Viral Organic Growth Loop

Players and organizers share automatically generated social media graphics on WhatsApp and Instagram, attracting spectators and bringing new organizers back to `copafacil.com`.

* * *

_Note: The technical architecture, feature descriptions, download figures, ratings, and subscription prices above are presented as supplied in the original brief and have not been independently verified._

Deep Dive: Tennis & Racquet Sports (Pairs / _Duplas_) Mode in Copa Fácil
========================================================================

Based on decompilation and analysis of Copa Fácil’s client runtime (`main.dart.js`), data models, and backend schema, this document provides a detailed breakdown of how **Tennis (Pairs / Doubles)** and its related disciplines—**Beach Tennis** and **Padel**—operate under the hood.

* * *

1. Domain Model & Sport Taxonomy

--------------------------------

In Copa Fácil’s internal schema, racquet sports are modeled through a combination of `sport_cod` and `sport_2` (sub-modality flag).

| Sport                        | `sport_cod` | `sport_2` | Entity Mode (`b0()`)    | Display Label (`eZ()`)                    |
| ---------------------------- | ----------- | --------- | ----------------------- | ----------------------------------------- |
| **Tennis (Court) — Pairs**   | `26`        | `1`       | `B.aM` (`"duplas"`)     | `Tênis (dupla)` / `Tennis (pairs)`        |
| **Tennis (Court) — Singles** | `26`        | `0`       | `B.a1` (`"individual"`) | `Tênis (individual)` / `Tennis (singles)` |
| **Beach Tennis — Pairs**     | `25`        | `1`       | `B.aM` (`"duplas"`)     | `Beach Tennis (dupla)`                    |
| **Beach Tennis — Singles**   | `25`        | `0`       | `B.a1` (`"individual"`) | `Beach Tennis (individual)`               |
| **Padel**                    | `17`        | `1`       | `B.aM` (`"duplas"`)     | `Padel` (always doubles by nature)        |
| **Table Tennis — Pairs**     | `27`        | `1`       | `B.aM` (`"duplas"`)     | `Tênis de Mesa (dupla)`                   |
| **Table Tennis — Singles**   | `28`        | `0`       | `B.a1` (`"individual"`) | `Tênis de Mesa (individual)`              |

When `b0() === B.aM`, the engine switches its terminology, data structures, and forms from `"team"` or `"athlete"` to `**"duplas"**` **(Pairs)**.

* * *

2. Multi-Category Architecture (`with_categories`)

--------------------------------------------------

Tennis and Beach Tennis tournaments commonly operate with multiple competition categories rather than a single flat bracket. Copa Fácil implements a **categorized tournament container**, represented by `with_categories: true` or the abbreviated key `m_evt: true`.

### Example Structure

    Tournament Container: Open Tennis Championship 2026├── Category 1: Duplas Masculinas PRO / A (Men's Doubles PRO)├── Category 2: Duplas Masculinas B / C (Intermediate)├── Category 3: Duplas Femininas Open (Women's Doubles)├── Category 4: Duplas Mistas (Mixed Doubles)└── Category 5: Duplas Master +40 / +50

### What Each Category Encapsulates

* **Independent Draw / Bracket:** Each category has its own group stage or elimination tree.

* **Dedicated Seeding:** Seed rankings (#1, #2, #3, etc.) are assigned separately within each category.

* **Custom Match Format:** Categories can use different match formats. For example, beginners may play a single pro set to six games, while the PRO category plays best-of-three sets with a Super Tie-Break.

* **Independent Standings Table:** Standings and game balances are tracked separately within each division.

* * *

3. Competitor / Pair (_Dupla_) Roster Model

-------------------------------------------

Unlike team sports, which require larger squad sheets, or individual sports, which involve a single athlete, doubles competitions use a pair-based competitor model.

### 3.1. Competitor Identity

* **Pair Name:** The primary display identifier, such as `Silva / Santos` or `Carlos Mendes & Rafael Lima`.

* **Avatar / Badge:** A default racquet-sport icon or custom image representing the duo.

* **Seeding (**_**Cabeça de Chave**_**):** A numerical seed (1, 2, 3, etc.) used to position top-ranked pairs within the bracket.

### 3.2. Dual-Athlete Association

* Each pair record stores two player sub-profiles: `pl_id1` and `pl_id2`.

* If player accounts are linked, both athletes can receive push notifications about upcoming matches and court assignments.

* **Dual-Event Protection:** The system tracks players registered in multiple categories, such as Men's Doubles and Mixed Doubles, to prevent scheduling conflicts involving simultaneous matches.

* * *

4. Match Scoring Engine & Data Structures

-----------------------------------------

In conventional team sports, such as football and basketball, scores are typically stored as scalar values:
    {  "score1": 2,  "score2": 1}

In Tennis and Beach Tennis, Copa Fácil uses an array-based, multi-set scoring model.

### 4.1. Example Score Record

    {  "tipo": 3,  "qt_g1": [6, 4, 10],  "qt_g2": [4, 6, 8],  "qt_g_t1": [0, 0, 10],  "qt_g_t2": [0, 0, 8]}

### 4.2. Field Definitions

* `**tipo**` **— Match Length / Set Type**
  
  * `1`: **Pro Set / Set Único** — A single set played to 6, 8, or 9 games, potentially using No-Ad or advantage scoring. Commonly used in Beach Tennis pool stages.
  
  * `3`: **Best of Three Sets** — Traditional tennis match format.
  
  * `5`: **Best of Five Sets** — Grand Slam-style match format.

* `**qt_g1**` **/** `**qt_g2**` **— Games per Set**
  
  * Zero-indexed arrays representing the game count in each set for Pair 1 and Pair 2.
  
  * Example: `qt_g1[0] = 6` and `qt_g2[0] = 4` means Pair 1 won the first set 6–4.

* `**qt_g_t1**` **/** `**qt_g_t2**` **— Tie-Break Points**
  
  * Store tie-break points when a set reaches a tie-break situation, such as 6–6, or when a deciding match tie-break is played.
  
  * Example: `7–5` or `10–8`.

* **Super Tie-Break (Match Tie-Break)**
  
  * When the match is tied at one set each, the third set may be replaced with a 10-point Super Tie-Break.
  
  * In the example above, the deciding slot records `10–8`, which may be displayed as `1–0 (10–8)` depending on the interface.

### 4.3. Set Resolution Logic (`a6u`)

The following pseudocode represents the set-resolution logic identified in the decompiled runtime, `A.aF9.prototype.a6u`.
    if (games1 > games2) {  return 1;} else if (games2 > games1) {  return 2;} else if (games1 === games2) {  // If games are tied, tie-break points break the tie.  if (tiebreak1 > tiebreak2) {    return 1;  } else if (tiebreak2 > tiebreak1) {    return 2;  }}return 0; // Set unfinished or drawn

**Logic summary:**

1. Compare the games won by both pairs.

2. If the game scores are equal, compare the tie-break points.

3. Return `1` if Pair 1 wins the set.

4. Return `2` if Pair 2 wins the set.

5. Return `0` if the set remains unfinished or unresolved.

* * *

5. Tournament Formats & Bracket Draw

------------------------------------

Copa Fácil provides three primary competition formats for pairs.

### A. Group Stage + Knockout (_Grupos + Mata-Mata_)

* **Typical Amateur Format:** Groups containing three or four pairs.

* **Minimum Match Guarantee:** Each pair plays at least two or three matches, depending on the group size and format.

* **Advancement:** The top one or two pairs from each group advance to an eight-pair or 16-pair knockout bracket.

* **Knockout Stages:** Quarterfinals, semifinals, and final, depending on the bracket size.

### B. Pure Knockout (_Mata-Mata Direto_)

* **Format:** Direct-elimination bracket, such as 32 pairs → 16 pairs → 8 pairs → semifinals → final.

* **Automatic Byes (**_**Folgas**_**):** When the number of pairs is not a power of two, such as 22 pairs, the bracket requires byes or preliminary matches.

* **Seeding:** Byes may be allocated to top-seeded pairs, such as seeds #1 and #2, depending on the draw rules.

### C. Round-Robin (_Todos Contra Todos_)

* **Format:** Every pair plays against every other pair in the group.

* **Typical Use:** Smaller invitational competitions, such as pools containing five or six pairs.

* **Outcome:** Final rankings are determined from match results and the configured tie-breaking rules.

* * *

6. Standings & Tie-Break Rules in Group Stages

----------------------------------------------

In round-robin and group-stage competitions, standings can use the following tennis-specific metrics.

1. **V — Vitórias / Matches Won:** Number of matches won; primary ranking criterion.

2. **Saldo de Sets — Set Differential:** Sets won minus sets lost across all matches.

3. **Saldo de Games — Game Differential:** Total games won minus total games conceded across all sets.

4. **Confronto Direto — Head-to-Head:** Used to resolve ties between pairs, subject to the applicable tie-breaking rules.

5. **Menor Número de Games Sofridos — Fewest Games Conceded:** An additional tie-breaker when pairs remain tied.

_Note: The exact ranking sequence may depend on the tournament configuration and the implementation of the applicable ruleset._

* * *

7. Match-Day Operations & Social Sharing

----------------------------------------

### 7.1. Court Assignment & Time Slots

* Organizers assign matches to specific courts, such as _Quadra 1 (Central)_ and _Quadra 2_, with designated start times.

* Referees or court marshals can enter scores live from mobile devices at the court.

### 7.2. Electronic Match Sheet (_Súmula de Tênis_)

* Match summary, including sets, duration, and final score.

* Printable PDF match sheets for court clipboards and physical record retention.

### 7.3. Social Media Graphics Generator

Automatically generates high-resolution graphics in formats suitable for:

* **Instagram Stories:** 9:16 aspect ratio.

* **Instagram Posts:** 1:1 or 4:5 aspect ratios.

Graphics are formatted for doubles competitions and can include:

* Pair A player names.

* Pair B player names.

* Set-by-set score lines, such as `6/3 4/6 [10-7]`.

* Category badges, such as _Dupla Mista B_.

* Sponsor logos.

* * *

8. Key Takeaways

----------------

* **Pair-Centric Architecture:** Doubles competitors are modeled as pairs linked to two individual player profiles.

* **Category-Based Competition:** A single championship can contain multiple independent divisions, each with its own draw, seeding, scoring configuration, and standings.

* **Multi-Set Scoring:** Tennis-style results require arrays for set scores and tie-break points rather than simple match-level scores.

* **Flexible Tournament Formats:** Group stages, knockout brackets, and round-robin formats accommodate different competition sizes.

* **Operational Integration:** Court assignments, score entry, printable match sheets, and social media graphics support the full tournament lifecycle.

* * *

_Technical note: This document organizes the supplied findings from the decompiled client runtime and schema analysis. The underlying implementation details, field semantics, and claimed behaviors have not been independently verified against a live Copa Fácil environment._



Deep Dive: Padel UI & User Experience in Copa Fácil
===================================================

In Copa Fácil, **Padel** belongs to the racquet sports engine (`sport_cod: 17`). It inherits the specialized sets, games, and tie-break architecture while utilizing the dedicated **Pairs (**_**Duplas**_**)** competitor model (`b0() === B.aM`).

This document provides a structured breakdown of the user interface, screen flows, widgets, and design patterns governing Padel on both mobile and web.

* * *

1. Visual Identity & Design System

----------------------------------

### 1.1. Color Palette & Theme Tokens

| Element                     | Color / Token                                                | Purpose                                |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| **Primary Background**      | Deep Navy (`#14275A`)                                        | Main application background            |
| **Secondary Background**    | Dark Slate (`#0B1536`)                                       | Secondary surfaces and panels          |
| **Court & Action Accent**   | Neon Green / Mint (`#22C982`)                                | Buttons, active tabs, and match status |
| **Highlight & Ball Accent** | Padel Yellow (`#FFD437`)                                     | Tie-breaks, warnings, and badges       |
| **Neutral Surfaces**        | Glassmorphic translucent cards (`rgba(255, 255, 255, 0.06)`) | Cards with subtle 1px border outlines  |

### 1.2. Padel-Specific Visual Elements

* **Court Background:** Dedicated Padel court artwork, such as `fundos/tennis.jpg`, featuring court glass and mesh textures.

* **Pair Identity:** Paired athlete crests and double-racket icon badges.

* **Live Match Indicators:** Pulsating indicators for active matches.

* * *

2. Screen-by-Screen UI Architecture

-----------------------------------

### A. Tournament Setup Wizard (Organizer UI)

When an organizer creates a Padel tournament, the interface presents a streamlined, multi-step configuration process.

#### Step 1: Modality & Competitor Selection

* The sport selector defaults to **Padel → Duplas (Pairs)**.

* Competitor terminology throughout the application dynamically changes from _Time / Equipe_ to **Dupla**.

#### Step 2: Category Configuration (`with_categories`)

* Organizers can enable multi-division tournaments through a single toggle.

* Common category presets include:
  
  * 1ª Categoria (Open / Pro)
  
  * 2ª Categoria
  
  * 3ª Categoria
  
  * 4ª Categoria
  
  * 5ª Categoria (Beginners)
  
  * Duplas Femininas
  
  * Duplas Mistas

#### Step 3: Padel Scoring Rules

Organizers configure the match format and scoring rules.

**Match Format (**`**tipo**`**)**

* **1 Set (Pro-Set):** A single set played to 6, 8, or 9 games, commonly used in qualification pools.

* **Melhor de 3 Sets:** Traditional best-of-three-set match.

* **2 Sets + Super Tie-Break:** If the match reaches one set each, a 10-point Super Tie-Break replaces the third set.

**Golden Point (**_**Ponto de Ouro / No-Ad**_**)**

* A toggle disables traditional advantage scoring at 40–40.

* The next point determines the game.

* * *

### B. Category Navigation Bar (Top-Level UX)

Padel tournaments commonly accommodate multiple categories. The main tournament screen can therefore use a persistent **horizontal pill/chip carousel**.

#### Example Layout

    [ 🏆 Todas ] [ Duplas Masc A ] [ Duplas Masc B ][ Duplas Mistas ] [ Duplas Fem Open ]

#### Interaction Behavior

* Selecting a category filters the **Matches, Brackets, and Standings** views without reloading the page.

* Each category pill displays its registered-pair count, such as `Masc B (16 duplas)`.

* The `Todas` option displays matches and standings across all categories.

* * *

### C. Padel Match Card & Scorecard Widget (`A.b_q` & `A.b_p`)

Each Padel match in the match feed or category schedule is presented as a multi-column scorecard.

#### Example Scorecard

    ┌──────────────────────────────────────────────────────────────┐│ QUADRA 2 · 19:30 · EM ANDAMENTO 🟢             DUPLAS MASC B │├───────────────────────────────────┬───┬───┬───┬──────────────┤│ DUPLA                             │ 1 │ 2 │ 3 │ FINAL        │├───────────────────────────────────┼───┼───┼───┼──────────────┤│ 🟢 Lucas Mendes / Thiago Silva    │ 6 │ 4 │ 7⁵│ 2 (WIN)      ││ 🟡 Carlos Ramos / Felipe Costa    │ 4 │ 6 │ 6⁴│ 1            │└───────────────────────────────────┴───┴───┴───┴──────────────┘

#### Widget Characteristics

**1. Duo Header (Column 0)**

* Displays paired player initials, such as `LM / TS`.

* Displays a seeding badge when applicable, such as `[#1]`.

**2. Set Columns (Columns 1, 2, and 3)**

* Alternating subtle cell backgrounds, controlled by the column index through `(col & 1) === 0`.

* Bold, larger typography (`fontSize: 16px`) for set scores.

**3. Tie-Break Superscript (**`**A.dz**`**)**

* When a set ends in a tie-break, the tie-break loser's score is displayed in superscript with an offset of `(2, 0)`.

* Example: `7⁵` represents a 7–6 set with a 7–5 tie-break score.

**4. Winner Styling**

* The winning pair's text uses high-contrast white.

* A subtle green border highlights the winning card.

* * *

### D. Score Entry & Referee Live Dialog (`bJP`)

When an organizer or designated court referee selects a match to enter results, the interface provides the following controls.

#### 1. Set Steppers

* Dedicated numerical steppers for Set 1, Set 2, and Set 3.

* Interactive `+` and `−` buttons optimized for one-thumb entry on mobile devices.

#### 2. Tie-Break Popover

* When the game score reaches 6–6, an auxiliary tie-break score field opens automatically.

* The associated fields are `qt_g_t1` and `qt_g_t2`.

#### 3. Built-In Validation & Error Toast (`invalid_set_score`)

The scoring engine validates score legality before committing results to Firebase.

Examples of invalid scores include:

* Incomplete sets, such as `6–5` or `4–3`, when submitted as completed sets.

* Invalid game margins or combinations that do not satisfy the configured set rules.

If an invalid score is submitted, an animated red toast displays:

> Placar de set inválido / Invalid set score

#### 4. Instant Cloud Synchronization

* Saving publishes updates to Firebase Realtime Database.

* Completed results trigger updates to the tournament bracket, advancing the winning pair to the next bracket node when applicable.

* * *

### E. Interactive Knockout Brackets (_Chaves / Mata-Mata_)

In the `Chave` / `Bracket` tab, Padel draws are presented as a horizontally progressing bracket.

#### 1. Horizontal Stage Progression

Typical stages include:

1. Round of 16 (_Oitavas_)

2. Quarterfinals (_Quartas_)

3. Semifinals (_Semifinais_)

4. Final

#### 2. Bracket Match Nodes

Each match node displays:

* Both competing pairs.

* Seed tags, when applicable.

* Compact set scores, such as `6/3 6/4`.

#### 3. Connecting Bracket Lines

* Vector Bézier or orthogonal lines connect Match A and Match B to Match C.

* Once a match is completed, the winning path line turns bright green.

#### 4. BYE Handling (_Folgas_)

* Non-power-of-two draws require byes or preliminary matches.

* Example: A 12-pair draw can use a 16-slot bracket.

* Empty slots may display a ghosted card labeled `FOLGA (BYE)`.

* Byes can be assigned to higher-seeded pairs according to the draw rules.

* * *

### F. Standings Table (_Classificação / Grupos_)

For tournaments with group stages, the standings interface displays Padel-specific competitor and performance metrics.

#### Example Standings

| POS    | DUPLA                   | J   | V   | D   | SG  | GG  | PTS |
| ------ | ----------------------- | --- | --- | --- | --- | --- | --- |
| **1º** | 🟢 **Mendes / Silva**   | 3   | 3   | 0   | +5  | +18 | 9   |
| **2º** | 🟡 **Ramos / Costa**    | 3   | 2   | 1   | +2  | +7  | 6   |
| **3º** | ⚪ **Oliveira / Santos** | 3   | 1   | 2   | -1  | -6  | 3   |
| **4º** | ⚪ **Pereira / Alves**   | 3   | 0   | 3   | -6  | -19 | 0   |

#### Standings Behavior

* **POS Tag:** The top two positions can be highlighted with green qualification accents to indicate advancement to the knockout stage.

* **SG (**_**Saldo de Sets**_**):** Sets won minus sets lost.

* **GG (**_**Saldo de Games**_**):** Games won minus games conceded.

* **Confronto Direto:** Selecting a tied row highlights the relevant head-to-head match outcomes.

_Note: The exact qualification indicators and tie-breaking sequence depend on the tournament configuration._

* * *

### G. Court & Order-of-Play Scheduler (_Locais e Quadras_)

The scheduling interface supports clubs operating multiple Padel courts.

#### 1. Court Navigation

Court tabs can include:

* Quadra Central

* Quadra 1 (Vidro)

* Quadra 2

* Additional configured courts

#### 2. Time Slots

Chronological schedule cards display:

* Match start time.

* Estimated duration, such as 60–90 minutes.

* Warm-up countdowns, when supported.

#### 3. Live Match Banner

A pulsating red or green `AO VIVO` badge identifies the court currently hosting an active match.

* * *

### H. Automated Social Media Story & Post Generator

Organizers can select the **Share (**_**Compartilhar**_**)** icon on a completed Padel match to generate branded social media graphics.

#### Supported Formats

* **Instagram Stories / WhatsApp Status:** 9:16 vertical aspect ratio.

* **Instagram Feed:** 1:1 square aspect ratio.

#### Rendered Elements

* Tournament title and category badge, such as `Torneio Open Padel — Categoria 3ª Mista`.

* Full names and crests of both pairs.

* Prominent set-by-set score summary, such as `6/4 · 3/6 · [10-8]`.

* Partner and sponsor logos embedded in the bottom banner.

#### Export & Sharing

* Download the generated graphic as a PNG.

* Share directly through WhatsApp, where supported.

* * *

3. Key UX Design Patterns

-------------------------

| Design Pattern                    | Purpose                                         | Expected Benefit                                    |
| --------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| **Category Pills**                | Switch between competition divisions            | Faster navigation across multi-category tournaments |
| **Pair-Centric Scorecards**       | Display two-player teams and set-by-set results | Clearer match monitoring                            |
| **Touch-Friendly Score Steppers** | Enter scores at court side                      | Faster referee workflows                            |
| **Inline Score Validation**       | Reject invalid completed-set scores             | Better data integrity                               |
| **Live Status Indicators**        | Identify active matches and courts              | Easier tournament-day coordination                  |
| **Interactive Brackets**          | Visualize progression through knockout rounds   | Clearer competition tracking                        |
| **Automated Social Graphics**     | Share match results and sponsor branding        | Better engagement and sponsor visibility            |

* * *

4. Key Takeaways

----------------

* **Padel-Specific Identity:** Padel uses the doubles competitor model and specialized racquet-sport scoring structures.

* **Multi-Category Navigation:** Organizers can manage multiple divisions within a tournament, with category-based filtering.

* **Set-Based Match Display:** Scorecards display individual set results, tie-breaks, and match outcomes.

* **Integrated Tournament Operations:** Score entry, bracket progression, standings, and court scheduling support match-day administration.

* **Social Sharing:** Branded graphics help organizers publish results and promote sponsors.

* * *

_Technical note: This document organizes the supplied findings from the decompiled runtime and schema analysis. The UI component names, color tokens, interaction behaviors, Firebase synchronization details, and other implementation claims have not been independently verified against a live Copa Fácil environment._



Deep Dive: Copa Fácil Padel Mode — Configurable Settings, Parameters & Variables
================================================================================

In **Copa Fácil**, the **Padel mode** (`sport_cod: 17`, entity mode `duplas` / `sport_2: 1`) provides a comprehensive set of configuration options. These span championship and category organization, bracket generation, set-by-set scoring and tie-break thresholds, and standings reordering criteria.

This document organizes the supplied findings into a structured technical reference covering the settings and variables an organizer or user may configure.

* * *

1. Championship & Entity-Level Settings (`/events/{id}`)

--------------------------------------------------------

| Variable / Firebase Key            | UI Field Label          | Type / Format   | Permitted Values & Description                                                                                     |
| ---------------------------------- | ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `title` (`z`)                      | **Tournament Name**     | String (UTF-8)  | Primary tournament title, e.g., _1º Open de Padel 2026_.                                                           |
| `sub_title` (`id`)                 | **Subtitle / Club**     | String          | Secondary description or venue name, e.g., _Clube de Padel Central_.                                               |
| `sport_cod` (`c`)                  | **Sport Code**          | Integer         | `17` for Padel; associated with racquet-sport engine components `A.a2U` and `A.Rd`.                                |
| `sport_2` (`d`)                    | **Entity Type**         | Integer / Enum  | `1` = Pairs / Duplas (`B.aM`); `0` = Singles / Individual (`B.a1`).                                                |
| `with_categories` (`m_evt` / `p2`) | **Multi-Category Mode** | Boolean         | `true` enables multiple divisions, e.g., 1ª–5ª Categoria, Mixed, +40. `false` enables a single division.           |
| `is_public` (`public` / `au`)      | **Visibility**          | Boolean         | `true` = publicly listed; `false` = unlisted or private-link access, depending on permissions.                     |
| `status_cod` (`st` / `cB`)         | **Tournament Status**   | Integer         | `0` = Draft / Registration; `1` = In Progress; `2` = Completed; `3` = Archived, according to the supplied mapping. |
| `start_date` (`d_i` / `Q`)         | **Start Date**          | ISO date/string | First day of tournament matches.                                                                                   |
| `end_date` (`d_f` / `as`)          | **End Date**            | ISO date/string | Final day of the championship.                                                                                     |
| `url_logo` (`k2`)                  | **Tournament Logo**     | URL             | Tournament emblem; reported to be rewritten to CDN `copafacil-storage.b-cdn.net`.                                  |
| `url_cover` (`k3`)                 | **Cover Banner**        | URL             | Header banner displayed across the web portal and mobile app.                                                      |
| `permissions`                      | **Admin Permissions**   | Array of UIDs   | Multi-admin permissions for court marshals, scorekeepers, and referees.                                            |

* * *

2. Category / Division Variables (`with_categories: true`)

----------------------------------------------------------

When multi-category mode is enabled, each division operates as a separate competition container.

| Variable / Key             | UI Field                 | Description                                                                                                                |
| -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `category_name` / `title`  | Category Name            | Division label, e.g., _1ª Categoria Masculina_, _Open Feminina_, _Mistas C_, or _Iniciantes_.                              |
| `sub_title`                | Category Subtitle        | Additional level or group description, e.g., _Nível Avançado — Duplas A_.                                                  |
| `max_teams` / `max_duplas` | Maximum Registered Pairs | Maximum number of pairs, e.g., 16, 24, or 32. When capacity is reached, additional registrations may enter a waiting list. |
| `taxa_inscricao`           | Registration Fee         | Entry fee, potentially charged per pair or per player, with payment links.                                                 |
| `fs`                       | Independent Phases       | Each category maintains its own group stages, brackets, and standings.                                                     |

* * *

3. Match Scoring & Set Configuration (`/matchs/{id}/dt/`)

---------------------------------------------------------

Copa Fácil's racquet-sport scoring model uses dedicated set and tie-break parameters.

### 3.1. Set Format (`tipo` / `k2`)

| Value | Format             | Description                                                                                       |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `1`   | **Single Pro-Set** | One extended set, typically played to 6, 8, or 9 games.                                           |
| `3`   | **Best of 3 Sets** | Two standard sets, with a third set or Super Tie-Break if the match is tied 1–1. Common in Padel. |
| `5`   | **Best of 5 Sets** | Championship format requiring three sets to win.                                                  |
| `7`   | **Best of 7 Sets** | Extended multi-set format.                                                                        |

### 3.2. Score Tracking Variables

| Variable     | Type        | Description                                                       |
| ------------ | ----------- | ----------------------------------------------------------------- |
| `qt_g1`      | `List<int>` | Games won per set by Pair 1, e.g., `[6, 4, 10]`.                  |
| `qt_g2`      | `List<int>` | Games won per set by Pair 2, e.g., `[4, 6, 8]`.                   |
| `qt_g_t1`    | `List<int>` | Tie-break points per set for Pair 1.                              |
| `qt_g_t2`    | `List<int>` | Tie-break points per set for Pair 2.                              |
| `tail_break` | Integer     | Reported tie-break target, with configurable values listed below. |

### 3.3. Tie-Break Points Threshold (`tail_break`)

Reported configurable values:

`5`, `7`, `9`, `11`, `12`, `15`, `18`, `21`

* **Standard Tie-Break:** Typically 7 points.

* **Super Tie-Break:** Typically 10 points.

_Implementation note: The supplied list does not include_ `_10_`_, despite identifying 10 points as the usual Super Tie-Break target. The actual configuration and storage behavior should be verified._

### 3.4. Game Advantage Mode

* **Standard Advantage:** Traditional deuce/advantage scoring; a set generally requires a two-game margin unless a tie-break or other configured rule applies.

* **Golden Point / No-Ad (**`**Ponto de Ouro**`**):** At 40–40, the next point decides the game.

### 3.5. Match Status

| Value | Status                | Portuguese Label |
| ----- | --------------------- | ---------------- |
| `0`   | Scheduled             | `Agendada`       |
| `1`   | In Progress           | `Em Andamento`   |
| `2`   | Finished              | `Finalizada`     |
| `3`   | Walkover              | `W.O.`           |
| `4`   | Postponed / Suspended | `Adiada`         |

* * *

4. Tournament Stage & Bracket Variables (`/stages/`)

----------------------------------------------------

### 4.1. Group Stage (Fase de Grupos / Round Robin)

| Variable          | UI Configuration            | Options / Description                                                                                                   |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `groups_qtd`      | Number of Groups            | `1` = Single league table (`no_groups`); `2`, `3`, `4`, `8`, `16`, etc. = Multiple groups, such as Grupo A and Grupo B. |
| `generate_matchs` | Leg System                  | `one_way` = Single round-robin; `round_trip` = Double round-robin (_Ida e volta_).                                      |
| `teams`           | Pair Seeding & Distribution | `randomly` = Randomized draw; `manual` / seeded = Manually distribute seeded pairs among groups.                        |

### 4.2. Knockout Stage (Mata-Mata / Brackets)

| Variable         | UI Configuration             | Options / Description                                                                                                           |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `knockout`       | Leg System                   | `one_way` = Single-elimination match; `round_trip` = Two-leg tie.                                                               |
| `teams`          | Advancement & Crossing Rules | `divide_group` = Group crossover; `classificacao_geral` = Overall-ranking seeding; `randomly` = Random draw of qualified pairs. |
| `teams_#`        | Bracket Size                 | Standard bracket sizes: `4`, `8`, `16`, `32`, `64`, `128`, or a custom/undefined value.                                         |
| `terceiro_lugar` | Third-Place Match            | Toggle to generate a playoff between semifinal losers.                                                                          |
| `consolacao`     | Consolation / Repescagem     | Secondary bracket for pairs eliminated in the first round.                                                                      |

#### Advancement and Crossing Examples

* `**divide_group**`**:** 1st Group A vs. 2nd Group B, and 1st Group B vs. 2nd Group A.

* `**classificacao_geral**`**:** Overall-ranking seeding, such as 1st vs. 16th and 2nd vs. 15th.

* `**randomly**`**:** Qualified pairs are assigned through a random draw.

_Note: The exact bracket-generation behavior, including byes and qualification rules, depends on the implemented draw logic and configuration._

* * *

5. Standings Point System (`k5` / `amK`)

----------------------------------------

During group stages, the standings system can award points according to organizer-defined preferences.

| Variable | Translation Key  | Reported Default | Reported Options                                                                                   |
| -------- | ---------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `v`      | `pontos_vitoria` | **2 points**     | `1`, `2`, `3`, or `4` points per match won.                                                        |
| `l`      | `pontos_derrota` | **0 points**     | `0`, `1`, or `2` points per match lost. One point may be used as a participation award.            |
| `d`      | `pontos_empate`  | **0 points**     | `0`; draws are generally not applicable to racquet-sport matches, although the field is supported. |

* * *

6. Standings Tie-Breaker Criteria (`criterion17_*.json`)

--------------------------------------------------------

Copa Fácil reportedly allows tournament directors to reorder standings criteria using drag-and-drop controls.

For Padel (`sport_cod: 17`), the supplied criteria and default priority order are:
    {  "10": {    "cod": "0",    "title": "Points"  },  "20": {    "cod": "2",    "title": "Victory"  },  "30": {    "cod": "7",    "title": "Sets Difference"  },  "40": {    "cod": "8",    "title": "Games Difference"  },  "50": {    "cod": "5",    "title": "Sets Won"  },  "55": {    "cod": "10",    "title": "Games Won"  },  "60": {    "cod": "50",    "title": "Head to Head (Confronto Direto)"  },  "70": {    "cod": "11",    "order": false,    "title": "W.O."  },  "80": {    "cod": "16",    "title": "Sortition (Sorteio)"  }}

### 6.1. Criteria Descriptions

| Priority Key | Criterion        | Purpose                                                                        |
| ------------ | ---------------- | ------------------------------------------------------------------------------ |
| `10`         | Points           | Total standings points.                                                        |
| `20`         | Victory          | Match victories.                                                               |
| `30`         | Sets Difference  | Sets won minus sets lost.                                                      |
| `40`         | Games Difference | Games won minus games conceded.                                                |
| `50`         | Sets Won         | Total sets won.                                                                |
| `55`         | Games Won        | Total games won.                                                               |
| `60`         | Head to Head     | Direct match result between tied pairs.                                        |
| `70`         | W.O.             | Walkover-related criterion; `order: false` is retained from the supplied data. |
| `80`         | Sortition        | Random draw to resolve a remaining tie.                                        |

### 6.2. Recalculating Standings

The supplied findings indicate that updating the criteria order triggers the following request:
    POST https://copafacil.com/api2/resortContent-Type: application/json

Request body:
    {  "events": ["eventId"]}

This reportedly recalculates rankings across the tournament's groups.

_Technical note: The endpoint, request payload, and recalculation behavior should be validated against the actual application before implementation._

* * *

7. Court & Scheduling Variables

-------------------------------

Each scheduled match can have the following configuration fields.

| Variable / Key        | UI Field          | Description                                                                          |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `quadra` / `court`    | Court Assignment  | Named court identifier, e.g., _Quadra 1 — Coberta_, _Quadra 2_, or _Quadra Central_. |
| `data_hora`           | Match Date & Time | Specific match start timestamp.                                                      |
| `m_set` / `rodada`    | Round Label       | Custom round name, e.g., _Rodada 1_, _Quartas de Final_, or _Final_.                 |
| `dupla_1` / `dupla_2` | Competing Pairs   | Identifies the two pairs competing in the match.                                     |

### 7.1. Pair Roster Information

Each pair may be associated with the following player information:

* **Player 1:** Name, jersey/identifier, contact information, and photo.

* **Player 2:** Name, jersey/identifier, contact information, and photo.

* **Seed Designation:** Assigned seed number, e.g., _Cabeça de Chave #1_.

* * *

8. Consolidated Configuration Reference

---------------------------------------

The following table summarizes the principal configuration areas covered in this document.

| Configuration Area       | Key Variables                                                      | Primary Purpose                                                        |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Championship             | `title`, `sub_title`, `sport_cod`, `sport_2`, `status_cod`         | Define tournament identity, sport, entity type, and status.            |
| Visibility & Permissions | `is_public`, `permissions`                                         | Control public visibility and administrative access.                   |
| Categories               | `with_categories`, `category_name`, `max_duplas`, `taxa_inscricao` | Organize divisions, capacity, and registration fees.                   |
| Match Scoring            | `tipo`, `qt_g1`, `qt_g2`, `qt_g_t1`, `qt_g_t2`, `tail_break`       | Configure set formats, scores, and tie-breaks.                         |
| Match Status             | Match status code                                                  | Track scheduled, active, completed, walkover, or postponed matches.    |
| Group Stages             | `groups_qtd`, `generate_matchs`, `teams`                           | Configure groups, round-robin legs, and pair distribution.             |
| Knockout Stages          | `knockout`, `teams`, `teams_#`, `terceiro_lugar`, `consolacao`     | Configure elimination formats, bracket sizes, and consolation matches. |
| Standings Points         | `v`, `l`, `d`                                                      | Define points awarded for wins, losses, and draws.                     |
| Tie-Break Criteria       | `criterion17_*.json`                                               | Configure the ranking priority for tied pairs.                         |
| Scheduling               | `quadra`, `data_hora`, `m_set`, `dupla_1`, `dupla_2`               | Assign courts, dates, rounds, and competing pairs.                     |

* * *

9. Validation Notes & Implementation Considerations

---------------------------------------------------

Before using these findings as a specification for another tournament platform, the following details should be verified against the original application or backend:

1. **Field mappings:** Confirm that abbreviated keys and descriptive variable names map to the same stored fields.

2. **Status codes:** Verify the complete status enumeration and whether the supplied mappings are exhaustive.

3. **Scoring configuration:** Confirm the relationship between `tipo`, set targets, tie-break targets, and Super Tie-Break handling.

4. **Bracket generation:** Validate the accepted values for group distribution, knockout seeding, byes, and consolation brackets.

5. **Standings logic:** Confirm the default ordering, supported criteria, and handling of walkovers and head-to-head ties.

6. **API behavior:** Verify the endpoint and request format for recalculating standings before integrating with any external implementation.

_Source note: This document is a structured presentation of the supplied decompilation and schema findings. The reported field names, permitted values, defaults, endpoint behavior, and UI mappings have not been independently verified._



Version:1.0StartHTML:0000000105EndHTML:0000058263StartFragment:0000039547EndFragment:0000058223<style></style>

In **Copa Fácil**, adding stages to an existing tournament(such as moving from a **Group Stage** to **Quarterfinals / Semifinals**,adding a **Repescagem / Consolation Bracket**, or creating a **Multi-phaseChampionship**) is a core workflow.

Below is the complete reverse-engineered architecture, UIflow, and data model for how stages are created, configured, and linked toexisting tournament data.

---

### 1. Where and How to Access "New Stage"

1. In the tournament management dashboard, navigate to the**Stages & Matches** tab (`Fases & Partidas`).

2. At the top of the screen or in the stage dropdown/tabbar, click the **"Nova Fase" / "New Stage"** action button(`new_stage` in `A.c6N`).

3. If the tournament has **Categories enabled**(`with_categories: true`), you first select which category/division the stagebelongs to (e.g., *1ª Categoria*, *Mistas B*), because stages are scopedindependently per category.

---

### 2. Step 1: Selecting the Stage Format Modal (`A.c6K`)

When tapping **"Nova Fase"**, Copa Fácil promptsthe user to select one of two fundamental stage structures:

```

+-------------------------------------------------------+

|                      Nova Fase                        |

+-------------------------------------------------------+

|  [ ( ) PontosCorridos / Grupos (round_robin) ]       |

|      - League table,single or multi-group round robin|

|                                                       |

|  [ ( ) Mata-Mata /Chaveamento (knockout)     ]       |

|      - Singleelimination, brackets, finals           |

+-------------------------------------------------------+

```

* **Round Robin (`round_robin` / `CW = true`)**: Creates atable-based phase where pairs accumulate match points, games, and setdifference.

* **Knockout (`knockout` / `CW = false`)**: Creates asingle-elimination or double-elimination tournament bracket.

Once chosen, Copa Fácil generates a new internal stageidentifier:

$$\text{Path: }\texttt{/events/\{eventId\}/fs/\{stageId\}}$$

with default title `"Fase #"`, automaticallynumbered (e.g., *Fase 2*, *Fase 3*).

---

### 3. Step 2: The Stage Configuration Drawer (`A.c6A` &`A.c6z`)

Immediately upon creation, the **Stage Settings** modalopens with the following configurable controls:

#### A. Stage Title (`title`)

* Custom name for the stage (e.g., *"Fase deGrupos"*, *"Quartas de Final"*, *"Chave Principal"*,*"Torneio Consolação / Repescagem"*).

#### B. Standings Highlights & Qualification Zones(`highlight_table` / `A.c6i`)

*(Only applicable if Round Robin / Grupos is selected)*

* **Classificados (`highlight_first`)**: The number of toppairs from each group that advance to the next phase (e.g., Top 2). Highlightedin **green**.

* **Rebaixados / Eliminados (`highlight_last`)**: The numberof bottom pairs eliminated. Highlighted in **red/orange**.

* **Zone Color Pickers (`w`, `x`, `y`, `z`)**: Custom colorindicators for promotion/relegation zones.

#### C. Standings Column Toggle (`classificacao` / `A.c6r`)

*(Only applicable if Knockout is selected)*

* Determines whether an overall ranking table should berendered alongside the bracket diagram.

#### D. Carry Over & Link From Previous Stage(`copy_table` / `A.c6u`)

* Allows this new stage to inherit pairs, seeding, or groupstandings from an earlier stage in the tournament.

* Connects the output of **Stage 1** (e.g., Group Stage)directly into **Stage 2** (e.g., Knockout Bracket).

#### E. Select Participating Pairs (`select_teams` / `A.c6t`& `A.c66`)

* Checkbox list of all registered pairs in the tournament.

* Sets:

  $$\texttt{/events/\{eventId\}/teams/\{teamId\}/dt/\{stageId\}/SH = true/ false}$$

* Allows the organizer to manually select exactly whichpairs qualify or participate in this new phase.

---

### 4. Step 3: Generating Matches & Brackets for the NewStage

Once the stage container is configured, you generate thefixtures using the automated generator:

#### If the Stage is **Knockout (Mata-Mata)** (`wizard O2`):

The generator prompts for 4 key options:

1. **Leg Format (`knockout`)**:

   * `one_way`: Singlematch (standard in Padel).

   * `round_trip`:Home and away / 2-leg tie.

2. **Pair Seeding & Matchup Strategy (`teams`)**:

   * `divide_group`(*Cruzar Grupos*): Automatically pairs group winners against runners-up fromother groups (e.g., **1º Grupo A vs 2º Grupo B**, **1º Grupo B vs 2º GrupoA**).

   *`classificacao_geral` (*Overall Seeding*): Pairs top seeds against bottom seeds(1st vs 16th, 2nd vs 15th, etc.).

   * `randomly`(*Sorteio Aleatório*): Shuffles all qualified pairs randomly into the bracket.

3. **Bracket Population**:

   * `select_teams`:Immediately fill the bracket with the known qualified pairs.

   *`generate_no_teams` (*A Definir / TBD*): Generates the bracket structure withempty placeholder slots (e.g., `1º do Grupo A`, `2º do Grupo B`), allowing thebracket to be published **before** the group stage matches are finished. Asgroup matches conclude, winners automatically flow into these slots.

4. **Bracket Size (`teams_#`)**:

   * Choose bracketdepth: **4** (Semifinais), **8** (Quartas), **16** (Oitavas), **32**, **64**,**128**, or **Custom/Undefined**.

#### If the Stage is **Round Robin (Grupos)** (`wizard b2D`/ `de7`):

1. **Number of Groups (`groups_qtd`)**:

   * `no_groups` (1single group / all-play-all league table).

   * `2, 3, 4, 8, ...`groups (automatically divided into Group A, B, C, D...).

2. **Round Robin Format**:

   * `one_way`: Turnoúnico (each pair plays each opponent once).

   * `round_trip`:Turno e Returno (two games against each opponent).

3. **Pair Assignment**:

   * Automatedbalanced distribution or seeded pots.

---

### 5. Common Multi-Stage Architectures in Padel

| Architecture | Stage 1 | Stage 2 | Stage 3 (Optional) |

| :--- | :--- | :--- | :--- |

| **Standard Padel Open** | **Grupos** (Round robin ingroups of 3 or 4 pairs) | **Mata-Mata Principal** (Quartas/Semis crossing top 2from each group) | **Disputa de 3º Lugar** |

| **Consolation / Repescagem** | **Chave Principal** (Allpairs start in single elimination) | **Repescagem** (Knockout stage seeded with1st-round losers) | — |

| **Two-Tier Division** | **Fase Preliminar** (Round robin)| **Série Ouro** (Top 2 advance to Gold bracket) | **Série Prata** (3rd/4thadvance to Silver bracket) |

---

### 6. Summary of Underlying Firebase RTDB Structure

When you add a stage, Copa Fácil creates and maintains:

```json

/events/{eventId}/

  ├── fs/

  │   ├── {stageId_1}/             <-- e.g."Fase de Grupos"

  │   │   ├── b: "Fase de Grupos"

  │   │   ├── CW: true             (Round Robin)

  │   │   ├── highlight_first: 2

  │   │   └── is_processing: false

  │   └── {stageId_2}/             <-- e.g. "Mata-MataPrincipal"

  │       ├── b:"Quartas de Final"

  │       ├── CW:false            (Knockout)

  │       ├── from_stage: "{stageId_1}"  (Inherited source)

  │       └── is_processing: false

  ├── matchs/

  │   └── {matchId}/

  │       ├── fs:"{stageId_2}"    <-- Matchestagged by Stage ID

  │       ├── team1:"{pair1Id}"

  │       ├── team2:"{pair2Id}"

  │       └── dt/ ...              (Scores, sets, tie-breaks)

  └── teams/

      └── {pairId}/

          └── dt/

              └──{stageId_2}/

                  └──SH: true     <-- Pair active in thisstage

```

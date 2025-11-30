# Firebase Auth App

## Overview
A padel community app built with Next.js 16, Firebase Authentication, and Tailwind CSS. Features user authentication, events browsing, clubs directory, community features, and media library.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Authentication**: Firebase Auth (Google, Apple, Email/Password)
- **Database**: Firebase Firestore
- **UI Components**: Radix UI, Lucide Icons, React Hook Form

## Project Structure
```
src/
├── app/                    # Next.js App Router pages
│   ├── api/list-users/    # Admin API endpoint
│   ├── auth/signin/       # Sign-in page
│   ├── clubs/             # Clubs directory
│   ├── community/         # Community features
│   ├── dashboard/         # Main dashboard
│   ├── events/            # Events list and details
│   ├── media/             # Media library
│   └── player/            # Player profile
├── components/            # React components
│   ├── ui/                # Base UI components
│   ├── ClubCard.tsx       # Club card component
│   ├── EventCard.tsx      # Event card component
│   └── PlayerCard.tsx     # Player card component
├── context/               # React contexts
│   ├── AuthContext.tsx    # Authentication context
│   └── ToastContext.tsx   # Toast notifications
└── lib/                   # Utilities
    ├── firebase.ts        # Firebase client SDK
    ├── firebase-admin.ts  # Firebase Admin SDK
    └── utils.ts           # Helper functions
```

## Environment Variables
The following environment variables are required:

### Firebase Client SDK (Public)
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`

### Firebase Admin SDK (Server)
- `FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH` - Path to service account JSON file

### Security
- `ADMIN_API_KEY` - API key for protected endpoints

## Running the App
- **Development**: `npm run dev` (runs on port 5000)
- **Build**: `npm run build`
- **Production**: `npm run start`

## Key Features
1. **Authentication**: Email/password, Google, and Apple sign-in
2. **Dashboard**: Central hub with navigation to all features
3. **Events**: Browse and view padel events
4. **Clubs**: Directory of partner clubs
5. **Community**: Connect with other players
6. **Media**: Photo and video library
7. **Profile**: Player profile management

## API Endpoints
- `GET /api/list-users` - List all users (requires `Authorization: Bearer <ADMIN_API_KEY>`)

## Recent Changes
- Imported from GitHub `basic_pages` branch
- Configured for Replit environment (port 5000, allowed dev origins)
- Added deployment configuration

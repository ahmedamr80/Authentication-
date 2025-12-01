# Padel Community Platform

## Overview
A production-grade padel community platform built with Next.js 16, Firebase, and Tailwind CSS. Features comprehensive authentication, event management, community features, club directory, and user profiles.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4
- **Authentication**: Firebase Auth (Google, Apple, Email/Password)
- **Database**: Firebase Firestore
- **Storage**: Firebase Storage
- **UI Components**: Radix UI, Lucide Icons, React Hook Form, Zod
- **Admin SDK**: Firebase Admin SDK

## Project Structure
```
src/
├── app/                      # Next.js App Router pages
│   ├── api/list-users/      # Admin API endpoint
│   ├── auth/signin/         # Authentication page
│   ├── clubs/               # Clubs directory
│   ├── community/           # Community features
│   ├── dashboard/           # Main dashboard
│   ├── events/              # Events management
│   │   ├── create/          # Event creation
│   │   └── [eventId]/       # Event details
│   ├── media/               # Media library
│   ├── player/              # Player profile
│   ├── layout.tsx           # Root layout
│   └── globals.css          # Global styles
│
├── components/              # React components
│   ├── ui/                  # Base UI components
│   ├── ClubCard.tsx
│   ├── EventCard.tsx
│   ├── EventFilters.tsx
│   ├── EventSection.tsx
│   └── PlayerCard.tsx
│
├── context/                 # React contexts
│   ├── AuthContext.tsx
│   └── ToastContext.tsx
│
├── lib/                     # Utilities
│   ├── firebase.ts
│   ├── firebase-admin.ts
│   └── utils.ts
│
├── docs/                    # Comprehensive documentation
│   ├── INSTALLATION.md      # Setup guide
│   ├── ARCHITECTURE.md      # Technical design
│   ├── API.md               # API documentation
│   ├── CONTRIBUTING.md      # Contributing guidelines
│   ├── SECURITY.md          # Security practices
│   ├── DEPLOYMENT.md        # Production deployment
│   └── CHANGELOG.md         # Release history
│
└── scripts/                 # Utility scripts
    └── test-api.sh          # API testing
```

## Core Features
1. **🔐 Authentication**: Multi-provider (Email/Password, Google, Apple)
2. **📅 Events**: Browse, filter, search, and create events
3. **👥 Community**: Discover players and connect
4. **🏢 Clubs**: Partner club directory
5. **👤 Profiles**: Player profiles with stats
6. **📸 Media**: Photo and video library
7. **🔒 Security**: Server-side validation, protected APIs

## Environment Variables
See `.env.example` for template. Required variables:

### Firebase Client SDK (Public)
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`

### Firebase Admin SDK (Server)
- `FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH`

### Security
- `ADMIN_API_KEY`

## Running the App
```bash
npm run dev      # Development (port 5000)
npm run build    # Production build
npm start        # Run production build
npm run lint     # Linting
```

## Documentation
Complete documentation available in `docs/`:

| Document | Purpose |
|----------|---------|
| [INSTALLATION.md](./docs/INSTALLATION.md) | Setup and configuration |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Technical architecture |
| [API.md](./docs/API.md) | API endpoint reference |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Development guidelines |
| [SECURITY.md](./docs/SECURITY.md) | Security best practices |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Production deployment |
| [CHANGELOG.md](./docs/CHANGELOG.md) | Version history |

## API Endpoints
- `GET /api/list-users` - List users (requires `Authorization: Bearer <ADMIN_API_KEY>`)

## Key Security Features
- Input validation with Zod schemas
- Server-side Admin SDK usage
- Protected API endpoints with Bearer token auth
- Firestore security rules
- Account linking for shadow accounts
- Secure password requirements (8+ chars, mixed case, number, special char)

## Recent Changes
- Generated comprehensive production documentation
- Created detailed setup and security guides
- Added deployment procedures
- Implemented API documentation
- Added contributing guidelines
- Full architecture documentation
- Changelog tracking

## Development Standards
- **TypeScript**: Strict mode enabled
- **Code Style**: ESLint + Prettier ready
- **Testing**: Manual testing checklist in CONTRIBUTING.md
- **Performance**: Image optimization, code splitting enabled
- **Security**: All best practices documented in SECURITY.md

## Support & Resources
- Check `docs/` for comprehensive guides
- See CONTRIBUTING.md for development workflow
- Review SECURITY.md for security concerns
- Check DEPLOYMENT.md for production setup

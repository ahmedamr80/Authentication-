# Architecture Documentation

## System Architecture Overview

The Padel Community Platform follows a modern, scalable architecture with clear separation of concerns.

```
┌─────────────────────────────────────────┐
│         Client Browser (React)          │
│  - Next.js App Router                   │
│  - TypeScript Components                │
│  - Tailwind CSS Styling                 │
└──────────────┬──────────────────────────┘
               │
               ├─ API Calls (HTTP)
               ├─ Real-time (Firestore listeners)
               └─ Media Uploads (Firebase Storage)
               │
┌──────────────▼──────────────────────────┐
│      Next.js Server (App Router)        │
│  - Server Components                    │
│  - API Routes                           │
│  - Environment Management               │
│  - Firebase Admin SDK                   │
└──────────────┬──────────────────────────┘
               │
               ├─ Firebase Authentication
               ├─ Firebase Firestore
               └─ Firebase Storage
               │
┌──────────────▼──────────────────────────┐
│         Firebase Backend                │
│  - Real-time Database (Firestore)       │
│  - Authentication Service               │
│  - Cloud Storage                        │
│  - Security Rules                       │
└─────────────────────────────────────────┘
```

## Project Structure

### `/src/app` - Next.js App Router

Main application pages and API routes following Next.js 14+ App Router conventions.

```
app/
├── layout.tsx              # Root layout wrapper
├── globals.css             # Global styles
├── page.tsx                # Home page
│
├── api/                    # API Routes
│   └── list-users/
│       └── route.ts        # GET /api/list-users
│
├── auth/                   # Authentication
│   └── signin/
│       └── page.tsx        # Sign-in/Sign-up page
│
├── dashboard/              # Main dashboard
│   └── page.tsx            # /dashboard
│
├── events/                 # Event management
│   ├── page.tsx            # List events
│   ├── create/
│   │   └── page.tsx        # Create event form
│   └── [eventId]/
│       └── page.tsx        # Event details
│
├── clubs/                  # Club directory
│   └── page.tsx            # /clubs
│
├── community/              # Community features
│   └── page.tsx            # /community
│
├── media/                  # Media library
│   └── page.tsx            # /media
│
└── player/                 # Player profile
    └── page.tsx            # /player
```

### `/src/components` - React Components

Reusable UI components organized by category.

```
components/
├── ui/                     # Base UI components (Radix UI)
│   ├── button.tsx
│   ├── card.tsx
│   ├── input.tsx
│   ├── label.tsx
│   ├── select.tsx
│   ├── switch.tsx
│   ├── textarea.tsx
│   └── toast.tsx
│
├── ClubCard.tsx            # Club display component
├── EventCard.tsx           # Event display component
├── EventFilters.tsx        # Event filtering UI
├── EventSection.tsx        # Event section layout
└── PlayerCard.tsx          # Player profile card
```

### `/src/context` - React Context API

Global state management using React Context.

```
context/
├── AuthContext.tsx         # Authentication state
│   - Current user
│   - Sign in/out functions
│   - Auth status
│
└── ToastContext.tsx        # Toast notifications
    - Show/hide toasts
    - Toast queue management
```

### `/src/lib` - Utilities and Helpers

Reusable utilities and configuration.

```
lib/
├── firebase.ts             # Firebase client SDK
│   - Auth initialization
│   - Database references
│   - Storage references
│
├── firebase-admin.ts       # Firebase Admin SDK
│   - Admin authentication
│   - User management
│   - Batch operations
│
└── utils.ts                # Helper functions
    - Date formatting
    - Validation helpers
    - Common utilities
```

## Data Model

### Firestore Collections

#### `/users`

User profile data.

```typescript
interface User {
  uid: string                    // Firebase UID (document ID)
  email: string                  // User email
  fullName: string               // Display name
  photoUrl?: string              // Profile photo URL
  role: "player" | "admin"       // User role
  isShadow: boolean             // Shadow account flag
  registrationStatus: "active" | "inactive"
  createdAt: Timestamp          // Account creation time
  createdBy: string             // Admin who created account
  claimedAt?: Timestamp         // When shadow account was claimed
  previousUid?: string          // Previous UID if account linked
}
```

#### `/events`

Padel event information.

```typescript
interface Event {
  id: string                     // Document ID
  title: string                  // Event name
  description: string            // Event details
  dateTime: Timestamp           // Event start time
  duration: number              // Duration in minutes
  location: string              // Location/address
  courtName: string             // Court name
  maxPlayers: number            // Maximum participants
  currentPlayers: number        // Current participants
  players: string[]             // Array of player UIDs
  createdBy: string             // Creator's UID
  createdAt: Timestamp          // Creation timestamp
  status: "active" | "upcoming" | "past" | "cancelled"
  cancellationMessage?: string  // Reason for cancellation
}
```

#### `/clubs`

Partner club information.

```typescript
interface Club {
  id: string                     // Document ID
  name: string                   // Club name
  description: string            // Club description
  location: string               // Address
  coordinates?: {                // GPS coordinates
    latitude: number
    longitude: number
  }
  courts: number                 // Number of courts
  amenities: string[]            // Available amenities
  contactEmail: string           // Contact information
  phone: string                  // Phone number
  photoUrl: string               // Club photo
}
```

## State Management

### Authentication Context

Manages user authentication state across the app.

```typescript
interface AuthContextType {
  user: User | null              // Current user
  loading: boolean               // Auth loading state
  error: Error | null            // Auth errors
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithApple: () => Promise<void>
}
```

### Toast Context

Handles toast notifications.

```typescript
interface ToastContextType {
  showToast: (message: string, type: "success" | "error" | "info") => void
  hideToast: () => void
  toasts: Toast[]
}
```

## API Routes

### Authentication

Handled by Firebase Auth SDK (client-side).

### List Users - `GET /api/list-users`

Protected endpoint for listing users.

**Headers:**

```
Authorization: Bearer <ADMIN_API_KEY>
```

**Query Parameters:**

- `limit`: number (default: 100, max: 1000)
- `nextPageToken`: string (optional, for pagination)

**Response:**

```typescript
{
  users: Array<{
    uid: string
    email: string
    fullName: string
    providerData: Array<{
      providerId: string
      uid: string
      fullName?: string
      email?: string
    }>
    metadata: {
      creationTime: string
      lastSignInTime: string
    }
  }>
  pageToken?: string
}
```

**Security:**

- Requires valid `ADMIN_API_KEY`
- Returns only non-sensitive user data
- Implements rate limiting (recommended)

## Authentication Flow

### Email/Password Registration

```
1. User submits registration form
   ↓
2. Client validates with Zod schema
   ↓
3. Firebase creates auth account
   ↓
4. Firestore creates user profile
   ↓
5. AuthContext updates
   ↓
6. User redirected to dashboard
```

### Google OAuth Sign-In

```
1. User clicks "Sign in with Google"
   ↓
2. Firebase shows Google login popup
   ↓
3. Google returns user credentials
   ↓
4. Check if Firestore profile exists
   ├─ If not: Create new user profile
   ├─ If shadow account: Migrate shadow to real
   └─ If exists: Update photo if changed
   ↓
5. AuthContext updates
   ↓
6. User redirected to dashboard
```

### Account Linking

When a user creates an account with email, then signs in with Google (same email):

```
1. Google OAuth completes
   ↓
2. Check Firestore for shadow user with email
   ↓
3. If found: Use batch operation
   ├─ Copy shadow user data to new auth user
   ├─ Set isShadow = false
   ├─ Record claimedAt and previousUid
   └─ Delete shadow account
   ↓
4. User profile is now "claimed"
```

## Event Status Calculation

Events have dynamic status based on current time:

```
Event Status Logic:
├─ If cancellationMessage exists → "Cancelled"
├─ If now < eventStart → "Upcoming"
├─ If now >= eventStart AND now < eventEnd → "Active"
└─ If now >= eventEnd → "Past"

Calculation:
eventEnd = eventStart + duration(minutes)
```

## Security Architecture

### Client-Side Security

- **Input Validation**: Zod schemas for all forms
- **Password Requirements**: 8+ chars, uppercase, lowercase, number, special char
- **XSS Prevention**: React's built-in escaping
- **CSRF Protection**: Next.js built-in CSRF handling

### Server-Side Security

- **Firebase Admin SDK**: Verified server-side authentication
- **API Key Protection**: Bearer token validation
- **Firestore Security Rules**: Row-level access control
- **Environment Separation**: Public/private env vars

### Data Protection

- **No Password Storage**: Firebase handles password hashing
- **Firestore Rules**: Strict read/write permissions
- **Storage Rules**: File size and type restrictions
- **Rate Limiting**: Recommended for production (implement via middleware)

## Deployment Architecture

The app is designed for serverless deployment:

```
┌─────────────────────────────┐
│    Edge (CDN/Cache)         │
│  - Static assets            │
│  - Image optimization       │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  Next.js Runtime            │
│  - Vercel/Netlify/Replit    │
│  - Server Components        │
│  - API Routes               │
│  - ISR/SSG                  │
└──────────────┬──────────────┘
               │
└──────────────────────────────
         Firebase
```

## Performance Optimizations

### Image Optimization

- Next.js `Image` component for optimization
- Lazy loading
- Responsive images

### Code Splitting

- Route-based code splitting
- Dynamic imports for heavy components

### Database Queries

- Indexed Firestore queries
- Pagination for large datasets
- Real-time listeners only when needed

## Error Handling

### Client-Side

- Try/catch blocks around async operations
- User-friendly error messages via Toast
- Form validation errors

### Server-Side

- Validation at API route level
- Proper HTTP status codes
- Error logging

### Firebase Errors

- Handled with specific error messages
- User guidance for common errors
- Fallback error handling

## Development Workflow

```
Feature Branch:
  git checkout -b feature/event-creation
    ↓
  Make changes
    ↓
  npm run lint
    ↓
  npm run build
    ↓
  Test locally
    ↓
  Commit with clear message
    ↓
Pull Request:
  Code review
    ↓
  Merge to main
    ↓
  CI/CD runs tests & build
    ↓
  Deploy to production
```

---

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

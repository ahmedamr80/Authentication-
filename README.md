# Firebase Auth App

A minimal, production-oriented sign-in app using Next.js 14+, Firebase v9, and Tailwind CSS.

## Features
- **Authentication**: Email/Password, Google Sign-In, Apple Sign-In (placeholder).
- **Security**: Server-side Admin SDK usage, protected API endpoints.
- **UX**: "Remember Me", Password Visibility, Account Linking, Toast Notifications.
- **Tech Stack**: Next.js (App Router), TypeScript, Tailwind CSS, Zod, React Hook Form.

## Setup Instructions

### 1. Prerequisites
- Node.js 18+
- Firebase Project (Create one at [console.firebase.google.com](https://console.firebase.google.com))

### 2. Environment Variables
Copy `.env.local` (or create it) and fill in your values:

```bash
# Firebase Client SDK (Get these from Project Settings > General > Web App)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin SDK (Server Only)
# Place your service-account.json in the project root
FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH=service-account.json

# API Protection (Set a strong random string)
ADMIN_API_KEY=secret-api-key-123

# OAuth (Optional)
GOOGLE_CLIENT_ID=...
```

### 3. Service Account
1. Go to Firebase Console > Project Settings > Service accounts.
2. Click "Generate new private key".
3. Save the file as `service-account.json` in the root of this project.
4. **IMPORTANT**: Never commit this file to git!

### 4. Install Dependencies
```bash
npm install
```

### 5. Run Development Server
```bash
npm run dev
```
Visit `http://localhost:3000/auth/signin`.

## Verification

### Verify Sign-In
1. Open the app.
2. Sign in with Email/Password or Google.
3. Check the console for success logs.

### Verify User List API
Use the provided script to fetch users securely:

```bash
# Make script executable (Git Bash / Linux / Mac)
chmod +x scripts/test-api.sh

# Run script
./scripts/test-api.sh secret-api-key-123
```

Or use curl manually:
```bash
curl -H "Authorization: Bearer secret-api-key-123" http://localhost:3000/api/list-users
```

## Security Notes
- The `/api/list-users` endpoint is protected by a simple Bearer token (`ADMIN_API_KEY`). For higher security, consider using service-to-service authentication (e.g., Google Cloud IAM) or restricting access by IP.
- Sensitive user data (like password hashes or salts) is NOT returned by the API.
- Full user management should be done via the Firebase Console or a dedicated Admin UI with strict access controls.

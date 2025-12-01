# Installation & Setup Guide

This guide walks you through setting up the Padel Community Platform locally.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Firebase Configuration](#firebase-configuration)
- [Local Development](#local-development)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- **Node.js**: Version 18.0.0 or higher
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify: `node --version`
- **npm**: Comes with Node.js
  - Verify: `npm --version`
- **Git**: For cloning and version control
- **Firebase Project**: Create at [console.firebase.google.com](https://console.firebase.google.com)

## Environment Setup

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd padel-community-platform
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all required packages from `package.json`.

### Step 3: Configure Environment Variables

Create `.env.local` in the project root:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Firebase credentials:

```bash
# Firebase Client SDK (PUBLIC - get from Firebase Console)
# Project Settings > General > Web App
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdefgh
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com

# Firebase Admin SDK (SERVER-SIDE ONLY)
# Path to service account JSON file
FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH=./service-account-key.json

# API Security (Generate a strong random string)
ADMIN_API_KEY=your_secure_random_api_key_here
```

### Step 4: Add Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to **Project Settings** > **Service Accounts** tab
4. Click **Generate New Private Key**
5. Save the downloaded JSON file as `service-account-key.json` in your project root

**⚠️ IMPORTANT**: Never commit `service-account-key.json` to Git. It's already in `.gitignore`.

## Firebase Configuration

### Create a Firebase Project

1. Visit [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter project name: `padel-community`
4. Accept terms and create project
5. Wait for project to initialize

### Enable Authentication Methods

1. In Firebase Console, go to **Authentication** > **Sign-in method**
2. Enable the following providers:
   - **Email/Password** - click Enable
   - **Google** - click Enable, provide credentials if needed
   - **Apple** - click Enable (for iOS/macOS support)

### Create Firestore Database

1. Go to **Firestore Database**
2. Click **Create Database**
3. Choose **Production mode**
4. Select your desired region
5. Click **Create**

### Set Up Firestore Security Rules

Create rules to protect your database:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth.uid != null;
      allow create: if request.auth.uid == userId;
      allow update: if request.auth.uid == userId;
      allow delete: if request.auth.uid == userId;
    }

    // Events collection
    match /events/{eventId} {
      allow read: if request.auth.uid != null;
      allow create: if request.auth.uid != null;
      allow update: if request.auth.uid == resource.data.createdBy;
      allow delete: if request.auth.uid == resource.data.createdBy;
    }

    // Clubs collection
    match /clubs/{clubId} {
      allow read: if request.auth.uid != null;
      allow write: if false; // Admin only
    }
  }
}
```

### Configure Storage Rules

Update Firebase Storage security rules:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Profile pictures
    match /profiles/{userId}/photo {
      allow read: if request.auth.uid != null;
      allow write: if request.auth.uid == userId && 
                      request.resource.size < 5 * 1024 * 1024;
    }

    // Event media
    match /events/{eventId}/{allPaths=**} {
      allow read: if request.auth.uid != null;
      allow write: if request.auth.uid != null && 
                      request.resource.size < 10 * 1024 * 1024;
    }
  }
}
```

## Local Development

### Start Development Server

```bash
npm run dev
```

The app will be available at:

- **Local**: `http://localhost:5000`
- **Network**: `http://<your-ip>:5000` (if needed)

### Building for Production

```bash
npm run build
npm start
```

### Run Type Checking

```bash
npx tsc --noEmit
```

### Run Linting

```bash
npm run lint
```

## Verification

### 1. Verify Server is Running

```bash
# Test the server is responding
curl http://localhost:5000

# Should return HTML content, not an error
```

### 2. Test Authentication

1. Open `http://localhost:5000`
2. Click "Sign Up" or "Sign In"
3. Create a test account with valid credentials:
   - Email: `test@example.com`
   - Password: `TestPassword123!` (meets requirements)

### 3. Test Google Sign-In

1. On login page, click "Sign in with Google"
2. Complete Google OAuth flow
3. Should redirect to dashboard

### 4. Test API Endpoint

```bash
# List users (requires ADMIN_API_KEY)
curl -H "Authorization: Bearer your_admin_api_key" \
  http://localhost:5000/api/list-users

# Should return JSON with users array
```

Or use the test script:

```bash
chmod +x scripts/test-api.sh
./scripts/test-api.sh your_admin_api_key
```

### 5. Check Browser Console

1. Open browser DevTools (F12)
2. Check Console tab for any errors
3. Check Network tab for failed requests

## Troubleshooting

### Port 5000 Already in Use

```bash
# Kill process using port 5000
lsof -ti:5000 | xargs kill -9

# Or use a different port
PORT=3000 npm run dev
```

### Firebase Credentials Not Found

Error: `Firebase: Error (auth/invalid-api-key).`

**Solution**:

- Verify `NEXT_PUBLIC_FIREBASE_API_KEY` in `.env.local`
- Check credentials in Firebase Console > Project Settings > Web App
- Ensure CORS is configured in Firebase Console

### Service Account Key Missing

Error: `Error: ENOENT: no such file or directory`

**Solution**:

- Verify `FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH` points to correct file
- Ensure `service-account-key.json` exists in project root
- Check file permissions: `ls -la service-account-key.json`

### Authentication Not Working

1. Check Firebase Authentication is enabled in Firebase Console
2. Verify provider (Email/Password, Google, etc.) is enabled
3. Clear browser cache and cookies
4. Test in incognito/private window

### Database Connection Issues

Error: `Firestore: Missing or insufficient permissions.`

**Solution**:

- Check Firestore Security Rules are properly configured
- Ensure user is authenticated (`request.auth.uid != null`)
- Review rule syntax in Firestore console

### CORS Issues

Error: `Access to XMLHttpRequest blocked by CORS policy.`

**Solution**:

- This shouldn't occur in development, but if it does:
- Check network domain in Firebase Console
- Verify `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is correct

## Environment Variables Reference

| Variable                              | Type   | Required | Description                     |
| ------------------------------------- | ------ | -------- | ------------------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`        | String | Yes      | Firebase API key (public)       |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`    | String | Yes      | Firebase auth domain            |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`     | String | Yes      | Firebase project ID             |
| `NEXT_PUBLIC_FIREBASE_APP_ID`         | String | Yes      | Firebase app ID                 |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | String | Yes      | Firebase storage bucket         |
| `FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH` | String | Yes      | Path to service account JSON    |
| `ADMIN_API_KEY`                       | String | Yes      | API key for protected endpoints |

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the codebase
- Check [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines
- Review [SECURITY.md](./SECURITY.md) for security best practices

---

**Need help?** Check the [Troubleshooting](#troubleshooting) section or open an issue.

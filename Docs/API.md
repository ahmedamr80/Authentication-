# API Documentation

## Overview

The Padel Community Platform provides both client-side Firebase SDK integrations and server-side API endpoints for administrative tasks.

## Authentication

### Firebase Auth (Client-Side)

Handled automatically by Firebase SDK in the browser.

**Supported Methods:**

- Email/Password
- Google OAuth
- Apple Sign-In

### API Key Authentication (Server-Side)

Protected API endpoints require a Bearer token:

```http
Authorization: Bearer <ADMIN_API_KEY>
```

**Generation:**

```bash
# Generate a strong random API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store in environment variable: `ADMIN_API_KEY`

## API Endpoints

### User Management

#### List Users

Lists all Firebase Auth users with pagination support.

**Endpoint:**

```http
GET /api/list-users
```

**Authentication:**

```http
Authorization: Bearer <ADMIN_API_KEY>
```

**Query Parameters:**

| Parameter       | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `limit`         | number | No       | Results per page (default: 100, max: 1000) |
| `nextPageToken` | string | No       | Token for pagination                       |

**Example Request:**

```bash
curl -H "Authorization: Bearer your-admin-key" \
  "http://localhost:5000/api/list-users?limit=50"
```

**Successful Response (200 OK):**

```json
{
  "users": [
    {
      "uid": "user-id-1",
      "email": "user@example.com",
      "fullName": "John Doe",
      "providerData": [
        {
          "providerId": "google.com",
          "uid": "google-uid",
          "fullName": "John Doe",
          "email": "user@example.com"
        }
      ],
      "metadata": {
        "creationTime": "2024-01-15T10:30:00Z",
        "lastSignInTime": "2024-01-20T14:45:00Z"
      }
    }
  ],
  "pageToken": "next-page-token-xyz"
}
```

**Response Fields:**

| Field          | Type   | Description                                |
| -------------- | ------ | ------------------------------------------ |
| `uid`          | string | Firebase unique identifier                 |
| `email`        | string | User's email address                       |
| `fullName`     | string | User's display name                        |
| `providerData` | array  | Authentication providers linked to account |
| `metadata`     | object | Account creation and sign-in timestamps    |
| `pageToken`    | string | Token for fetching next page               |

**Error Responses:**

**401 Unauthorized:**

```json
{
  "error": "Unauthorized"
}
```

**Causes:** Missing/invalid API key, malformed Authorization header

**500 Internal Server Error:**

```json
{
  "error": "Internal Server Error",
  "details": "Error message"
}
```

**Pagination Example:**

```bash
# First page
curl -H "Authorization: Bearer key" \
  "http://localhost:5000/api/list-users?limit=100"

# Second page (use pageToken from previous response)
curl -H "Authorization: Bearer key" \
  "http://localhost:5000/api/list-users?limit=100&nextPageToken=xyz..."
```

## Firebase SDK Integration

### Client-Side Usage

#### Authentication

```typescript
import { auth } from "@/lib/firebase";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut 
} from "firebase/auth";

// Sign up
const userCredential = await createUserWithEmailAndPassword(
  auth,
  email,
  password
);

// Sign in
const userCredential = await signInWithEmailAndPassword(
  auth,
  email,
  password
);

// Sign out
await signOut(auth);
```

#### Database Operations

```typescript
import { db } from "@/lib/firebase";
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where,
  serverTimestamp 
} from "firebase/firestore";

// Create event
await addDoc(collection(db, "events"), {
  title: "Padel Match",
  dateTime: serverTimestamp(),
  createdBy: userId,
  // ... other fields
});

// Query events
const eventsRef = collection(db, "events");
const q = query(
  eventsRef,
  where("status", "==", "active")
);
const snapshot = await getDocs(q);
const events = snapshot.docs.map(doc => doc.data());
```

### Server-Side Usage

```typescript
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

// Get admin auth
const auth = getAdminAuth();
const users = await auth.listUsers(100);

// Get admin firestore
const db = getAdminDb();
const usersRef = db.collection("users");
```

## WebSocket/Real-Time Features

### Firestore Listeners

Real-time updates using Firestore listeners:

```typescript
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

const unsubscribe = onSnapshot(
  query(collection(db, "events")),
  (snapshot) => {
    const events = snapshot.docs.map(doc => doc.data());
    // Update UI with events
  },
  (error) => {
    console.error("Error fetching events:", error);
  }
);

// Clean up listener
unsubscribe();
```

## Rate Limiting

**Recommended Rate Limits:**

| Endpoint          | Limit             | Window            |
| ----------------- | ----------------- | ----------------- |
| `/api/list-users` | 100               | 1 minute          |
| Firebase Auth     | Per Firebase plan | See Firebase docs |

**Implementation:**

```bash
npm install express-rate-limit
```

## Error Codes

### HTTP Status Codes

| Status | Meaning           | Common Cause             |
| ------ | ----------------- | ------------------------ |
| 200    | OK                | Successful request       |
| 400    | Bad Request       | Invalid parameters       |
| 401    | Unauthorized      | Invalid/missing API key  |
| 403    | Forbidden         | Insufficient permissions |
| 404    | Not Found         | Resource not found       |
| 429    | Too Many Requests | Rate limit exceeded      |
| 500    | Server Error      | Internal error           |

### Firebase Auth Errors

| Error                        | Cause                | Solution              |
| ---------------------------- | -------------------- | --------------------- |
| `auth/invalid-email`         | Email format invalid | Provide valid email   |
| `auth/weak-password`         | Password too weak    | Use stronger password |
| `auth/email-already-in-use`  | Email taken          | Use different email   |
| `auth/user-not-found`        | User doesn't exist   | Check email           |
| `auth/wrong-password`        | Incorrect password   | Verify password       |
| `auth/operation-not-allowed` | Provider disabled    | Enable in Firebase    |

## Request/Response Examples

### JavaScript/TypeScript

```typescript
// Fetch users API
const response = await fetch('/api/list-users', {
  headers: {
    'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`
  }
});

if (!response.ok) {
  const error = await response.json();
  console.error('Error:', error.error);
  return;
}

const data = await response.json();
console.log('Users:', data.users);
```

### Python

```python
import requests

headers = {
    'Authorization': f'Bearer {admin_api_key}'
}

response = requests.get(
    'http://localhost:5000/api/list-users',
    headers=headers
)

if response.status_code == 200:
    data = response.json()
    users = data['users']
else:
    print(f"Error: {response.status_code}")
```

### cURL

```bash
# Basic request
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:5000/api/list-users

# With pagination
curl -H "Authorization: Bearer your-api-key" \
  "http://localhost:5000/api/list-users?limit=50&nextPageToken=token"

# Save to file
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:5000/api/list-users > users.json
```

## Testing

### Using Provided Test Script

```bash
chmod +x scripts/test-api.sh
./scripts/test-api.sh your-admin-api-key
```

### Manual Testing with cURL

```bash
# Verify API is running
curl http://localhost:5000/api/list-users

# Should get 401 Unauthorized (no API key)

# Test with valid API key
curl -H "Authorization: Bearer your-key" \
  http://localhost:5000/api/list-users
```

### Using Postman

1. Open Postman
2. Create new GET request
3. URL: `http://localhost:5000/api/list-users`
4. Headers:
   - Key: `Authorization`
   - Value: `Bearer your-api-key`
5. Send request
6. View response

## Versioning

Current API Version: **v1** (implicit)

Future versions will use URL paths:

- `/api/v1/list-users`
- `/api/v2/list-users`

## Changelog

### v1.0.0 (Initial Release)

- `GET /api/list-users` endpoint
- Bearer token authentication
- Pagination support

---

**Need help?** Check [SECURITY.md](./SECURITY.md) for security guidelines or [INSTALLATION.md](./INSTALLATION.md) for setup.

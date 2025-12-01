# Security Best Practices & Policy

This document outlines security practices, vulnerability reporting, and best practices for the Padel Community Platform.

## Table of Contents

- [Security Principles](#security-principles)
- [Authentication Security](#authentication-security)
- [API Security](#api-security)
- [Database Security](#database-security)
- [Data Protection](#data-protection)
- [Vulnerability Reporting](#vulnerability-reporting)
- [Security Checklist](#security-checklist)
- [Incident Response](#incident-response)

## Security Principles

### Core Principles

1. **Defense in Depth**: Multiple layers of security controls
2. **Principle of Least Privilege**: Users have minimum necessary permissions
3. **Secure by Default**: Secure settings enabled by default
4. **Fail Securely**: Errors don't leak sensitive information
5. **Transparency**: Clear security practices and policies

### Security Standards

- OWASP Top 10 compliance
- Firebase security best practices
- Industry-standard encryption
- Regular security audits

## Authentication Security

### Password Requirements

All passwords must meet these requirements:

- **Minimum Length**: 8 characters
- **Character Types**: Must include:
  - Uppercase letters (A-Z)
  - Lowercase letters (a-z)
  - Numbers (0-9)
  - Special characters (!@#$%^&*)

**Implementation:**

```typescript
const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
```

### Session Management

- **Session Duration**: Firebase Auth handles automatically
- **Remember Me**: 30-day persistent login
- **Session Invalidation**: Automatic on logout
- **Multiple Sessions**: Supported (user can login from multiple devices)

### Multi-Provider Security

- **Google OAuth**: Redirects through secure Google servers
- **Apple Sign-In**: Uses official Apple authentication
- **Account Linking**: Verifies email ownership
- **Shadow Accounts**: Temporary accounts for invited users

### Firebase Auth Configuration

```javascript
// Security Rules: Auth required for most operations
firebase: {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  // These are publicly visible - API key is not sensitive
}
```

## API Security

### API Key Management

**Generation:**

```bash
# Generate strong API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Storage:**

- Store in environment variables only
- Never commit to Git
- Use `.env.local` for development
- Use secrets management in production

**Rotation:**

- Rotate every 90 days
- Plan rotation windows
- Update clients before disabling old key
- Keep old key for 24 hours as backup

**Access Control:**

- Grant API key access to specific endpoints only
- Monitor API key usage
- Revoke unused keys immediately
- Use different keys for different services

### Endpoint Protection

#### All API Endpoints

```typescript
// Verify API key for protected endpoints
if (!apiKey || !authHeader || authHeader !== `Bearer ${apiKey}`) {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401 }
  );
}
```

#### Rate Limiting

**Recommended Implementation:**

```bash
npm install express-rate-limit
```

```typescript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: "Too many requests",
  standardHeaders: true,
  legacyHeaders: false,
});
```

### Error Handling

**Never expose:**

- Internal error messages
- Stack traces
- Database details
- File paths
- Configuration details

**Example:**

```typescript
// Good
return NextResponse.json(
  { error: "Internal Server Error" },
  { status: 500 }
);

// Bad - reveals internals
return NextResponse.json(
  { error: "PostgreSQL connection failed: host not found", stack: trace },
  { status: 500 }
);
```

## Database Security

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users: Own profile only
    match /users/{userId} {
      allow read: if request.auth.uid != null;
      allow create: if request.auth.uid == userId;
      allow update: if request.auth.uid == userId;
      allow delete: if request.auth.uid == userId;
    }

    // Events: Read all, create authenticated, update/delete own
    match /events/{eventId} {
      allow read: if request.auth.uid != null;
      allow create: if request.auth.uid != null;
      allow update: if request.auth.uid == resource.data.createdBy;
      allow delete: if request.auth.uid == resource.data.createdBy;
    }

    // Clubs: Read only
    match /clubs/{clubId} {
      allow read: if request.auth.uid != null;
      allow write: if false; // Admin only
    }

    // Default: Deny all
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Data Validation

```typescript
// Validate all database writes
const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  dateTime: z.date(),
  duration: z.number().min(15).max(480),
  maxPlayers: z.number().min(2).max(10),
  location: z.string().min(1),
});

await eventSchema.parseAsync(eventData);
```

### Query Security

**Indexed Queries:**

- Always use indexed queries
- Firestore automatically indexes common patterns
- Complex queries need manual indexes

```typescript
// Indexed query
const q = query(
  collection(db, "events"),
  where("status", "==", "active"),
  where("dateTime", ">", now)
);
```

## Data Protection

### Sensitive Data

**Never Store:**

- Password hashes (Firebase handles this)
- Credit card information
- Social security numbers
- Medical information

**Encrypt if Stored:**

- Personal identification
- Financial information
- Health data

### Data Access Logging

```typescript
// Log sensitive operations
console.log({
  timestamp: new Date(),
  userId: user.uid,
  action: "profile_update",
  changes: ["email", "phone"],
});
```

### Data Retention

- Delete inactive accounts after 1 year
- Delete media after account deletion
- Archive events older than 2 years
- Retain minimal audit logs

### GDPR Compliance

- **Right to Access**: Users can export their data
- **Right to Deletion**: Users can delete their account
- **Data Portability**: Users can get their data in standard format
- **Consent**: Clear consent for data collection

## Vulnerability Reporting

### Responsible Disclosure

We take security seriously and appreciate responsible vulnerability reporting.

### Reporting Process

1. **Do NOT** open public GitHub issues for security vulnerabilities
2. **Email** security concerns to: `security@padel-community.dev`
3. Include:
   - Vulnerability description
   - Steps to reproduce
   - Potential impact
   - Your suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 24 hours
- **Investigation**: Within 5 days
- **Patch Release**: As soon as possible
- **Public Disclosure**: After patch is released

### Safe Harbor

We commit to:

- Not pursuing legal action for responsible disclosure
- Not sharing your information with third parties
- Crediting you in security advisories (if desired)
- Timely communication throughout process

## Security Checklist

### Development

- [ ] TypeScript strict mode enabled
- [ ] Input validation on all forms (Zod schemas)
- [ ] Environment variables not hardcoded
- [ ] No sensitive data in logs
- [ ] CORS properly configured
- [ ] CSP headers set
- [ ] X-Frame-Options header set

### API Security

- [ ] All API endpoints authenticated
- [ ] Rate limiting implemented
- [ ] Input sanitization
- [ ] Output encoding
- [ ] Error messages don't leak info
- [ ] API key rotation scheduled

### Database Security

- [ ] Firestore rules reviewed and tested
- [ ] No public read/write access
- [ ] Queries properly indexed
- [ ] Data encryption enabled
- [ ] Backup strategy in place

### Authentication

- [ ] Password requirements enforced
- [ ] MFA available (Firebase default)
- [ ] Session timeouts configured
- [ ] HTTPS only
- [ ] Secure cookies set

### Deployment

- [ ] Environment variables secured
- [ ] No debug mode in production
- [ ] Logging configured
- [ ] Monitoring enabled
- [ ] Backup strategy tested
- [ ] Disaster recovery plan

## Incident Response

### Incident Definition

Security incidents include:

- Unauthorized data access
- Data breach
- System compromise
- Denial of service
- Suspicious activity

### Response Steps

1. **Identify**: Confirm incident
2. **Isolate**: Limit damage
3. **Investigate**: Determine scope
4. **Notify**: Contact affected users
5. **Remediate**: Fix the issue
6. **Review**: Post-incident analysis

### Communication Template

```
Subject: Security Incident - Action Required

Dear User,

We have identified a security incident affecting [service].

Impact: [Description of what happened]
Timeframe: [When it occurred]
Your Action: [What users should do]

We have [already resolved/are resolving] the issue.

For questions: security@padel-community.dev
```

## Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Firebase Security](https://firebase.google.com/support/guides/security-checklist)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)

## Policy Updates

This policy is reviewed and updated:

- Quarterly (scheduled reviews)
- After security incidents
- When dependencies are updated
- When threats are discovered

**Last Updated**: December 1, 2024
**Next Review**: March 1, 2025

---

**Security is everyone's responsibility. Thank you for helping keep our platform secure.**

For security concerns, please email: `security@padel-community.dev`

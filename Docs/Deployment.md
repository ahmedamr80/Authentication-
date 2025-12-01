# Deployment & Production Guide

This guide covers deploying the Padel Community Platform to production.

## Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Environment Configuration](#environment-configuration)
- [Deployment Platforms](#deployment-platforms)
- [Performance Optimization](#performance-optimization)
- [Monitoring & Logging](#monitoring--logging)
- [Rollback Procedure](#rollback-procedure)
- [Scaling](#scaling)

## Pre-Deployment Checklist

### Code Quality

- [ ] All tests passing
- [ ] No console warnings/errors
- [ ] ESLint checks pass
- [ ] TypeScript compilation successful
- [ ] No hardcoded secrets
- [ ] Code reviewed and approved

### Security

- [ ] Security audit completed
- [ ] Dependencies updated and audited
- [ ] CORS configured correctly
- [ ] CSP headers set
- [ ] Rate limiting enabled
- [ ] API keys rotated
- [ ] Firestore security rules reviewed

### Performance

- [ ] Build time < 5 minutes
- [ ] Bundle size analyzed
- [ ] Images optimized
- [ ] Database queries indexed
- [ ] CDN configured
- [ ] Caching strategy defined

### Configuration

- [ ] Production environment variables set
- [ ] Firebase rules deployed
- [ ] Error monitoring configured
- [ ] Logging configured
- [ ] Backup strategy tested
- [ ] Disaster recovery plan reviewed

### Testing

- [ ] Manual testing completed
- [ ] Cross-browser testing passed
- [ ] Mobile testing passed
- [ ] Authentication tested
- [ ] Payment flow tested (if applicable)
- [ ] Database transactions verified

## Environment Configuration

### Production Environment Variables

Create `.env.production.local`:

```bash
# Firebase Client SDK
NEXT_PUBLIC_FIREBASE_API_KEY=prod_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=prod-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=prod-project-id
NEXT_PUBLIC_FIREBASE_APP_ID=prod_app_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=prod-project.appspot.com

# Firebase Admin SDK
FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH=/secrets/service-account-key.json

# Security
ADMIN_API_KEY=very_secure_random_key_minimum_32_chars

# Monitoring
SENTRY_DSN=https://your_sentry_dsn
LOG_LEVEL=info

# Performance
NEXT_PUBLIC_GTM_ID=GTM-XXXXX
```

### Secrets Management

**Never commit secrets to Git:**

```bash
# Add to .gitignore
.env.production.local
.env.local
service-account-key.json
```

**Use Platform Secrets:**

- Vercel: Settings > Environment Variables
- Netlify: Site Settings > Build & Deploy > Environment
- AWS: Systems Manager > Parameter Store
- GCP: Secret Manager

## Deployment Platforms

### Vercel (Recommended)

Easiest deployment for Next.js apps.

**Setup:**

```bash
npm i -g vercel
vercel login
vercel --prod
```

**Configuration (vercel.json):**

```json
{
  "env": {
    "NEXT_PUBLIC_FIREBASE_API_KEY": "@firebase_api_key",
    "FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH": "@firebase_admin_path"
  },
  "buildCommand": "npm run build",
  "outputDirectory": ".next"
}
```

**Environment Variables in Vercel Dashboard:**

1. Go to Project Settings
2. Click Environment Variables
3. Add each variable
4. Mark as "Secret" if sensitive
5. Redeploy

### Netlify

Good alternative to Vercel.

**Setup:**

```bash
npm run build

# Deploy via Netlify CLI
netlify deploy --prod --dir=.next
```

**Netlify.toml:**

```toml
[build]
  command = "npm run build"
  functions = "api"
  publish = ".next"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
```

### Self-Hosted (AWS/GCP/DigitalOcean)

For more control.

**Dockerfile:**

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 5000

CMD ["npm", "start"]
```

**Deploy to AWS ECS:**

```bash
# Build image
docker build -t padel-platform .

# Tag for ECR
docker tag padel-platform:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/padel-platform:latest

# Push to ECR
aws ecr push-image ...
```

## Performance Optimization

### Build Optimization

```bash
# Analyze bundle
npm install --save-dev @next/bundle-analyzer

# Run analysis
ANALYZE=true npm run build
```

### Image Optimization

```typescript
// Use Next.js Image component
import Image from 'next/image';

export function EventCard({ event }) {
  return (
    <Image
      src={event.image}
      alt={event.title}
      width={400}
      height={300}
      priority={false}
      quality={75}
    />
  );
}
```

### Code Splitting

```typescript
// Dynamic imports for large components
import dynamic from 'next/dynamic';

const EventForm = dynamic(() => import('./EventForm'), {
  loading: () => <div>Loading...</div>,
});
```

### Caching Strategy

**HTTP Caching Headers:**

```typescript
// next.config.ts
headers: [
  {
    source: '/static/:path*',
    headers: [
      {
        key: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      },
    ],
  },
  {
    source: '/(.*)',
    headers: [
      {
        key: 'Cache-Control',
        value: 'public, max-age=0, must-revalidate',
      },
    ],
  },
];
```

### Database Query Optimization

```typescript
// Add Firestore indexes for common queries
// Dashboard > Firestore > Indexes > Composite Indexes

// Query with index
const q = query(
  collection(db, 'events'),
  where('status', '==', 'active'),
  where('dateTime', '>', now),
  orderBy('dateTime', 'asc')
);
```

## Monitoring & Logging

### Error Tracking (Sentry)

```bash
npm install @sentry/react @sentry/nextjs
```

**Setup:**

```typescript
// app/layout.tsx
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});
```

### Performance Monitoring

```typescript
// Web Vitals
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

function sendToAnalytics(metric) {
  const body = JSON.stringify(metric);
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/analytics', body);
  }
}

getCLS(sendToAnalytics);
getFID(sendToAnalytics);
getFCP(sendToAnalytics);
getLCP(sendToAnalytics);
getTTFB(sendToAnalytics);
```

### Application Logs

```typescript
// Configure logging level
const logLevel = process.env.LOG_LEVEL || 'info';

function log(level: string, message: string, data?: any) {
  if (['error', 'warn', 'info'].includes(level)) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      env: process.env.NODE_ENV,
    }));
  }
}
```

## Rollback Procedure

### Manual Rollback

**Vercel:**

1. Dashboard > Deployments
2. Click deployment to rollback to
3. Click "..." menu
4. Select "Promote to Production"

**Netlify:**

1. Deploys tab
2. Select previous deployment
3. Click "Publish Deploy"

### Automated Rollback (Git)

```bash
# Revert last commit
git revert HEAD
git push origin main

# Vercel/Netlify auto-deploys on push
```

### Database Rollback

```typescript
// Create backup before major deployment
// Firebase Console > Firestore > Backups > Create Backup

// Restore from backup if needed
// Firebase Console > Firestore > Backups > Restore
```

## Scaling

### Horizontal Scaling

Serverless platforms handle this automatically.

**Vercel/Netlify**: Automatic scaling based on traffic

### Database Scaling

**Firestore Scaling:**

- Automatic scaling
- Reads: Up to 50k/second
- Writes: Up to 20k/second
- Monitor in Firebase Console > Usage

```typescript
// Optimize queries to reduce reads
// Use document queries instead of collection queries
// Implement pagination
// Use collection groups wisely
```

### Storage Scaling

**Firebase Storage:**

- Automatic scaling
- No caps on storage
- Monitor usage in Firebase Console

```typescript
// Implement file cleanup
// Archive old media
// Compress images
```

### API Scaling

Rate limiting and caching help with scaling:

```typescript
// Implement caching
import { unstable_cache } from 'next/cache';

const getEvents = unstable_cache(
  async () => {
    // Fetch events
  },
  ['events'],
  { revalidate: 60, tags: ['events'] } // 1 minute cache
);
```

## Health Checks

### Endpoint Monitoring

```bash
# Add health check endpoint
curl https://your-app.com/api/health

# Response
{
  "status": "ok",
  "timestamp": "2024-01-20T10:00:00Z"
}
```

### Uptime Monitoring

Use services like:

- UptimeRobot (free)
- Pingdom
- Datadog
- New Relic

### Alerts

Set up alerts for:

- High error rates
- Slow response times
- Database errors
- Authentication failures
- API key issues

## Production Checklist (Final)

Before going live:

- [ ] Domain configured
- [ ] SSL/HTTPS working
- [ ] All environment variables set
- [ ] Monitoring configured
- [ ] Error tracking active
- [ ] Backups scheduled
- [ ] Alerts configured
- [ ] Support process ready
- [ ] Documentation up to date
- [ ] Team trained on deployment

## Disaster Recovery

### Backup Strategy

```bash
# Daily Firebase backups (automatic)
# Firebase Console > Firestore > Backups > Automatic Backups

# Enable point-in-time recovery
# Firebase Console > Firestore > Backups > Create On-Demand
```

### Recovery Time Objective (RTO)

- **Critical Outage**: 1 hour
- **Data Loss**: 24 hours

### Recovery Point Objective (RPO)

- **Database**: Daily backups
- **Code**: Git history (instant recovery)

---

**Questions about deployment?** Check the platform docs:

- [Vercel Docs](https://vercel.com/docs)
- [Netlify Docs](https://docs.netlify.com/)
- [Firebase Docs](https://firebase.google.com/docs/)

**Need support?** Open an issue or email support.

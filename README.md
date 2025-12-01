# Padel Community Platform

A production-grade padel community platform built with Next.js, Firebase, and Tailwind CSS. Connect with players, discover events, find clubs, and manage your padel journey.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Padel Community Platform is a comprehensive digital ecosystem designed for the padel community. Whether you're joining matches, discovering courts, connecting with players, or managing profiles—everything is here.

### Key Highlights

- **Secure Multi-Provider Authentication** (Email/Password, Google, Apple)
- **Comprehensive Event Management** (Browse, filter, search, create)
- **Community Features** (Player discovery, profiles, connections)
- **Club Directory** (Explore partner venues)
- **User Profiles** (Statistics, preferences, media)
- **Enterprise Security** (Server-side validation, protected APIs)

## Features

### 🔐 Authentication & Security
- Email/Password registration and login
- Google OAuth integration
- Apple Sign-In support
- "Remember Me" functionality
- Account linking for returning players
- Server-side Admin SDK usage
- Protected API endpoints with API key authentication
- Secure password requirements (8+ chars, uppercase, lowercase, number, special char)

### 📅 Event Management
- Browse all padel events in real-time
- Advanced filtering (Active, Upcoming, Past, Cancelled)
- Full-text search functionality
- Create and manage events
- Dynamic event status calculation
- Event details and registration

### 👥 Community Features
- Discover padel players
- View comprehensive player profiles
- Player statistics and rankings
- Community connection

### 🏢 Club Directory
- Partner club listings with details
- Court information
- Easy club discovery and exploration

### 👤 Profile Management
- Personalized player profiles
- Player statistics
- Profile picture management
- Account settings

### 📸 Media Library
- Photo uploads and storage
- Video support
- Media organization

## Tech Stack

| Category | Technology |
|----------|-------------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5 |
| **Styling** | Tailwind CSS 4 |
| **UI Components** | Radix UI |
| **Icons** | Lucide React |
| **Forms** | React Hook Form + Zod |
| **Authentication** | Firebase Auth |
| **Database** | Firebase Firestore |
| **Storage** | Firebase Storage |
| **Admin SDK** | Firebase Admin SDK |

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Firebase project

### Installation

```bash
# Clone repository
git clone <repository-url>
cd padel-community-platform

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env.local

# Start development server
npm run dev
```

Visit `http://localhost:5000`

For detailed setup, see [INSTALLATION.md](./docs/INSTALLATION.md).

## Documentation

Complete documentation available in the `docs/` directory:

| Document | Purpose |
|----------|---------|
| [INSTALLATION.md](./docs/INSTALLATION.md) | Detailed setup and configuration |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Technical design and structure |
| [API.md](./docs/API.md) | API endpoint documentation |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Contributing guidelines |
| [SECURITY.md](./docs/SECURITY.md) | Security best practices |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Production deployment guide |
| [CHANGELOG.md](./docs/CHANGELOG.md) | Release history |

## Development

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm start         # Run production build
npm run lint      # Run ESLint
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for guidelines.

## Security

Report security issues to our security team. See [SECURITY.md](./docs/SECURITY.md) for details.

## License

MIT License - see LICENSE file for details.

---

**Built with ❤️ for the padel community**

# Padel Community Platform

A production-grade padel community platform built with Next.js, Firebase, and Tailwind CSS. Connect with players, discover events, find clubs, and manage your padel journey. The project also includes cross-platform support using Capacitor to build mobile applications (iOS/Android) from the same codebase.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Padel Community Platform is a comprehensive digital ecosystem designed for the padel community. Whether you're joining matches, discovering courts, connecting with players, or managing profiles—everything is here. It provides a solid foundation for applications requiring authentication and real-time database capabilities via Firebase.

### Key Highlights

- **Secure Multi-Provider Authentication** (Email/Password, Google, Apple)
- **Comprehensive Event Management** (Browse, filter, search, create)
- **Community Features** (Player discovery, profiles, connections)
- **Club Directory** (Explore partner venues)
- **User Profiles** (Statistics, preferences, media)
- **Enterprise Security** (Server-side validation, protected APIs)
- **Mobile Ready** (Capacitor integration for generating native iOS and Android apps)

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
| **Mobile** | Capacitor |

## Project Structure

```
├── src/                # Next.js application source code (App Router)
│   ├── app/            # Application routes and pages
│   ├── components/     # Reusable UI components
│   ├── context/        # React context providers
│   ├── hooks/          # Custom React hooks
│   ├── lib/            # Utility functions and Firebase configuration
│   └── types/          # TypeScript type definitions
├── functions/          # Firebase Cloud Functions source code
├── android/            # Capacitor Android project
├── ios/                # Capacitor iOS project
├── public/             # Static assets (images, icons, etc.)
└── ...                 # Configuration files (Tailwind, Next.js, etc.)
```

## Quick Start

### Prerequisites
- Node.js (version 20 or higher recommended)
- npm or yarn
- Firebase project

### Installation

```bash
# Clone repository
git clone <repository-url>
cd padel-community-platform

# Install dependencies in the root directory
npm install

# Install dependencies in the functions directory
cd functions
npm install
cd ..

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

## Available Scripts

In the project directory, you can run:

```bash
npm run dev       # Start Next.js development server on port 5000
npm run build     # Build the app for production to the .next folder
npm start         # Run Next.js production server on port 5000
npm run lint      # Run ESLint to catch and fix code style issues
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for guidelines.

## Security

Report security issues to our security team. See [SECURITY.md](./docs/SECURITY.md) for details.

## License

MIT License - see LICENSE file for details.

---

**Built with ❤️ for the padel community**
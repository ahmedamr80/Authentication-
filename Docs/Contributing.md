# Contributing Guide

Thank you for contributing to the Padel Community Platform! This guide helps you understand how to develop and contribute effectively.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

### Our Commitment

We are committed to providing a welcoming and inspiring community for all. We expect participants to:

- Use welcoming and inclusive language
- Be respectful of differing opinions and experiences
- Accept constructive criticism gracefully
- Show empathy towards other community members
- Report unacceptable behavior to maintainers

### Expected Behavior

- Be professional and respectful
- Focus on constructive feedback
- Help others learn and grow
- Follow all contributing guidelines

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Git
- A Firebase project
- A GitHub account

### Setup Development Environment

```bash
# Clone the repository
git clone <repository-url>
cd padel-community-platform

# Install dependencies
npm install

# Create local environment file
cp .env.example .env.local

# Add Firebase credentials to .env.local

# Start development server
npm run dev
```

### Familiarize Yourself

1. Read [README.md](../README.md) for overview
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for codebase structure
3. Read [API.md](./API.md) for backend endpoints
4. Explore the codebase: `src/app/`, `src/components/`, `src/context/`

## Development Workflow

### Branch Naming

Use descriptive branch names:

```bash
# Features
git checkout -b feature/event-filtering
git checkout -b feature/user-profile-edit

# Bug fixes
git checkout -b fix/signin-form-validation
git checkout -b fix/event-date-parsing

# Documentation
git checkout -b docs/api-examples
git checkout -b docs/setup-guide

# Chores
git checkout -b chore/update-dependencies
git checkout -b chore/refactor-auth-context
```

### Feature Development

1. **Create a branch from `main`:**
   
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   
   - Keep commits atomic and logical
   - One feature per branch
   - Update relevant documentation

3. **Test your changes:**
   
   ```bash
   npm run lint    # Check code style
   npm run build   # Verify build succeeds
   npm run dev     # Test in development
   ```

4. **Create a pull request:**
   
   - Push to your fork
   - Create PR against `main`
   - Fill out the PR template
   - Request reviewers

## Code Standards

### TypeScript

- Always use TypeScript, no JavaScript
- Use strict mode: `"strict": true`
- Proper typing for all functions and components
- No `any` types (use `unknown` if necessary)

**Example:**

```typescript
// Good
interface User {
  id: string;
  email: string;
  fullName: string;
}

function getUserName(user: User): string {
  return user.fullName;
}

// Avoid
function getUserName(user: any): any {
  return user.fullName;
}
```

### React Components

- Use functional components with hooks
- Use TypeScript for component props
- Keep components focused and reusable
- Use meaningful names

**Example:**

```typescript
// Good
interface EventCardProps {
  event: Event;
  onJoin: (eventId: string) => Promise<void>;
}

export function EventCard({ event, onJoin }: EventCardProps): JSX.Element {
  return (
    <div>
      <h2>{event.title}</h2>
      <button onClick={() => onJoin(event.id)}>Join</button>
    </div>
  );
}

// Avoid
export function EventCard(props) {
  return <div>{props.event.title}</div>;
}
```

### Styling

- Use Tailwind CSS classes
- Follow the existing style patterns
- Keep components responsive
- Use semantic class names

**Example:**

```typescript
// Good
<button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
  Join Event
</button>

// Avoid
<button style={{ padding: "10px 20px", backgroundColor: "blue" }}>
  Join Event
</button>
```

### Form Validation

- Use Zod schemas for validation
- Validate on both client and server
- Provide clear error messages
- Show validation errors inline

**Example:**

```typescript
const eventSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  date: z.date().refine(d => d > new Date(), "Date must be in future"),
  maxPlayers: z.number().min(2, "Need at least 2 players"),
});
```

### File Organization

- Group related files together
- Use lowercase with hyphens for file names
- Use PascalCase for component files
- Keep files focused and single-purpose

```bash
# Good organization
src/components/
├── ui/button.tsx
├── ClubCard.tsx
├── EventCard.tsx
└── EventFilters.tsx

# Avoid
src/components/
├── button.tsx (confusing - looks like a utility)
├── clubcard.tsx (hard to read)
└── everything_else.tsx
```

## Commit Guidelines

### Commit Messages

Write clear, descriptive commit messages:

```bash
# Format: <type>: <description>
# Types: feat, fix, docs, style, refactor, chore, test

# Examples
git commit -m "feat: add event filtering by date range"
git commit -m "fix: resolve sign-in form validation error"
git commit -m "docs: update API endpoint documentation"
git commit -m "refactor: extract EventCard logic to custom hook"
```

### Commit Rules

- One logical change per commit
- Keep commits small and focused
- Write in imperative tense: "add" not "added"
- Reference issues: "fixes #123"

**Example:**

```bash
git commit -m "feat: add event status filter

- Add Active, Upcoming, Past filter buttons
- Implement status calculation logic
- Update EventFilters component
- Fixes #42"
```

## Pull Request Process

### Before Creating PR

1. **Update main branch:**
   
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run checks:**
   
   ```bash
   npm run lint
   npm run build
   npm run type-check
   ```

3. **Test thoroughly:**
   
   - Test in development
   - Test on different screen sizes
   - Test different user flows
   - Test error scenarios

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issue
Fixes #(issue number)

## Testing
- [ ] Unit tested
- [ ] Manually tested
- [ ] Cross-browser tested

## Changes
- Change 1
- Change 2
- Change 3

## Checklist
- [ ] Code follows project style
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] PR title is descriptive
```

### PR Review Guidelines

- Keep PRs focused (avoid large changes)
- Maximum 400 lines of code per PR
- Link related issues
- Respond to review comments within 24 hours
- Request re-review after making changes

## Testing

### Running Tests

```bash
# Lint code
npm run lint

# Type check
npm run type-check

# Build
npm run build
```

### Manual Testing Checklist

- [ ] Feature works as expected
- [ ] No console errors
- [ ] No performance regressions
- [ ] Mobile responsive
- [ ] Works in target browsers
- [ ] Error handling works

### Testing Areas

1. **Authentication:**
   
   - Sign up with email
   - Sign in with email
   - Google OAuth
   - Logout
   - Remember me functionality

2. **Events:**
   
   - List events
   - Filter events
   - Search events
   - Create event
   - Event details

3. **Forms:**
   
   - Input validation
   - Error messages
   - Submit handling
   - Loading states

## Documentation

### Update Documentation When

- Adding new features
- Changing existing features
- Adding new API endpoints
- Changing configuration
- Adding environment variables

### Documentation Files

- **README.md** - High-level overview
- **docs/ARCHITECTURE.md** - Technical design
- **docs/API.md** - API documentation
- **docs/INSTALLATION.md** - Setup guide
- **Code comments** - Explain complex logic

### Documentation Standards

```typescript
/**
 * Validates event data and creates new event in Firestore
 * @param eventData - Event information to create
 * @returns Promise with created event ID
 * @throws FirestoreError if database write fails
 */
async function createEvent(eventData: EventData): Promise<string> {
  // Implementation
}
```

## Common Issues & Solutions

### Issue: ESLint errors

```bash
# Fix automatically
npm run lint -- --fix
```

### Issue: TypeScript errors

```bash
# Check types
npx tsc --noEmit

# See detailed errors
npm run build
```

### Issue: Firebase errors

- Check `.env.local` variables
- Verify Firebase project configuration
- Check Firestore security rules
- Review browser console

### Issue: Port already in use

```bash
# Kill process using port 5000
lsof -ti:5000 | xargs kill -9

# Or use different port
PORT=3001 npm run dev
```

## Getting Help

- **Questions?** Open a GitHub Discussion
- **Found a bug?** Open a GitHub Issue
- **Need guidance?** Ask in our community channel
- **Security issue?** See [SECURITY.md](./SECURITY.md)

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Firebase Documentation](https://firebase.google.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [React Documentation](https://react.dev)

## Recognition

We recognize and thank all contributors! Your contributions are valuable.

---

**Thank you for contributing to making the Padel Community Platform better! 🎾**

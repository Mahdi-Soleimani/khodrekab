# Contributing to Khodrekab

Thank you for your interest in contributing to **Khodrekab** (خودرکاب)! We are building a modern, high-performance automotive showroom and pre-order platform. We welcome contributions, bug fixes, performance enhancements, and documentation improvements.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and professional environment for all contributors. Please treat everyone with respect, professionalism, and constructive feedback.

---

## Development Workflow

### 1. Prerequisites
- **Node.js:** v24.x (Active LTS)
- **npm:** v10.x or higher
- **Docker & Docker Compose:** For running PostgreSQL and Redis services
- **Gitleaks:** `brew install gitleaks` (for local pre-commit secret detection)

### 2. Fork & Clone
```bash
git clone https://github.com/<your-username>/khodrekab.git
cd khodrekab
npm install
```

### 3. Local Environment Setup
1. Copy the example configuration:
   ```bash
   cp .env.example .env
   ```
2. Start background PostgreSQL and Redis services:
   ```bash
   docker compose up -d postgres redis
   ```
3. Initialize the database and bootstrap least-privilege roles:
   ```bash
   psql -h localhost -p 5433 -U postgres -d carlanding -f prisma/bootstrap-roles.sql
   npx prisma migrate dev
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

---

## Branch Naming Convention

Create feature branches off the latest `main`:

| Prefix | Usage | Example |
| :--- | :--- | :--- |
| `feat/` | New features or user-facing capabilities | `feat/canvas-frame-interpolation` |
| `fix/` | Bug fixes and crash resolutions | `fix/otp-countdown-timer` |
| `perf/` | Performance optimizations | `perf/bitmap-lru-eviction` |
| `docs/` | Documentation additions or edits | `docs/state-machine-update` |
| `refactor/` | Code structure improvements without behavior changes | `refactor/security-ratelimit-modularization` |
| `chore/` | Tooling, dependencies, or CI updates | `chore/upgrade-tailwind-v4` |

---

## Commit Message Guidelines

We strictly adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short description in imperative mood>

[optional body explaining motivation and context]

[optional footer(s), e.g., Fixes #12]
```

### Examples:
- `feat(engine): implement LRU eviction for offscreen canvas bitmaps`
- `fix(auth): normalize Iranian national phone prefixes to E.164 format`
- `docs(database): document pessimistic row-level locking protocol`
- `perf(renderer): clamp device pixel ratio to 2.0 on high-DPI displays`

---

## Quality Gates & Verification

Before submitting a Pull Request, ensure that all local quality gates pass:

1. **TypeScript Typecheck:**
   ```bash
   npm run typecheck
   ```
   Must pass with **0 errors**.

2. **Automated Secret Detection (Gitleaks):**
   ```bash
   gitleaks detect --config=.gitleaks.toml --verbose
   ```
   Must exit with **0 leaks**.

3. **Database Migration Safety:**
   Never edit past Prisma migration files directly. Use `npx prisma migrate dev --name <migration_name>` to generate clean, additive schema migrations.

---

## Submitting a Pull Request (PR)

1. Push your branch to your GitHub fork:
   ```bash
   git push origin feat/my-awesome-feature
   ```
2. Open a Pull Request against `main` on the upstream repository: `https://github.com/Mahdi-Soleimani/khodrekab`.
3. Complete the [Pull Request Template](pull_request_template.md) detailing:
   - What changes were made.
   - Why the change is necessary.
   - Evidence/benchmarks demonstrating the fix or feature.
4. Ensure all CI checks (Gitleaks scan, Typecheck pipeline) pass.
5. Address any review comments and request a re-review when ready.

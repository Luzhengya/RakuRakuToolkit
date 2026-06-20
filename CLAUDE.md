# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral Guidelines

### 1. Think Before Coding
State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. If something is unclear, stop, name what's confusing, and ask.

### 2. Simplicity First
Minimum code that solves the problem. No features beyond what was asked. No abstractions for single-use code. If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
Touch only what you must. Don't "improve" adjacent code or comments. Match existing style. If you notice unrelated dead code, mention it — don't delete it.

### 4. Goal-Driven Execution
For multi-step tasks, state a brief plan with verifiable success criteria before implementing.

### 5. Always Use Chinese (Override)
All reasoning, assumptions, questions, explanations, plans, and final answers must be written in Chinese (Mandarin). Code, technical terms, and proper nouns may remain in English. This rule takes precedence over all others.

---

## Commands

```bash
npm run dev       # Start dev server (Express + Vite HMR) at http://localhost:5173
npm run build     # Build frontend for production (Vite → dist/)
npm start         # Start production server (NODE_ENV=production)
npm run lint      # TypeScript type check (tsc --noEmit)
npm run clean     # Remove dist/
```

**Setup:**
```bash
npm install
cp .env.example .env.local   # Fill in API keys before running
```

No test framework is configured.

---

## Architecture

Full-stack TypeScript app ("ToolSetLimo") — one Express server serves both the REST API and the Vite-built React SPA. The app is a collection of internal tools organized into three categories: 文档类 (document tools), 管理类 (management tools), and データ収集类 (data collection).

### Server

- **Development**: `server.ts` imports the Express app from `api/index.ts`, wraps it with Vite dev middleware, and listens on PORT (default 5173).
- **Production/Vercel**: `api/index.ts` is the Express app exported as a serverless function. `vercel.json` rewrites `/api/*` to this single function (maxDuration 90s, 1024 MB memory).
- **All API routes live in `api/index.ts`** (single file, ~1800 lines). File uploads use in-memory storage only (`multer.memoryStorage`) — no disk I/O, required for Vercel serverless.

### Frontend

- **Routing**: `App.tsx` holds a `view` string state and renders the matching component. No router library. Each tool component receives an `onBack` callback.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin — no `tailwind.config.js` or PostCSS config.
- **Animations**: `motion` (Framer Motion) for view transitions.
- **i18n**: `src/i18n/testcenter.ts` provides zh/ja translations for the TestCenter module via a `createT(lang)` helper. Not all components are i18n-aware.
- **Shared hook**: `src/hooks/useFileUpload.ts` provides drag-and-drop file upload with optional server round-trip (`skipUpload` flag for client-only processing).
- **Path alias**: `@/*` maps to project root (configured in both `tsconfig.json` and `vite.config.ts`).

### External Services

All configured via env vars (see `.env.example`):

- **Notion API** — TestCenter progress data, history storage, monthly achievement reports, bug list (multiple database IDs).
- **Adobe PDF Services** — PDF → Word conversion.
- **Browserless (Playwright)** — headless browser for 時事速報 data collection scraping.
- **時事通信社 (jijiweb)** — login credentials for news article scraping.

### API Routes

| Prefix | Purpose |
|---|---|
| `POST /api/upload` | File upload (Excel metadata extraction) |
| `POST /api/convert` | Excel → Markdown conversion |
| `POST /api/pdf-convert` | PDF → Word (Adobe) |
| `POST /api/pdf-merge` | Merge multiple PDFs |
| `GET/POST /api/test-center/*` | TestCenter CRUD: progress list, overview, results update, history |
| `GET /api/test-center/monthly-report` | Monthly report data from Notion achievement DB |
| `GET /api/test-center/bugs` | Bug list from Notion bug DB |
| `POST /api/jiji-search` | 時事速報 scraping via Browserless |

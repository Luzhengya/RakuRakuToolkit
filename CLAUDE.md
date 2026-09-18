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
cp .env.example .env         # Fill in API keys before running (dotenv reads .env, not .env.local)
```

No unit test framework is configured. `npm run smoke` (scripts/smoke.mjs) hits every
read endpoint and the input-validation paths against a running dev server — run it before
and after changing `api/index.ts`. Use `--save` / `--compare` to diff against a baseline.

---

## Architecture

Full-stack TypeScript app ("ToolSetLimo") — one Express server serves both the REST API and the Vite-built React SPA. The app is a collection of internal tools organized into three categories: 文档类 (document tools), 管理类 (management tools), and データ収集类 (data collection).

### Server

- **Development**: `server.ts` imports the Express app from `api/index.ts`, wraps it with Vite dev middleware, and listens on PORT (default 5173).
- **Production/Vercel**: `api/index.ts` is the Express app exported as a serverless function. `vercel.json` rewrites `/api/*` to this single function (maxDuration 90s, 1024 MB memory).
- **All API routes live in `api/index.ts`** (single file, ~4400 lines). File uploads use in-memory storage only (`multer.memoryStorage`) — no disk I/O, required for Vercel serverless.
- **Unknown `/api/*` paths return 404 JSON** (registered at the end of `api/index.ts`, before the SPA fallback). Without it the SPA fallback answers 200 with HTML and `res.json()` fails confusingly on the client.
- **The progress database (`NOTION_PROGRESS_DATABASE_ID`) full query is cached in memory for 60s** and concurrent callers share one in-flight request. Routes that write to it (`/api/test-center/results`, `/api/test-center/case-schedule/:id`) invalidate the cache so a saved value never rolls back. Transient Notion failures are retried (`withNotionRetry`); a page that still cannot be fetched throws rather than being silently dropped from the list.

### Frontend

- **Routing**: `App.tsx` holds a `view` string state and renders the matching component. No router library. Each tool component receives an `onBack` callback.
- **TestCenter is the largest component** (`src/components/TestCenter.tsx`) — it internally renders `BugList.tsx` and `CaseStats.tsx` etc. as sub-views; those are not separate top-level `view`s in `App.tsx`.
- **PdfEditor is client-side only** — uses `pdf-lib`/`pdfjs-dist` in the browser to render and edit PDF text regions; the only server involvement is `GET /api/pdf-status` (checks whether Adobe credentials are configured, used by PdfToWord).
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin — no `tailwind.config.js` or PostCSS config.
- **Animations**: `motion` (Framer Motion) for view transitions.
- **i18n**: `src/i18n/testcenter.ts` provides zh/ja translations for the TestCenter module via a `createT(lang)` helper. Not all components are i18n-aware.
- **Shared hook**: `src/hooks/useFileUpload.ts` provides drag-and-drop file upload with optional server round-trip (`skipUpload` flag for client-only processing).
- **Path alias**: `@/*` maps to project root (configured in both `tsconfig.json` and `vite.config.ts`).

### External Services

All configured via env vars (see `.env.example`):

- **Notion API** — TestCenter progress data, history storage, monthly achievement reports, bug list, 時事速報 (jijinews DB) (multiple database IDs).
- **Adobe PDF Services** — PDF → Word conversion.

### API Routes

| Route | Purpose |
|---|---|
| **Config** ||
| `GET /api/pdf-status` | Whether Adobe PDF Services credentials are configured |
| `GET /api/config/env-versions` | Chrome / iOS / Android versions used in reports (Notion) |
| `GET /api/config/kpi-targets` | KPI target values shown on the case list (Notion) |
| **Documents** ||
| `POST /api/upload` | Parse uploaded file metadata (Excel sheet names). Bytes are not stored |
| `POST /api/convert` | Excel → Markdown |
| `POST /api/pdf-convert` | PDF → Word via Adobe. Returns a zip |
| `POST /api/pdf-merge` | Merge PDFs, with per-page reorder/delete |
| `POST /api/pdf-extract-tables` | Detect tables in a PDF via Adobe Extract (PDF Editor, table mode) |
| **Test Center — progress** ||
| `GET /api/test-center?area=` | Case list for one area (11 valid areas; invalid → 400) |
| `GET /api/test-center/overview` | All leaf cases across areas |
| `GET /api/test-center/alerts` | Schedule alerts (due today / plan missing / needs check) |
| `GET /api/test-center/case-stats` | Case list with effort and efficiency aggregates |
| `GET/POST /api/test-center/case-schedule/:id` | Read / update a case's planned and actual dates |
| `POST /api/test-center/results` | Update test result counts on progress rows |
| `POST /api/test-center/achievement/:id/comment` | Update the comment on an achievement row |
| **Test Center — bugs** ||
| `GET /api/test-center/bugs` | Whole bug list |
| `GET /api/test-center/bugs/by-case/:caseId` | Bugs for one case, plus selectable field options |
| `GET /api/test-center/bugs/single/:id` | One bug record |
| `GET /api/test-center/bugs/:id/children` | Bug detail child page rendered as HTML |
| `POST /api/test-center/bugs/:id/update` | Update remarks / judgment / status / priority |
| `GET /api/test-center/bug-leak` | Incident (bug leak) aggregate for the report |
| `POST /api/test-center/bug-leak/:id/update` | Update one incident record |
| `GET /api/test-center/notion-image` | Proxy a Notion S3 image as a data URI (amazonaws.com only) |
| **Test Center — history** ||
| `GET /api/test-center/history` | List saved plan / report snapshots |
| `GET /api/test-center/history/:id` | One snapshot including its HTML body |
| `POST /api/test-center/history` | Save a snapshot |
| `DELETE /api/test-center/history/:id` | Archive a snapshot |
| **Test cases** ||
| `GET /api/testcase/list` | Test cases for a system + year (both required) |
| `GET /api/testcase/:id/bug-context` | Candidate cases / numbering / defaults for the bug transfer dialog |
| `POST /api/testcase/:id/transfer-bug` | Create a bug record from a test case |
| `POST /api/testcase/:id/update` | Update editable fields of a test case |
| `DELETE /api/testcase/:id` | Archive a test case |
| `POST /api/testcase/export` | Export the filtered rows as xlsx |
| `GET /api/testcase/bug-status` | Which test cases already have a transferred bug |
| `GET /api/test-center/case-testcases/:caseId` | Test cases linked to a case |
| `GET /api/testcase-format/systems` | System names available for upload |
| `POST /api/testcase-format` | CSV → formatted xlsx, and register to Notion when system+year given |
| **Data collection** ||
| `GET /api/jiji-list` | 時事速報 list (Notion) |
| `GET /api/jiemian-list` | 界面新聞 list (Notion) |
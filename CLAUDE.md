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

---

## Architecture

This is a **full-stack TypeScript monorepo** — a single Express server serves both the REST API and the Vite-built React frontend.

### Entry Points

| Environment | Entry | Notes |
|------------|-------|-------|
| Development | `server.ts` | Wraps Vite dev middleware + Express |
| Production/Vercel | `api/index.ts` | Express app as a serverless function |

### Request Flow

```
Browser → Vite dev server (port 5173)
         → /api/* proxy → Express (server.ts → api/index.ts)
         → All other routes → React SPA (src/App.tsx)
```

On Vercel, `vercel.json` rewrites `/api/*` → `/api/index` (90s timeout, 1024MB).

### Backend (`api/index.ts`)

All API routes live in one file. File uploads use **in-memory storage only** (`multer.memoryStorage`) — no disk I/O, which is required for Vercel serverless.

Key routes:
- `POST /api/upload` — Detect file type (Excel/PDF) and return metadata
- `POST /api/convert` — Excel → Markdown (ExcelJS)
- `POST /api/pdf-convert` — PDF → Word (Adobe PDF Services SDK)
- `POST /api/pdf-merge` — Merge PDFs (pdf-lib)
- `GET/POST /api/test-center` — Notion DB integration for test progress
- `POST /api/jiji-search` — Japanese news scraping (Playwright via Browserless)

### Frontend (`src/`)

`App.tsx` is the view router — it holds the current view string and renders the active component. Navigation categories ('文档类', '管理类', 'データ収集类') filter which tools appear on `Home.tsx`.

`useFileUpload` hook (`src/hooks/useFileUpload.ts`) handles drag-drop, format validation, and upload state for all file-processing components.

### Key External Dependencies

| Service | Env Var | Used For |
|---------|---------|----------|
| Adobe PDF Services | `PDF_SERVICES_CLIENT_ID` / `PDF_SERVICES_CLIENT_SECRET` | PDF → Word conversion |
| Notion API | `NOTION_API_KEY` / `NOTION_PROGRESS_DATABASE_ID` | Test Center dashboard |
| Browserless | `BROWSERLESS_TOKEN` | Headless browser for data collection |
| Jiji (時事速報) | `JIJI_LOGIN_ID` / `JIJI_PASSWORD` | Japanese news scraping |

### TestCenter (`src/components/TestCenter.tsx`)

The largest component (~66KB). It pulls structured test progress data from a Notion database, organized by project area (jmotto, univ, overseas, credit, etc.) with fields for estimated hours, actual hours, test counts, and bug counts. Supports HTML report generation and save history.

### Docker

`Dockerfile` uses `node:20-slim` + Python 3 with `pdf2docx` and `opencv-python-headless` (system libs: `libgl1`, `libglib2.0-0`). The Python scripts (`convert_pdf.py`, `merge_pdf.py`) are legacy fallbacks — the app now uses Adobe PDF Services SDK instead.

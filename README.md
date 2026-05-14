# RakuRakuToolkit

A multi-functional tool suite built with React + TypeScript + Express, providing document processing and data collection utilities.

## Features

### 文档类 — Document Tools
- **Excel → Markdown** — Convert Excel files to Markdown tables, with image extraction and shape text recognition
- **PDF → Word** — Convert PDF files to editable Word documents
- **PDF Merge** — Upload multiple PDFs, drag to reorder, then merge and download as a single file
- **PDF Editor** — Click text regions in a PDF to edit content (supports Chinese and Japanese), then download the modified file

### 管理类 — Management Tools
- **Test Center** — Testing management dashboard, organized by area/module

### データ収集类 — Data Collection Tools
- **データ収集** — Automatically collect news and web content (时事速报, 界面新闻, etc.) filtered by keyword, date, and region

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS v4 |
| Animation | Motion (Framer Motion) |
| Backend | Express, tsx |
| PDF | pdf-lib, pdfjs-dist, Adobe PDF Services SDK |
| Excel | ExcelJS |
| Deploy | Vercel + Docker |

## Getting Started

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Copy environment variables and fill in your API keys
cp .env.example .env.local

# Start the development server
npm run dev
```

## Environment Variables

See [.env.example](.env.example) for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key (used for PDF/document processing) |
| `PDF_SERVICES_CLIENT_ID` | Adobe PDF Services client ID |
| `PDF_SERVICES_CLIENT_SECRET` | Adobe PDF Services client secret |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Express + Vite HMR) |
| `npm run build` | Build frontend for production |
| `npm start` | Start production server |
| `npm run lint` | TypeScript type check |

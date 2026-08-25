/**
 * Vercel serverless entry point.
 * Contains ALL Express routes. server.ts imports this for local dev (adds Vite + listen).
 *
 * All file processing uses multer memoryStorage — no disk I/O, works across any Lambda instance.
 */
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Client } from "@notionhq/client";
import { PDFDocument } from "pdf-lib";
import {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  ExportPDFJob,
  ExportPDFParams,
  ExportPDFTargetFormat,
  ExportPDFResult,
  ExtractPDFJob,
  ExtractPDFParams,
  ExtractPDFResult,
  ExtractElementType,
} from "@adobe/pdfservices-node-sdk";
import { PassThrough } from "stream";

// Loads .env in local dev; Vercel injects env vars at runtime, dotenv.config() is a no-op there
dotenv.config();

const app = express();
const notion = process.env.NOTION_API_KEY ? new Client({ auth: process.env.NOTION_API_KEY }) : null;
// 結果報告(BUG付き)は画像をbase64で埋め込むためHTMLが数MBになる。
// 履歴保存(POST /history)が既定の100kb上限を超えて413になるのを防ぐ。
app.use(express.json({ limit: "25mb" }));

// All file processing uses in-memory storage — avoids any cross-invocation /tmp dependency
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

// ── Helpers ───────────────────────────────────────────────────────────

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function mergePDFBuffers(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

async function convertPdfToWordBuffer(pdfBuffer: Buffer): Promise<Buffer> {
  const credentials = new ServicePrincipalCredentials({
    clientId: process.env.ADOBE_CLIENT_ID!,
    clientSecret: process.env.ADOBE_CLIENT_SECRET!,
  });
  const pdfServices = new PDFServices({ credentials });

  const passThrough = new PassThrough();
  passThrough.end(pdfBuffer);
  const inputAsset = await pdfServices.upload({ readStream: passThrough, mimeType: MimeType.PDF });

  const params = new ExportPDFParams({ targetFormat: ExportPDFTargetFormat.DOCX });
  const job = new ExportPDFJob({ inputAsset, params });

  const pollingURL = await pdfServices.submit({ job });
  const jobResponse = await pdfServices.getJobResult({ pollingURL, resultType: ExportPDFResult });

  if (!jobResponse.result) throw new Error("Adobe PDF Services returned empty result");

  const streamAsset = await pdfServices.getContent({ asset: jobResponse.result.asset });
  return streamToBuffer(streamAsset.readStream);
}

// ── PDF テーブル構造抽出 (技術検証) ───────────────────────────────────
// Adobe Extract API から structuredData.json を取得し、Path から表構造を復元する。
// Path 例: //Document/Table[1]/TR[2]/TD[3]/P  → 1番目の表・2行目・3列目
// Bounds は PDF ポイント単位で [left, bottom, right, top]

type ExtractedCell = {
  row: number;      // 1-based
  col: number;      // 1-based
  text: string;
  bounds: number[] | null;
  isHeader: boolean; // TH かどうか
};
type ExtractedTable = {
  index: number;    // Table[n] の n
  page: number;     // 0-based (Adobe の Page に準拠)
  rows: number;
  cols: number;
  bounds: number[] | null; // 表全体の外形 (セルから算出)
  cells: ExtractedCell[];
};

function parseAdobeTables(elements: any[]): ExtractedTable[] {
  // Table[n] ごとにセルを集約
  const tableMap = new Map<number, ExtractedTable>();

  for (const el of elements ?? []) {
    const path: string = el?.Path ?? "";
    // TR/TD(または TH) を含む要素のみ対象
    const m = path.match(/\/Table(?:\[(\d+)\])?\/TR(?:\[(\d+)\])?\/(TD|TH)(?:\[(\d+)\])?/);
    if (!m) continue;
    const tIdx = m[1] ? Number(m[1]) : 1;
    const row = m[2] ? Number(m[2]) : 1;
    const isHeader = m[3] === "TH";
    const col = m[4] ? Number(m[4]) : 1;

    let t = tableMap.get(tIdx);
    if (!t) {
      t = { index: tIdx, page: el?.Page ?? 0, rows: 0, cols: 0, bounds: null, cells: [] };
      tableMap.set(tIdx, t);
    }
    const text = String(el?.Text ?? "").trim();
    const bounds = Array.isArray(el?.Bounds) ? el.Bounds : null;

    // 同一セルが複数要素(P が複数)に分割される場合はテキストを連結
    const found = t.cells.find((c) => c.row === row && c.col === col);
    if (found) {
      if (text) found.text = found.text ? `${found.text} ${text}` : text;
      if (!found.bounds && bounds) found.bounds = bounds;
    } else {
      t.cells.push({ row, col, text, bounds, isHeader });
    }
    t.rows = Math.max(t.rows, row);
    t.cols = Math.max(t.cols, col);
  }

  // 表全体の外形をセル群から算出
  for (const t of tableMap.values()) {
    const withB = t.cells.filter((c) => c.bounds && c.bounds.length === 4);
    if (withB.length > 0) {
      const l = Math.min(...withB.map((c) => c.bounds![0]));
      const b = Math.min(...withB.map((c) => c.bounds![1]));
      const r = Math.max(...withB.map((c) => c.bounds![2]));
      const tp = Math.max(...withB.map((c) => c.bounds![3]));
      t.bounds = [l, b, r, tp];
    }
    t.cells.sort((a, b2) => a.row - b2.row || a.col - b2.col);
  }

  return Array.from(tableMap.values()).sort((a, b) => a.page - b.page || a.index - b.index);
}

async function extractPdfTables(pdfBuffer: Buffer): Promise<{ tables: ExtractedTable[]; elementCount: number }> {
  const credentials = new ServicePrincipalCredentials({
    clientId: process.env.ADOBE_CLIENT_ID!,
    clientSecret: process.env.ADOBE_CLIENT_SECRET!,
  });
  const pdfServices = new PDFServices({ credentials });

  const passThrough = new PassThrough();
  passThrough.end(pdfBuffer);
  const inputAsset = await pdfServices.upload({ readStream: passThrough, mimeType: MimeType.PDF });

  const params = new ExtractPDFParams({
    elementsToExtract: [ExtractElementType.TEXT, ExtractElementType.TABLES],
  });
  const job = new ExtractPDFJob({ inputAsset, params });

  const pollingURL = await pdfServices.submit({ job });
  const jobResponse = await pdfServices.getJobResult({ pollingURL, resultType: ExtractPDFResult });
  if (!jobResponse.result) throw new Error("Adobe Extract returned empty result");

  // contentJSON があればそれを使う (無ければ content アセットから取得)
  let json: any = (jobResponse.result as any).contentJSON;
  if (!json) {
    const contentAsset = (jobResponse.result as any).content;
    if (!contentAsset) throw new Error("Adobe Extract: JSON が取得できませんでした");
    const streamAsset = await pdfServices.getContent({ asset: contentAsset });
    const buf = await streamToBuffer(streamAsset.readStream);
    json = JSON.parse(buf.toString("utf8"));
  }

  const elements: any[] = json?.elements ?? [];
  return { tables: parseAdobeTables(elements), elementCount: elements.length };
}

app.post("/api/pdf-extract-tables", upload.single("file"), async (req, res) => {
  if (!process.env.ADOBE_CLIENT_ID || !process.env.ADOBE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Adobe PDF Services API credentials not configured" });
  }
  const f = req.file as Express.Multer.File | undefined;
  if (!f) return res.status(400).json({ error: "No file provided" });
  try {
    const { tables, elementCount } = await extractPdfTables(f.buffer);
    return res.json({
      fileName: Buffer.from(f.originalname, "latin1").toString("utf8"),
      tableCount: tables.length,
      elementCount,
      tables,
    });
  } catch (error) {
    console.error("PDF table extract error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "テーブル抽出に失敗しました",
    });
  }
});

type TestCenterArea = "jmotto" | "univ" | "overseas" | "credit" | "jmotto-app" | "univ-app" | "univ-contents" | "nayose" | "gyoshu" | "ros" | "meikancho";

type ProgressItem = {
  id: string;
  month: string;
  projectName: string;
  status: string;
  estimateTotal: string;
  actualTotal: string;
  developmentEffort: string;
  tcStartDate: string;
  tcDesignCompleteDate: string;
  tcExecutionCompleteDate: string;
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
  unexpectedNgCount: string;
  japanCaseCount: string;
  japanBugCount: string;
  designEstimate: string;
  implementationEstimate: string;
  executionEstimate: string;
  reviewEstimate: string;
  actualStartDate: string;
  actualDesignCompleteDate: string;
  actualExecutionCompleteDate: string;
  system: string;
  assignee: string;
  manager: string;
  designActual: string;
  implActual: string;
  execActual: string;
  reviewActual: string;
  childProjectIds: string[];
};

type ResultUpdateItem = {
  id: string;
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
  unexpectedNgCount: string;
  japanCaseCount: string;
  japanBugCount: string;
};

function richTextToPlainText(richText: any[] = []): string {
  return richText.map((item) => item?.plain_text ?? "").join("").trim();
}

function propertyToPlainText(property: any): string {
  if (!property || typeof property !== "object") return "";

  switch (property.type) {
    case "title":
      return richTextToPlainText(property.title);
    case "rich_text":
      return richTextToPlainText(property.rich_text);
    case "number":
      return property.number == null ? "" : String(property.number);
    case "select":
      return property.select?.name ?? "";
    case "multi_select":
      return Array.isArray(property.multi_select)
        ? property.multi_select.map((item: any) => item?.name).filter(Boolean).join(", ")
        : "";
    case "status":
      return property.status?.name ?? "";
    case "checkbox":
      return property.checkbox ? "✓" : "";
    case "formula":
      if (!property.formula) return "";
      if (property.formula.type === "string") return property.formula.string ?? "";
      if (property.formula.type === "number") {
        return property.formula.number == null ? "" : String(property.formula.number);
      }
      if (property.formula.type === "boolean") return String(!!property.formula.boolean);
      if (property.formula.type === "date") return property.formula.date?.start ?? "";
      return "";
    case "date":
      return property.date?.start ?? "";
    case "people":
      return Array.isArray(property.people)
        ? property.people.map((person: any) => person?.name ?? person?.id).filter(Boolean).join(", ")
        : "";
    default:
      return "";
  }
}

function pickProperty(properties: Record<string, any>, names: string[]): any {
  for (const name of names) {
    if (properties[name] !== undefined) return properties[name];
  }
  return undefined;
}

function stripSpaces(s: string): string {
  return s.replace(/[\s　]/g, '');
}

function findDateProperty(properties: Record<string, any>, keywords: string[]): any {
  for (const kw of keywords) {
    if (properties[kw] !== undefined) return properties[kw];
  }
  for (const [name, prop] of Object.entries(properties)) {
    const norm = stripSpaces(name);
    if (keywords.some(kw => norm === stripSpaces(kw))) return prop;
  }
  for (const [name, prop] of Object.entries(properties)) {
    if ((prop?.type === 'date' || prop?.type === 'formula') && keywords.some(kw => stripSpaces(name).includes(stripSpaces(kw).replace(/日$/, '')))) {
      return prop;
    }
  }
  return undefined;
}

function parseProgressItem(page: any): ProgressItem {
  const properties = page?.properties ?? {};
  const childProjectIds = extractChildProjectIds(properties);
  return {
    id: page?.id ?? "",
    month: propertyToPlainText(properties["月次"]),
    projectName: propertyToPlainText(properties["案件名"]),
    status: propertyToPlainText(properties["状態"]),
    estimateTotal: propertyToPlainText(properties["見積総"]),
    actualTotal: propertyToPlainText(properties["実績総"]),
    developmentEffort: propertyToPlainText(properties["開発工数"]),
    tcStartDate: propertyToPlainText(properties["TC開始予定日"]),
    tcDesignCompleteDate: propertyToPlainText(properties["TC設計書完了予定日"]),
    tcExecutionCompleteDate: propertyToPlainText(properties["TC実施完了予定日"]),
    testTotalCount: propertyToPlainText(properties["Test総件数"]),
    bugCount: propertyToPlainText(properties["NG数"]),
    testBlockedCount: propertyToPlainText(properties["Test不可"]),
    pendingConfirmCount: propertyToPlainText(properties["確認中件数"]),
    unexpectedNgCount: propertyToPlainText(properties["想定外NG数"]),
    japanCaseCount: propertyToPlainText(properties["日本側case数"]),
    japanBugCount: propertyToPlainText(properties["日本側NG数"]),
    designEstimate: propertyToPlainText(
      pickProperty(properties, ["工数見積(設計書)", "工数見積(設計書)", "工数見積(設計)", "工数見積(設計)"])
    ),
    implementationEstimate: propertyToPlainText(
      pickProperty(properties, ["工数見積(実装)", "工数見積(実装)"])
    ),
    executionEstimate: propertyToPlainText(
      pickProperty(properties, ["工数見積(実施)", "工数見積(実施)"])
    ),
    reviewEstimate: propertyToPlainText(
      pickProperty(properties, ["review見積工数", "Review見積工数", "レビュー見積工数", "review見積工数"])
    ),
    actualStartDate: propertyToPlainText(
      findDateProperty(properties, ["実際開始日", "実績開始日", "実際TC開始日", "TC実際開始日"])
    ),
    actualDesignCompleteDate: propertyToPlainText(
      findDateProperty(properties, ["実際設計書完了日", "実績設計書完了日", "実際TC設計書完了日", "TC実際設計書完了日"])
    ),
    actualExecutionCompleteDate: propertyToPlainText(
      findDateProperty(properties, ["実際実施完了日", "実績実施完了日", "実際TC実施完了日", "TC実際実施完了日"])
    ),
    system: propertyToPlainText(properties["System"]),
    assignee: propertyToPlainText(pickProperty(properties, ["担当者", "担当"])),
    manager: propertyToPlainText(pickProperty(properties, ["管理者", "管理"])),
    designActual: propertyToPlainText(pickProperty(properties, ["工数実績(設計書)", "工数実績(設計書) ", "工数実績(設計)"])),
    implActual: propertyToPlainText(pickProperty(properties, ["工数実績(実装)", "工数実績(実装) "])),
    execActual: propertyToPlainText(pickProperty(properties, ["工数実績(実施)", "工数実績(実施) "])),
    reviewActual: propertyToPlainText(pickProperty(properties, ["review実績工数", "Review実績工数", "レビュー実績工数"])),
    childProjectIds,
  };
}

function extractRelationIds(property: any): string[] {
  if (!property || property.type !== "relation" || !Array.isArray(property.relation)) return [];
  return property.relation
    .map((relation: any) => relation?.id)
    .filter((id: string | undefined): id is string => !!id);
}

function extractChildProjectIds(properties: Record<string, any>): string[] {
  const directProperty = properties["子级 项目"];
  if (directProperty) return extractRelationIds(directProperty);

  const fallbackEntry = Object.entries(properties).find(([name, value]) => {
    if (value?.type !== "relation") return false;
    const normalized = name.trim().toLowerCase();
    return normalized.includes("子级") || normalized.includes("子項目") || normalized.includes("sub");
  });
  if (!fallbackEntry) return [];
  return extractRelationIds(fallbackEntry[1]);
}

function isItemInArea(area: TestCenterArea, systemValue: string): boolean {
  const normalized = systemValue.trim().toLowerCase();
  const tokens = normalized
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const includesToken = (value: string) => tokens.includes(value.toLowerCase());
  const matchesAny = (aliases: string[]) => aliases.some((alias) => normalized === alias || includesToken(alias));

  switch (area) {
    case "jmotto":
      return matchesAny(["jmottoポータル"]);
    case "univ":
      return matchesAny(["univ2"]);
    case "overseas":
      return matchesAny(["海外調書", "海外调书"]);
    case "credit":
      return matchesAny(["企業情報", "企業信用情報", "企业信用情报", "企业信息"]);
    case "jmotto-app":
      return matchesAny(["jmottoアプリ"]);
    case "univ-app":
      return matchesAny(["univアプリ", "univ アプリ"]);
    case "univ-contents":
      return matchesAny(["univcontents"]);
    case "nayose":
      return matchesAny(["名寄せアプリ", "名寄せ"]);
    case "gyoshu":
      return matchesAny(["業種別", "业种别"]);
    case "ros":
      return matchesAny(["与信ROS"]);
    case "meikancho":
      return matchesAny(["名館長クラウド", "名館長"]);
    default:
      return false;
  }
}

function toNotionNumberValue(rawValue: string, fieldName: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return parsed;
}

function buildUpdatableProperty(property: any, rawValue: string, fieldName: string): any {
  if (!property || typeof property !== "object") {
    throw new Error(`Notion property "${fieldName}" is missing`);
  }

  switch (property.type) {
    case "number":
      return { number: toNotionNumberValue(rawValue, fieldName) };
    case "rich_text": {
      const content = rawValue.trim();
      return { rich_text: content ? [{ type: "text", text: { content } }] : [] };
    }
    case "select": {
      const name = rawValue.trim();
      return { select: name ? { name } : null };
    }
    case "status": {
      const name = rawValue.trim();
      return { status: name ? { name } : null };
    }
    default:
      throw new Error(`Notion property "${fieldName}" type "${property.type}" is not writable by this tool`);
  }
}

async function queryAllProgressItems(databaseId: string): Promise<ProgressItem[]> {
  if (!notion) return [];

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) {
    throw new Error("No data source found in NOTION_PROGRESS_DATABASE_ID");
  }

  const items: ProgressItem[] = [];
  let hasMore = true;
  let nextCursor: string | undefined = undefined;

  while (hasMore) {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: nextCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      items.push(parseProgressItem(page));
    }

    hasMore = response.has_more;
    nextCursor = response.next_cursor ?? undefined;
  }

  return items;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Notion のレート制限(約3 req/s)を避けるため、ページ取得を少数ずつ直列化し、
// rate_limited は指数バックオフで再試行する。
async function retrievePageWithRetry(pageId: string, maxRetries = 4): Promise<ProgressItem | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const page = await notion!.pages.retrieve({ page_id: pageId });
      return parseProgressItem(page);
    } catch (error: any) {
      if (error?.code === "rate_limited" && attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      console.error(`Failed to retrieve Notion page ${pageId}:`, error);
      return null;
    }
  }
}

async function retrievePagesByIds(pageIds: string[]): Promise<ProgressItem[]> {
  if (!notion || pageIds.length === 0) return [];

  const uniquePageIds = Array.from(new Set(pageIds));
  const CONCURRENCY = 3; // 同時実行数を制限してレート制限を回避
  const results: (ProgressItem | null)[] = [];
  for (let i = 0; i < uniquePageIds.length; i += CONCURRENCY) {
    const chunk = uniquePageIds.slice(i, i + CONCURRENCY);
    const part = await Promise.all(chunk.map((id) => retrievePageWithRetry(id)));
    results.push(...part);
  }

  return results.filter((page): page is ProgressItem => !!page);
}

// ── History storage (Notion-backed) ───────────────────────────────────
// Stores TestCenter HTML history (plan / report PDFs). A child database
// named HISTORY_DB_NAME is created under NOTION_HISTORY_PARENT_PAGE_ID on
// first use. HTML body is split into <= 1900-char code blocks because
// each Notion rich_text segment is capped at 2000 chars.

const HISTORY_DB_NAME = "TestCenter History";
const HISTORY_CHUNK_SIZE = 1900;
const HISTORY_BLOCKS_PER_APPEND = 90; // Notion accepts up to 100 children per call
let cachedHistoryDatabaseId: string | null = null;

type HistoryEntry = {
  id: string;
  type: "plan" | "report";
  areaId: string;
  monthKey: string;
  title: string;
  savedAt: string; // ISO
};

type HistoryEntryWithBody = HistoryEntry & { htmlContent: string };

async function findChildDatabase(parentPageId: string, name: string): Promise<string | null> {
  if (!notion) return null;
  let cursor: string | undefined = undefined;
  do {
    const res: any = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results as any[]) {
      if (block.type === "child_database" && block.child_database?.title === name) {
        return block.id as string;
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return null;
}

async function ensureHistoryDatabase(): Promise<string> {
  if (!notion) throw new Error("Notion client not configured");
  if (cachedHistoryDatabaseId) return cachedHistoryDatabaseId;

  const parentPageId = process.env.NOTION_HISTORY_PARENT_PAGE_ID;
  if (!parentPageId) {
    throw new Error("NOTION_HISTORY_PARENT_PAGE_ID is not set");
  }

  const existing = await findChildDatabase(parentPageId, HISTORY_DB_NAME);
  if (existing) {
    cachedHistoryDatabaseId = existing;
    return existing;
  }

  const created: any = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: HISTORY_DB_NAME } }],
    initial_data_source: {
      properties: {
        title: { title: {} },
        type: {
          select: {
            options: [
              { name: "plan", color: "gray" },
              { name: "report", color: "blue" },
            ],
          },
        },
        areaId: { select: { options: [] } },
        monthKey: { rich_text: {} },
        entryId: { rich_text: {} },
        savedAt: { date: {} },
      },
    } as any,
  });

  cachedHistoryDatabaseId = created.id as string;
  return cachedHistoryDatabaseId!;
}

async function getHistoryDataSourceId(): Promise<string> {
  if (!notion) throw new Error("Notion client not configured");
  const dbId = await ensureHistoryDatabase();
  const database: any = await notion.databases.retrieve({ database_id: dbId });
  const dsId = database?.data_sources?.[0]?.id as string | undefined;
  if (!dsId) throw new Error("History database has no data source");
  return dsId;
}

function chunkHtml(html: string, size = HISTORY_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < html.length; i += size) {
    chunks.push(html.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [""];
}

function parseHistoryProps(page: any): HistoryEntry {
  const props = page?.properties ?? {};
  const titleArr = props.title?.title ?? [];
  const title = titleArr.map((t: any) => t.plain_text ?? "").join("");
  const typeVal = props.type?.select?.name === "report" ? "report" : "plan";
  const areaId = props.areaId?.select?.name ?? "";
  const monthArr = props.monthKey?.rich_text ?? [];
  const monthKey = monthArr.map((t: any) => t.plain_text ?? "").join("");
  const entryArr = props.entryId?.rich_text ?? [];
  const entryId = entryArr.map((t: any) => t.plain_text ?? "").join("");
  const savedAt = props.savedAt?.date?.start ?? new Date().toISOString();
  return {
    id: entryId || page.id,
    type: typeVal,
    areaId,
    monthKey,
    title,
    savedAt,
  };
}

async function readHistoryBody(pageId: string): Promise<string> {
  if (!notion) return "";
  let cursor: string | undefined = undefined;
  const parts: string[] = [];
  do {
    const res: any = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results as any[]) {
      if (block.type === "code") {
        const rt = block.code?.rich_text ?? [];
        for (const t of rt) parts.push(t.plain_text ?? "");
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return parts.join("");
}

async function appendHtmlBlocks(pageId: string, html: string): Promise<void> {
  if (!notion) return;
  const chunks = chunkHtml(html);
  for (let i = 0; i < chunks.length; i += HISTORY_BLOCKS_PER_APPEND) {
    const batch = chunks.slice(i, i + HISTORY_BLOCKS_PER_APPEND).map((chunk) => ({
      object: "block" as const,
      type: "code" as const,
      code: {
        language: "html" as const,
        rich_text: [{ type: "text" as const, text: { content: chunk } }],
      },
    }));
    await notion.blocks.children.append({
      block_id: pageId,
      children: batch as any,
    });
  }
}

// Look up a Notion page in the history DB by our internal entry id (rich_text "entryId")
async function findHistoryPageByEntryId(entryId: string): Promise<string | null> {
  if (!notion) return null;
  const dsId = await getHistoryDataSourceId();
  const res: any = await notion.dataSources.query({
    data_source_id: dsId,
    filter: { property: "entryId", rich_text: { equals: entryId } } as any,
    page_size: 1,
  });
  const page = res.results?.[0];
  return page ? (page.id as string) : null;
}

// ── Routes ────────────────────────────────────────────────────────────

app.get("/api/pdf-status", (_req, res) => {
  const ready = !!(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET);
  res.json({ ready, error: ready ? null : "Adobe API credentials not configured" });
});

app.get("/api/test-center", async (req, res) => {
  const area = req.query.area as TestCenterArea | undefined;
  const validAreas: TestCenterArea[] = ["jmotto", "univ", "overseas", "credit", "jmotto-app", "univ-app", "univ-contents", "nayose", "gyoshu", "ros", "meikancho"];
  if (!area || !validAreas.includes(area)) {
    return res.status(400).json({ error: "Invalid area parameter" });
  }

  const databaseId = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_PROGRESS_DATABASE_ID",
    });
  }

  try {
    const allItems = await queryAllProgressItems(databaseId);
    const parentItems = allItems
      .filter((item) => isItemInArea(area, item.system))
      .filter((item) => item.childProjectIds.length > 0);

    const childIds = parentItems.flatMap((item) => item.childProjectIds);
    const childItems = await retrievePagesByIds(childIds);

    const areaItems = childItems
      .filter((item) => item.childProjectIds.length === 0)
      .map(({
        id,
        month,
        projectName,
        status,
        estimateTotal,
        actualTotal,
        developmentEffort,
        tcStartDate,
        tcDesignCompleteDate,
        tcExecutionCompleteDate,
        actualStartDate,
        actualDesignCompleteDate,
        actualExecutionCompleteDate,
        testTotalCount,
        bugCount,
        testBlockedCount,
        pendingConfirmCount,
        unexpectedNgCount,
        japanCaseCount,
        japanBugCount,
        designEstimate,
        implementationEstimate,
        executionEstimate,
        reviewEstimate,
      }) => ({
        id,
        month,
        projectName,
        status,
        estimateTotal,
        actualTotal,
        developmentEffort,
        tcStartDate,
        tcDesignCompleteDate,
        tcExecutionCompleteDate,
        actualStartDate,
        actualDesignCompleteDate,
        actualExecutionCompleteDate,
        testTotalCount,
        bugCount,
        testBlockedCount,
        pendingConfirmCount,
        unexpectedNgCount,
        japanCaseCount,
        japanBugCount,
        designEstimate,
        implementationEstimate,
        executionEstimate,
        reviewEstimate,
      }));

    return res.json({ area, total: areaItems.length, items: areaItems });
  } catch (error) {
    console.error("Test center query error:", error);
    return res.status(500).json({ error: "Failed to query Notion progress database" });
  }
});

// 親案件のリレーションを辿り、エリア付きの「葉」案件(実データを持つ子案件)を解決する。
// overview と case-stats で共用。
async function resolveLeafCases(databaseId: string): Promise<{ item: ProgressItem; areaId: TestCenterArea }[]> {
  const allAreas: TestCenterArea[] = ["jmotto", "univ", "overseas", "credit", "jmotto-app", "univ-app", "univ-contents", "nayose", "gyoshu", "ros", "meikancho"];
  const allItems = await queryAllProgressItems(databaseId);
  // 子案件は同じ進捗DBの行なので、全件取得結果から id 引きできる。
  // これにより pages.retrieve の大量発行(=レート制限/遅延)を回避する。
  const byId = new Map(allItems.map((it) => [it.id, it]));

  const childAreaMap = new Map<string, TestCenterArea>();
  for (const area of allAreas) {
    const parents = allItems.filter((item) => isItemInArea(area, item.system) && item.childProjectIds.length > 0);
    for (const parent of parents) {
      for (const childId of parent.childProjectIds) {
        if (!childAreaMap.has(childId)) childAreaMap.set(childId, area);
      }
    }
  }

  const childIds = Array.from(childAreaMap.keys());
  // まず全件結果から解決し、見つからない id のみ個別取得(フォールバック)
  const childItems: ProgressItem[] = [];
  const missingIds: string[] = [];
  for (const id of childIds) {
    const found = byId.get(id);
    if (found) childItems.push(found);
    else missingIds.push(id);
  }
  if (missingIds.length > 0) {
    childItems.push(...(await retrievePagesByIds(missingIds)));
  }

  return childItems
    .filter((item) => item.childProjectIds.length === 0)
    .map((item) => ({ item, areaId: childAreaMap.get(item.id) }))
    .filter((x): x is { item: ProgressItem; areaId: TestCenterArea } => !!x.areaId);
}

app.get("/api/test-center/overview", async (_req, res) => {
  const databaseId = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_PROGRESS_DATABASE_ID",
    });
  }

  try {
    const leaves = await resolveLeafCases(databaseId);
    const overviewItems = leaves.map(({ item, areaId }) => ({
      id: item.id,
      areaId,
      month: item.month,
      status: item.status,
      projectName: item.projectName,
      bugCount: item.bugCount,
      testTotalCount: item.testTotalCount,
    }));
    return res.json({ items: overviewItems, total: overviewItems.length });
  } catch (error) {
    console.error("Test center overview error:", error);
    return res.status(500).json({ error: "Failed to query Notion progress overview" });
  }
});

// 案件別統計: 葉案件 + 実績表(関連案件 relation で 1:1 join)
app.get("/api/test-center/case-stats", async (_req, res) => {
  const databaseId = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_PROGRESS_DATABASE_ID",
    });
  }

  try {
    const leaves = await resolveLeafCases(databaseId);

    // 実績表を case id で引ける map に (関連案件 relation, 1:1 想定)
    const achMap = new Map<string, AchievementItem>();
    const achievementDbId = process.env.NOTION_ACHIEVEMENT_DATABASE_ID;
    if (achievementDbId) {
      try {
        const achItems = await queryAllAchievementItems(achievementDbId);
        for (const ach of achItems) {
          for (const caseId of ach.relatedCaseIds) {
            if (!achMap.has(caseId)) achMap.set(caseId, ach);
          }
        }
      } catch (e) {
        console.error("case-stats achievement join failed:", e);
      }
    }

    const items = leaves.map(({ item, areaId }) => {
      const ach = achMap.get(item.id);
      return {
        id: item.id,
        areaId,
        month: item.month,
        projectName: item.projectName,
        status: item.status,
        system: item.system,
        assignee: item.assignee,
        manager: item.manager,
        estimateTotal: item.estimateTotal,
        actualTotal: item.actualTotal,
        developmentEffort: item.developmentEffort,
        testTotalCount: item.testTotalCount,
        bugCount: item.bugCount,
        testBlockedCount: item.testBlockedCount,
        pendingConfirmCount: item.pendingConfirmCount,
        unexpectedNgCount: item.unexpectedNgCount,
        designActual: item.designActual,
        implActual: item.implActual,
        execActual: item.execActual,
        reviewActual: item.reviewActual,
        comment: ach?.comment ?? "", // 備考 = 実績表のコメント
        commentId: ach?.id ?? "", // コメント更新先 = 実績表ページID (無ければ編集不可)
        // 実績表 join (無ければ空文字)
        expectedCase: ach?.expectedCase ?? "",
        expectedNg: ach?.expectedNg ?? "",
        japanNgCount: ach?.japanNgCount ?? "",
        japanTestCount: ach?.japanTestCount ?? "",
        tcNgCount: ach?.tcNgCount ?? "",
      };
    });

    return res.json({ items, total: items.length });
  } catch (error) {
    console.error("Case stats error:", error);
    return res.status(500).json({ error: "Failed to query Notion case stats" });
  }
});

// 案件一覧の備考(実績表「コメント」)を更新。id = 実績表ページID
app.post("/api/test-center/achievement/:id/comment", async (req, res) => {
  if (!notion) {
    return res.status(503).json({ error: "Notion API credentials not configured" });
  }
  const comment = String((req.body ?? {}).comment ?? "");
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const properties = (page as any)?.properties ?? {};
    const next = { ["コメント"]: buildUpdatableProperty(properties["コメント"], comment, "コメント") };
    await notion.pages.update({ page_id: req.params.id, properties: next });
    return res.json({ success: true });
  } catch (error) {
    console.error("Achievement comment update error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update comment" });
  }
});

// ── BUG流出 (NOTION_BUGLEAK_DATABASE_ID) ────────────────────────────────
// サービス=システム、責任(checkbox)=テストセンター関連、案件別(YYYYMM)=期間
type BugLeakItem = {
  system: string;
  responsible: boolean;
  caseMonth: string;
  cmdb: string;
  feature: string;
  defect: string;
  process: string;
  category: string;
  cause: string;
  releaseTime: string;
  tcResult: string;
  status: string;
  improvable: string;
  checklist: string;
};

function parseBugLeakItem(page: any): BugLeakItem {
  const p = page?.properties ?? {};
  const resp = p["責任"];
  return {
    system: propertyToPlainText(p["サービス"]),
    responsible: resp?.type === "checkbox" ? !!resp.checkbox : false,
    caseMonth: propertyToPlainText(p["案件別"]),
    cmdb: propertyToPlainText(p["CMDB番号"]),
    feature: propertyToPlainText(p["機能(画面)名"]),
    defect: propertyToPlainText(p["障害内容"]),
    process: propertyToPlainText(p["指摘工程"]),
    category: propertyToPlainText(p["指摘分類"]),
    cause: propertyToPlainText(pickProperty(p, ["原因区分（要件定義、設計、実装）", "原因区分"])),
    releaseTime: propertyToPlainText(p["リリース時期"]),
    tcResult: propertyToPlainText(p["TestCenter確認結果"]),
    status: propertyToPlainText(p["状態"]),
    improvable: propertyToPlainText(p["改善可/不可"]),
    checklist: propertyToPlainText(p["チェックリスト"]),
  };
}

async function queryAllBugLeakItems(databaseId: string): Promise<BugLeakItem[]> {
  if (!notion) return [];
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) throw new Error("No data source found in NOTION_BUGLEAK_DATABASE_ID");
  const pages: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;
  while (hasMore) {
    const r: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...r.results);
    hasMore = r.has_more;
    cursor = r.next_cursor ?? undefined;
  }
  return pages.map(parseBugLeakItem);
}

// 案件一覧の品質下部「BUG流出」集計。year 必須、month 省略時は通年。
app.get("/api/test-center/bug-leak", async (req, res) => {
  const databaseId = process.env.NOTION_BUGLEAK_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_BUGLEAK_DATABASE_ID",
    });
  }
  const year = req.query.year ? Number(req.query.year) : null;
  const month = req.query.month ? Number(req.query.month) : null;
  try {
    const items = await queryAllBugLeakItems(databaseId);
    const filtered = items.filter((it) => {
      const m = (it.caseMonth || "").match(/^(\d{4})(\d{2})$/);
      if (!m) return false;
      if (year !== null && Number(m[1]) !== year) return false;
      if (month !== null && Number(m[2]) !== month) return false;
      return true;
    });
    const total = filtered.length;
    const tcRelated = filtered.filter((it) => it.responsible).length;
    const bySystemMap = new Map<string, number>();
    for (const it of filtered) {
      const s = it.system || "(未設定)";
      bySystemMap.set(s, (bySystemMap.get(s) ?? 0) + 1);
    }
    const bySystem = Array.from(bySystemMap.entries())
      .map(([system, count]) => ({ system, count }))
      .sort((a, b) => b.count - a.count);
    return res.json({ total, tcRelated, bySystem, items: filtered });
  } catch (error) {
    console.error("Bug-leak query error:", error);
    return res.status(500).json({ error: "Failed to query Notion bug-leak database" });
  }
});

// ── Monthly report (実績表 data source) ─────────────────────────────────
// Queries the 実績表 Notion DB (NOTION_ACHIEVEMENT_DATABASE_ID) filtered by
// year + month + selected systems. 年度 / 月次 are formula(number) fields.

type AchievementItem = {
  id: string;
  system: string;
  year: number | null;
  month: number | null;
  cmdb: string;
  content: string;
  testType: string;
  testCount: string;
  validNg: string;
  japanNgCount: string;
  expectedCase: string;
  expectedNg: string;
  planEffort: string;
  actualEffort: string;
  idealCaseDiff: string;
  idealNgDiff: string;
  execTestCount: string;
  efficiency: string;
  tcNgCount: string;
  japanTestCount: string;
  comment: string;
  relatedCaseIds: string[];
  comments: string[];
};

function parseAchievementItem(page: any): AchievementItem {
  const p = page?.properties ?? {};
  const yearText = propertyToPlainText(p["年度"]);
  const monthText = propertyToPlainText(p["月次"]);
  return {
    id: page?.id ?? "",
    system: propertyToPlainText(p["システム"]),
    year: yearText ? Number(yearText) : null,
    month: monthText ? Number(monthText) : null,
    cmdb: propertyToPlainText(p["CMDB"]),
    content: propertyToPlainText(p["テスト内容"]),
    testType: propertyToPlainText(p["テスト種類"]),
    testCount: propertyToPlainText(p["TCテスト件数"]),
    validNg: propertyToPlainText(p["有効NG数"]),
    japanNgCount: propertyToPlainText(p["日本実施テストNG件数"]),
    expectedCase: propertyToPlainText(p["想定ケース数"]),
    expectedNg: propertyToPlainText(p["想定NG数"]),
    planEffort: propertyToPlainText(p["テスト予定工数(人日)"]),
    actualEffort: propertyToPlainText(p["テスト実績工数(人日)"]),
    idealCaseDiff: propertyToPlainText(p["理想ケース差10以上はNG"]),
    idealNgDiff: propertyToPlainText(p["理想NG差1以上はNG"]),
    execTestCount: propertyToPlainText(p["実施テスト件数0以下はNG"]),
    efficiency: propertyToPlainText(p["テストケース数/1人日"]),
    tcNgCount: propertyToPlainText(pickProperty(p, ["TCNG数", "TC NG数", "TCNG件数"])),
    japanTestCount: propertyToPlainText(pickProperty(p, ["日本実施テスト件数", "日本テスト件数"])),
    comment: propertyToPlainText(p["コメント"]),
    relatedCaseIds: extractRelationIds(pickProperty(p, ["関連案件", "関連案件（案件）", "案件"])),
    comments: [],
  };
}

async function queryAllAchievementItems(databaseId: string): Promise<AchievementItem[]> {
  if (!notion) return [];

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) {
    throw new Error("No data source found in NOTION_ACHIEVEMENT_DATABASE_ID");
  }

  const items: AchievementItem[] = [];
  let hasMore = true;
  let nextCursor: string | undefined = undefined;

  while (hasMore) {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: nextCursor,
      page_size: 100,
    });
    for (const page of response.results) {
      items.push(parseAchievementItem(page));
    }
    hasMore = response.has_more;
    nextCursor = response.next_cursor ?? undefined;
  }

  return items;
}

// ── Bug list (全体バグ一覧表 data source) ───────────────────────────────
// NOTION_BUG_DATABASE_ID の「全体バグ一覧表」を取得。システム/月次は rollup、
// テスト案件名は relation（リレーション先のタイトルを解決）、担当者は実施者(created_by)。

type BugItem = {
  id: string;
  no: string;
  system: string;
  module: string;
  priority: string;
  testCaseName: string;
  bugDesc: string;
  judgment: string;
  status: string;
  execDate: string;
  assignee: string;
  month: string;
  reproSteps: string;
  expectedResult: string;
  actualResult: string;
  remarks: string;
  caseNumber: string;
  browserVersion: string;
  appVersion: string;
};

function rollupToText(prop: any): string {
  if (!prop || prop.type !== "rollup") return "";
  const arr = prop.rollup?.array ?? [];
  const parts: string[] = [];
  for (const el of arr) {
    if (el.type === "multi_select") parts.push(...(el.multi_select ?? []).map((o: any) => o?.name).filter(Boolean));
    else if (el.type === "select") parts.push(el.select?.name ?? "");
    else if (el.type === "status") parts.push(el.status?.name ?? "");
    else if (el.type === "number") parts.push(el.number == null ? "" : String(el.number));
    else if (el.type === "rich_text") parts.push(richTextToPlainText(el.rich_text));
    else if (el.type === "title") parts.push(richTextToPlainText(el.title));
    else if (el.type === "formula") {
      const f = el.formula;
      if (f?.type === "string") parts.push(f.string ?? "");
      else if (f?.type === "number") parts.push(f.number == null ? "" : String(f.number));
    }
  }
  return parts.filter(Boolean).join(", ");
}

function createdByName(prop: any): string {
  if (!prop || prop.type !== "created_by") return "";
  return prop.created_by?.name ?? "";
}

function parseBugItem(page: any, relMap: Map<string, string>): BugItem {
  const p = page?.properties ?? {};
  const relIds: string[] = (p["テスト案件名"]?.relation ?? []).map((r: any) => r.id);
  const testCaseName = relIds.map((rid) => relMap.get(rid) ?? "").filter(Boolean).join(", ");
  return {
    id: page?.id ?? "",
    no: propertyToPlainText(p["No"]),
    system: rollupToText(p["システム"]),
    module: propertyToPlainText(p["モジュール"]),
    priority: propertyToPlainText(p["優先度"]),
    testCaseName,
    bugDesc: propertyToPlainText(p["Bug説明"]),
    judgment: propertyToPlainText(p["判定"]),
    status: propertyToPlainText(p["ステータス"]),
    execDate: propertyToPlainText(p["実施日"]),
    assignee: createdByName(p["実施者"]),
    month: rollupToText(p["月次"]),
    reproSteps: propertyToPlainText(p["再現ステップ"]),
    expectedResult: propertyToPlainText(p["予定結果"]),
    actualResult: propertyToPlainText(p["実際結果"]),
    remarks: propertyToPlainText(p["備考"]),
    caseNumber: propertyToPlainText(p["ケース番号"]),
    browserVersion: propertyToPlainText(p["ブラウザ / バージョン"]),
    appVersion: propertyToPlainText(p["アプリバージョン"]),
  };
}

async function queryAllBugItems(databaseId: string): Promise<BugItem[]> {
  if (!notion) return [];

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) {
    throw new Error("No data source found in NOTION_BUG_DATABASE_ID");
  }

  const pages: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;
  while (hasMore) {
    const r: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...r.results);
    hasMore = r.has_more;
    cursor = r.next_cursor ?? undefined;
  }

  // テスト案件名(relation) のタイトルを重複排除して解決
  const relIds = new Set<string>();
  for (const pg of pages) {
    for (const r of pg.properties?.["テスト案件名"]?.relation ?? []) relIds.add(r.id);
  }
  const relMap = new Map<string, string>();
  await Promise.all(
    Array.from(relIds).map(async (rid) => {
      try {
        const rp: any = await notion!.pages.retrieve({ page_id: rid });
        const titleProp: any = Object.values(rp.properties ?? {}).find((v: any) => v.type === "title");
        relMap.set(rid, richTextToPlainText(titleProp?.title));
      } catch {
        relMap.set(rid, "");
      }
    })
  );

  return pages.map((pg) => parseBugItem(pg, relMap));
}

// 特定案件(caseId=進捗管理ページID)に紐づくバグのみを relation フィルタで取得。
// 前端では「テスト案件名」列を表示しないため relation タイトルは解決しない(軽量化)。
async function queryBugsByCaseId(databaseId: string, caseId: string): Promise<BugItem[]> {
  if (!notion) return [];
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) {
    throw new Error("No data source found in NOTION_BUG_DATABASE_ID");
  }
  const pages: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;
  while (hasMore) {
    const r: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: "テスト案件名", relation: { contains: caseId } } as any,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...r.results);
    hasMore = r.has_more;
    cursor = r.next_cursor ?? undefined;
  }
  const emptyRelMap = new Map<string, string>();
  return pages.map((pg) => parseBugItem(pg, emptyRelMap));
}

// バグDBの 判定/ステータス/優先度 の選択肢を取得 (編集用ドロップダウン)
async function getBugFieldOptions(
  databaseId: string
): Promise<{ judgment: string[]; status: string[]; priority: string[] }> {
  const empty = { judgment: [], status: [], priority: [] };
  if (!notion) return empty;
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) return empty;
  const ds: any = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
  const props = ds?.properties ?? {};
  const opts = (name: string): string[] => {
    const p = props[name];
    if (!p) return [];
    if (p.type === "select") return (p.select?.options ?? []).map((o: any) => o.name).filter(Boolean);
    if (p.type === "status") return (p.status?.options ?? []).map((o: any) => o.name).filter(Boolean);
    return [];
  };
  return { judgment: opts("判定"), status: opts("ステータス"), priority: opts("優先度") };
}

function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function richTextToHtml(rich: any[] = []): string {
  return (rich ?? [])
    .map((t: any) => {
      let s = escapeHtml(t?.plain_text ?? "");
      const a = t?.annotations ?? {};
      if (a.code) s = `<code>${s}</code>`;
      if (a.bold) s = `<strong>${s}</strong>`;
      if (a.italic) s = `<em>${s}</em>`;
      if (a.strikethrough) s = `<s>${s}</s>`;
      if (a.underline) s = `<u>${s}</u>`;
      if (t?.href) s = `<a href="${escapeHtml(t.href)}" target="_blank" rel="noopener">${s}</a>`;
      return s;
    })
    .join("");
}

async function imageUrlToDataUri(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch image: ${r.status}`);
  const contentType = r.headers.get("content-type") ?? "image/png";
  const buffer = Buffer.from(await r.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function renderTableBlock(tableId: string): Promise<string> {
  if (!notion) return "";
  const r: any = await notion.blocks.children.list({ block_id: tableId, page_size: 100 });
  const rows = (r.results ?? []).filter((b: any) => b.type === "table_row");
  const trs = rows
    .map(
      (row: any) =>
        `<tr>${(row.table_row?.cells ?? []).map((cell: any) => `<td>${richTextToHtml(cell)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table class="notion-table">${trs}</table>`;
}

async function renderBlocksToHtml(blockId: string, depth = 0): Promise<string> {
  if (!notion || depth > 4) return "";
  let cursor: string | undefined = undefined;
  let hasMore = true;
  let html = "";
  let listBuffer = "";
  let listTag = "";
  const flushList = () => {
    if (listBuffer) {
      html += `<${listTag}>${listBuffer}</${listTag}>`;
      listBuffer = "";
      listTag = "";
    }
  };

  while (hasMore) {
    const r: any = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    for (const b of r.results as any[]) {
      const t = b.type;
      const c = b[t];
      const childHtml = b.has_children && t !== "table" ? await renderBlocksToHtml(b.id, depth + 1) : "";

      if (t === "bulleted_list_item" || t === "numbered_list_item") {
        const tag = t === "numbered_list_item" ? "ol" : "ul";
        if (listTag && listTag !== tag) flushList();
        listTag = tag;
        listBuffer += `<li>${richTextToHtml(c.rich_text)}${childHtml}</li>`;
        continue;
      }
      flushList();

      switch (t) {
        case "paragraph":
          html += `<p>${richTextToHtml(c.rich_text)}</p>`;
          break;
        case "heading_1":
          html += `<h3>${richTextToHtml(c.rich_text)}</h3>`;
          break;
        case "heading_2":
          html += `<h4>${richTextToHtml(c.rich_text)}</h4>`;
          break;
        case "heading_3":
          html += `<h5>${richTextToHtml(c.rich_text)}</h5>`;
          break;
        case "to_do":
          html += `<p>${c.checked ? "☑" : "☐"} ${richTextToHtml(c.rich_text)}</p>`;
          break;
        case "quote":
          html += `<blockquote>${richTextToHtml(c.rich_text)}</blockquote>`;
          break;
        case "callout":
          html += `<div class="callout">${richTextToHtml(c.rich_text)}${childHtml}</div>`;
          break;
        case "code":
          html += `<pre><code>${escapeHtml((c.rich_text ?? []).map((x: any) => x.plain_text).join(""))}</code></pre>`;
          break;
        case "divider":
          html += "<hr/>";
          break;
        case "image": {
          const url = c.type === "external" ? c.external?.url : c.file?.url;
          if (url) html += `<img src="${escapeHtml(url)}" alt="" />`;
          break;
        }
        case "table":
          html += await renderTableBlock(b.id);
          break;
        default:
          if (c?.rich_text) html += `<p>${richTextToHtml(c.rich_text)}</p>`;
          break;
      }
    }
    hasMore = r.has_more;
    cursor = r.has_more ? r.next_cursor : undefined;
  }
  flushList();
  return html;
}

app.get("/api/test-center/bugs", async (_req, res) => {
  const databaseId = process.env.NOTION_BUG_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_BUG_DATABASE_ID",
    });
  }
  try {
    const items = await queryAllBugItems(databaseId);
    return res.json({ items, total: items.length });
  } catch (error) {
    console.error("Bug list query error:", error);
    return res.status(500).json({ error: "Failed to query Notion bug database" });
  }
});

// 特定案件に紐づくバグ一覧 (案件詳細画面の「関連バグ一覧」用)
app.get("/api/test-center/bugs/by-case/:caseId", async (req, res) => {
  const databaseId = process.env.NOTION_BUG_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_BUG_DATABASE_ID",
    });
  }
  try {
    const [items, fieldOptions] = await Promise.all([
      queryBugsByCaseId(databaseId, req.params.caseId),
      getBugFieldOptions(databaseId),
    ]);
    items.sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }));
    return res.json({ items, total: items.length, fieldOptions });
  } catch (error) {
    console.error("Bug by-case query error:", error);
    return res.status(500).json({ error: "Failed to query bugs for case" });
  }
});

// バグの 備考(確認結果)/判定/ステータス/優先度 を更新
app.post("/api/test-center/bugs/:id/update", async (req, res) => {
  if (!notion) {
    return res.status(503).json({ error: "Notion API credentials not configured" });
  }
  const body = (req.body ?? {}) as {
    remarks?: string;
    judgment?: string;
    status?: string;
    priority?: string;
  };
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const properties = (page as any)?.properties ?? {};
    const next: Record<string, any> = {};
    if (body.remarks !== undefined) next["備考"] = buildUpdatableProperty(properties["備考"], body.remarks ?? "", "備考");
    if (body.judgment !== undefined) next["判定"] = buildUpdatableProperty(properties["判定"], body.judgment ?? "", "判定");
    if (body.status !== undefined) next["ステータス"] = buildUpdatableProperty(properties["ステータス"], body.status ?? "", "ステータス");
    if (body.priority !== undefined) next["優先度"] = buildUpdatableProperty(properties["優先度"], body.priority ?? "", "優先度");
    if (Object.keys(next).length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }
    await notion.pages.update({ page_id: req.params.id, properties: next });
    return res.json({ success: true });
  } catch (error) {
    console.error("Bug update error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update bug" });
  }
});

// 子ページ（バグ詳細ページ）の本文を簡易 HTML で返す
app.get("/api/test-center/bugs/:id/children", async (req, res) => {
  if (!notion) {
    return res.status(503).json({ error: "Notion API credentials not configured" });
  }
  try {
    const html = await renderBlocksToHtml(req.params.id);
    return res.json({ html });
  } catch (error) {
    console.error("Bug children error:", error);
    return res.status(500).json({ error: "Failed to load bug detail children" });
  }
});

// Proxy a single Notion-hosted image and return it inlined as a base64 data URI.
// Used by the HTML export so downloaded reports stay viewable after Notion's
// ~1h pre-signed S3 URLs expire. One image per request keeps each response well
// under Vercel's 4.5MB body limit.
app.get("/api/test-center/notion-image", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return res.status(400).json({ error: "Missing url" });

  let host = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("protocol");
    host = parsed.hostname;
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  // Only proxy Notion's own uploaded files (S3). External images keep their
  // original URL on the client. This also prevents SSRF against arbitrary hosts.
  if (!host.endsWith(".amazonaws.com")) {
    return res.status(400).json({ error: "Host not allowed" });
  }

  try {
    const dataUri = await imageUrlToDataUri(url);
    return res.json({ dataUri });
  } catch (error) {
    console.error("Notion image proxy error:", error);
    return res.status(502).json({ error: "Failed to fetch image" });
  }
});

app.post("/api/test-center/results", async (req, res) => {
  if (!notion) {
    return res.status(503).json({ error: "Notion API credentials not configured" });
  }

  const updates = req.body?.updates as ResultUpdateItem[] | undefined;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "updates is required" });
  }

  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const update of updates) {
    try {
      if (!update?.id) {
        throw new Error("id is required");
      }

      const page = await notion.pages.retrieve({ page_id: update.id });
      const properties = (page as any)?.properties ?? {};

      const nextProperties = {
        ["Test総件数"]: buildUpdatableProperty(properties["Test総件数"], update.testTotalCount ?? "", "Test総件数"),
        ["NG数"]: buildUpdatableProperty(properties["NG数"], update.bugCount ?? "", "NG数"),
        ["Test不可"]: buildUpdatableProperty(properties["Test不可"], update.testBlockedCount ?? "", "Test不可"),
        ["確認中件数"]: buildUpdatableProperty(
          properties["確認中件数"],
          update.pendingConfirmCount ?? "",
          "確認中件数"
        ),
        ["想定外NG数"]: buildUpdatableProperty(
          properties["想定外NG数"],
          update.unexpectedNgCount ?? "",
          "想定外NG数"
        ),
        ["日本側case数"]: buildUpdatableProperty(
          properties["日本側case数"],
          update.japanCaseCount ?? "",
          "日本側case数"
        ),
        ["日本側NG数"]: buildUpdatableProperty(
          properties["日本側NG数"],
          update.japanBugCount ?? "",
          "日本側NG数"
        ),
      };

      await notion.pages.update({
        page_id: update.id,
        properties: nextProperties,
      });

      results.push({ id: update.id, success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      results.push({ id: update?.id ?? "", success: false, error: message });
    }
  }

  const failed = results.filter((result) => !result.success);
  const ok = failed.length === 0;
  const payload = { ok, updated: results.length - failed.length, failed: failed.length, results };
  return res.status(ok ? 200 : 207).json(payload);
});

// ── History endpoints (Notion-backed) ────────────────────────────────

function historyConfigGuard(res: express.Response): boolean {
  if (!notion) {
    res.status(503).json({ error: "Notion API credentials not configured" });
    return false;
  }
  if (!process.env.NOTION_HISTORY_PARENT_PAGE_ID) {
    res.status(503).json({
      error: "NOTION_HISTORY_PARENT_PAGE_ID is not set",
      detail: "Create a Notion page, share it with the integration, and set its ID in .env",
    });
    return false;
  }
  return true;
}

// List all history entries (metadata only — no HTML body)
app.get("/api/test-center/history", async (_req, res) => {
  if (!historyConfigGuard(res)) return;
  try {
    const dsId = await getHistoryDataSourceId();
    const items: HistoryEntry[] = [];
    let cursor: string | undefined = undefined;
    do {
      const r: any = await notion!.dataSources.query({
        data_source_id: dsId,
        sorts: [{ property: "savedAt", direction: "descending" }],
        start_cursor: cursor,
        page_size: 100,
      });
      for (const page of r.results as any[]) items.push(parseHistoryProps(page));
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
    return res.json({ items });
  } catch (error) {
    console.error("History list error:", error);
    return res.status(500).json({
      error: "Failed to load history",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Fetch a single entry by our internal entryId (includes HTML body)
app.get("/api/test-center/history/:id", async (req, res) => {
  if (!historyConfigGuard(res)) return;
  try {
    const entryId = req.params.id;
    const pageId = await findHistoryPageByEntryId(entryId);
    if (!pageId) return res.status(404).json({ error: "Entry not found" });

    const page: any = await notion!.pages.retrieve({ page_id: pageId });
    const meta = parseHistoryProps(page);
    const htmlContent = await readHistoryBody(pageId);
    const payload: HistoryEntryWithBody = { ...meta, htmlContent };
    return res.json(payload);
  } catch (error) {
    console.error("History fetch error:", error);
    return res.status(500).json({
      error: "Failed to load history entry",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Create a new entry. Body: { id, type, areaId, monthKey, title, savedAt, htmlContent }
app.post("/api/test-center/history", async (req, res) => {
  if (!historyConfigGuard(res)) return;
  try {
    const body = req.body ?? {};
    const entryId = String(body.id ?? "").trim();
    const type = body.type === "report" ? "report" : "plan";
    const areaId = String(body.areaId ?? "").trim();
    const monthKey = String(body.monthKey ?? "").trim();
    const title = String(body.title ?? "").trim();
    const savedAt = body.savedAt ? new Date(body.savedAt).toISOString() : new Date().toISOString();
    const htmlContent = String(body.htmlContent ?? "");

    if (!entryId || !areaId || !title) {
      return res.status(400).json({ error: "id, areaId, and title are required" });
    }

    const dsId = await getHistoryDataSourceId();

    // Create the page (metadata only first; HTML appended as children below)
    const created: any = await notion!.pages.create({
      parent: { type: "data_source_id", data_source_id: dsId } as any,
      properties: {
        title: { title: [{ type: "text", text: { content: title } }] },
        type: { select: { name: type } },
        areaId: { select: { name: areaId } },
        monthKey: { rich_text: [{ type: "text", text: { content: monthKey } }] },
        entryId: { rich_text: [{ type: "text", text: { content: entryId } }] },
        savedAt: { date: { start: savedAt } },
      } as any,
    });

    if (htmlContent) {
      await appendHtmlBlocks(created.id, htmlContent);
    }

    return res.json({ ok: true, id: entryId });
  } catch (error) {
    console.error("History create error:", error);
    return res.status(500).json({
      error: "Failed to save history entry",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Delete (archive) an entry by entryId
app.delete("/api/test-center/history/:id", async (req, res) => {
  if (!historyConfigGuard(res)) return;
  try {
    const entryId = req.params.id;
    const pageId = await findHistoryPageByEntryId(entryId);
    if (!pageId) return res.status(404).json({ error: "Entry not found" });
    await notion!.pages.update({ page_id: pageId, archived: true } as any);
    return res.json({ ok: true });
  } catch (error) {
    console.error("History delete error:", error);
    return res.status(500).json({
      error: "Failed to delete history entry",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Upload: parse file metadata (sheet names for Excel) — file bytes are NOT stored server-side.
// Client holds the original File objects and re-sends them on the convert/merge request.
app.post("/api/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  try {
    const results = await Promise.all(
      files.map(async (file) => {
        const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");

        if (originalName.endsWith(".xlsx") || originalName.endsWith(".xls")) {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
          const sheetNames = workbook.worksheets.map((ws) => ws.name);
          // Use originalName as the "filename" key since we don't save to disk
          return { filename: originalName, originalName, type: "excel" as const, sheetNames };
        } else if (originalName.endsWith(".pdf")) {
          return { filename: originalName, originalName, type: "pdf" as const };
        }
        return { filename: originalName, originalName, type: "unknown" as const, error: "Unsupported file type" };
      })
    );
    res.json({ files: results });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to read uploaded files" });
  }
});

// PDF → Word: client re-sends actual file bytes here
app.post("/api/pdf-convert", upload.array("files", 10), async (req, res) => {
  const multerFiles = req.files as Express.Multer.File[];
  if (!multerFiles || multerFiles.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }
  if (!process.env.ADOBE_CLIENT_ID || !process.env.ADOBE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Adobe PDF Services API credentials not configured" });
  }

  const downloadPath = (req.body.downloadPath as string) || "";

  try {
    const zip = new JSZip();
    const folder = downloadPath ? zip.folder(downloadPath) : zip;
    const failedFiles: string[] = [];

    for (const file of multerFiles) {
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      try {
        const docxBuffer = await convertPdfToWordBuffer(file.buffer);
        folder?.file(originalName.replace(/\.pdf$/i, ".docx"), docxBuffer);
      } catch (e) {
        console.error(`Adobe conversion error for ${originalName}:`, e);
        failedFiles.push(originalName);
      }
    }

    if (failedFiles.length === multerFiles.length) {
      return res.status(500).json({ error: `转换失败：${failedFiles.join("、")}` });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="converted_pdfs.zip"`);
    if (failedFiles.length > 0) {
      res.set("X-Failed-Files", encodeURIComponent(failedFiles.join(",")));
    }
    res.send(zipBuffer);
  } catch (error) {
    console.error("PDF convert error:", error);
    res.status(500).json({ error: "Failed to convert PDF files" });
  }
});

// PDF merge: accepts files + a JSON `pages` array specifying {fileIndex, pageIndex} per output page.
// This allows page-level reordering and deletion from multiple source PDFs.
app.post("/api/pdf-merge", upload.array("files", 20), async (req, res) => {
  const multerFiles = req.files as Express.Multer.File[];
  if (!multerFiles || multerFiles.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }

  const pagesParam = req.body.pages as string | undefined;
  let pageOrder: Array<{ fileIndex: number; pageIndex: number }> | null = null;

  if (pagesParam) {
    try {
      pageOrder = JSON.parse(pagesParam);
      if (!Array.isArray(pageOrder) || pageOrder.length === 0) {
        return res.status(400).json({ error: "pages must be a non-empty array" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid pages parameter" });
    }
  }

  const outputName = (req.body.outputName as string) || "merged.pdf";

  try {
    let mergedBuffer: Buffer;

    if (pageOrder) {
      // Page-level merge: load all PDFs, then copy only the specified pages in order
      const pdfDocs = await Promise.all(
        multerFiles.map((f) => PDFDocument.load(f.buffer as unknown as Parameters<typeof PDFDocument.load>[0]))
      );
      const merged = await PDFDocument.create();
      for (const { fileIndex, pageIndex } of pageOrder) {
        if (fileIndex < 0 || fileIndex >= pdfDocs.length) continue;
        const srcDoc = pdfDocs[fileIndex];
        if (pageIndex < 0 || pageIndex >= srcDoc.getPageCount()) continue;
        const [copiedPage] = await merged.copyPages(srcDoc, [pageIndex]);
        merged.addPage(copiedPage);
      }
      mergedBuffer = Buffer.from(await merged.save());
    } else {
      // Legacy: merge all files in upload order (file-level granularity)
      if (multerFiles.length < 2) {
        return res.status(400).json({ error: "At least 2 files are required for merging" });
      }
      mergedBuffer = await mergePDFBuffers(
        multerFiles.map((f) => f.buffer as unknown as Buffer)
      );
    }

    const filename = outputName.replace(/[^\w\u4e00-\u9fff\-_.]/g, "_");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(mergedBuffer);
  } catch (error) {
    console.error("PDF merge error:", error);
    res.status(500).json({ error: "Failed to merge PDF files" });
  }
});

// Excel → Markdown: client re-sends actual file bytes here
app.post("/api/convert", upload.array("files", 10), async (req, res) => {
  const multerFiles = req.files as Express.Multer.File[];
  if (!multerFiles || multerFiles.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }

  // sheetNames is a JSON-encoded string array. Empty array == convert all sheets.
  // Falls back to legacy `sheetName` single-value param for backwards compat.
  let sheetNames: string[] = [];
  try {
    const raw = req.body.sheetNames;
    if (typeof raw === "string" && raw.length) sheetNames = JSON.parse(raw);
  } catch { sheetNames = []; }
  if (sheetNames.length === 0) {
    const legacy = req.body.sheetName as string | undefined;
    if (legacy && legacy !== "全部") sheetNames = [legacy];
  }
  const convertAll = sheetNames.length === 0;

  try {
    // Per-file markdown payloads, keyed by display filename (.md)
    const fileMarkdowns: { name: string; markdown: string }[] = [];

    for (const file of multerFiles) {
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const fileBuffer = file.buffer;

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

      let markdown = "";
      let sheetsToConvert: ExcelJS.Worksheet[];
      if (convertAll) {
        sheetsToConvert = workbook.worksheets;
      } else {
        sheetsToConvert = [];
        const missing: string[] = [];
        for (const name of sheetNames) {
          const found = workbook.getWorksheet(name);
          if (found) sheetsToConvert.push(found);
          else missing.push(name);
        }
        if (missing.length) {
          const available = workbook.worksheets.map((ws) => ws.name).join("、");
          markdown += `> ⚠️ 文件「${originalName}」中不存在工作表：${missing.join("、")}\n> 可用工作表：${available || "（无）"}\n\n`;
        }
      }

      for (let sIdx = 0; sIdx < sheetsToConvert.length; sIdx++) {
        const worksheet = sheetsToConvert[sIdx];
        if (sIdx > 0) markdown += `\n---\n\n`;
        markdown += `## Sheet: ${worksheet.name}\n\n`;

        let allRows: string[][] = [];

        worksheet.eachRow({ includeEmpty: true }, (row) => {
          const rowData: string[] = [];
          for (let i = 1; i <= row.cellCount; i++) {
            const cell = row.getCell(i);
            let val = "";
            try {
              const v = cell.value;
              if (v === null || v === undefined) val = "";
              else if (typeof v === "object") {
                if ("richText" in v && Array.isArray(v.richText)) {
                  val = v.richText.map((rt: any) => rt.text || "").join("");
                } else if ("formula" in v) {
                  val = v.result != null ? String(v.result) : "";
                } else if (v instanceof Date) {
                  val = v.toISOString();
                } else {
                  val = JSON.stringify(v);
                }
              } else {
                val = String(v);
              }
            } catch {
              val = cell.text || "";
            }
            rowData.push(val.replace(/\|/g, "\\|").trim());
          }
          allRows.push(rowData);
        });

        // Split into blocks separated by empty rows
        const blocks: string[][][] = [];
        let cur: string[][] = [];
        for (const row of allRows) {
          if (row.every((c) => c === "")) {
            if (cur.length) { blocks.push(cur); cur = []; }
          } else {
            cur.push(row);
          }
        }
        if (cur.length) blocks.push(cur);

        for (const block of blocks) {
          const maxCols = Math.max(...block.map((r) => r.length));
          const activeCols = Array.from({ length: maxCols }, (_, j) => j).filter(
            (j) => block.some((r) => r[j] && r[j] !== "")
          );
          const rows = block.map((r) => activeCols.map((j) => r[j] || ""));
          if (!rows.length || !activeCols.length) continue;

          if (activeCols.length > 1 && rows.length > 1) {
            const fmt = (r: string[]) => `| ${r.join(" | ")} |`;
            markdown += `${fmt(rows[0])}\n`;
            markdown += `| ${Array(activeCols.length).fill("---").join(" | ")} |\n`;
            for (let i = 1; i < rows.length; i++) markdown += `${fmt(rows[i])}\n`;
            markdown += "\n";
          } else {
            for (const r of rows) {
              const line = r.filter(Boolean).join(" ");
              if (line) markdown += `${line}  \n`;
            }
            markdown += "\n";
          }
        }

        // Images: embed inline as base64 data URLs so the .md is fully self-contained
        const imgs = worksheet.getImages();
        if (imgs.length && workbook.model.media) {
          markdown += `### Images in ${worksheet.name}\n\n`;
          for (const img of imgs) {
            const media = (workbook.model.media as any)[img.imageId];
            if (media) {
              const ext = (media.extension || "png").toLowerCase();
              const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
              const b64 = Buffer.from(media.buffer).toString("base64");
              const altName = `image_${worksheet.id}_${img.imageId}.${ext}`;
              markdown += `![${altName}](data:${mime};base64,${b64})\n\n`;
            }
          }
        }
      }

      // Shape text: extracted once per file to avoid repeating across sheets
      try {
        const xlsxZip = await JSZip.loadAsync(fileBuffer);
        const drawingFiles = Object.keys(xlsxZip.files).filter((n) =>
          n.startsWith("xl/drawings/drawing")
        );
        const shapeTexts: string[] = [];
        for (const df of drawingFiles) {
          const content = await xlsxZip.file(df)?.async("string");
          content?.match(/<a:t>([^<]+)<\/a:t>/g)?.forEach((m) => {
            const t = m.replace(/<\/?a:t>/g, "");
            if (t && !shapeTexts.includes(t)) shapeTexts.push(t);
          });
        }
        if (shapeTexts.length) {
          markdown += `### Extracted Text from Shapes\n\n`;
          shapeTexts.forEach((t) => { markdown += `> ${t}\n\n`; });
        }
      } catch { /* optional */ }

      const mdName = originalName.replace(/\.(xlsx|xls)$/i, ".md");
      fileMarkdowns.push({ name: mdName, markdown });
    }

    // Single file → return the .md directly (no zip wrapping).
    // Multiple files → flat zip with one .md per source workbook.
    if (fileMarkdowns.length === 1) {
      const { name, markdown } = fileMarkdowns[0];
      const safeName = encodeURIComponent(name);
      res.set("Content-Type", "text/markdown; charset=utf-8");
      res.set(
        "Content-Disposition",
        `attachment; filename="output.md"; filename*=UTF-8''${safeName}`,
      );
      res.send(markdown);
      return;
    }

    const outZip = new JSZip();
    for (const { name, markdown } of fileMarkdowns) {
      outZip.file(name, markdown);
    }
    const zipBuffer = await outZip.generateAsync({ type: "nodebuffer" });
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="excel_conversions.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    console.error("Excel convert error:", error);
    res.status(500).json({ error: "Failed to convert Excel file" });
  }
});

// ── 時事速報 (jijinews Notion DB 読み取り) ──────────────────────────────

type JijiScreenshot = { name: string; url: string };

type JijiItem = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;   // 掲載日時 (ISO)
  url: string;
  aiSummary: string;     // AI概要 → 不安情報内容
  companyName: string;   // 会社名
  companyProfile: string; // 会社概要
  creditCode: string;    // 統一会社信用コード
  category: string;      // 不安情報分類 (自由テキスト)
  screenshots: JijiScreenshot[]; // スクリーンショット
};

function filesToScreenshots(prop: any): JijiScreenshot[] {
  if (!prop || prop.type !== "files") return [];
  return (prop.files ?? [])
    .map((f: any) => ({
      name: f?.name ?? "",
      url: f?.type === "external" ? (f.external?.url ?? "") : (f.file?.url ?? ""),
    }))
    .filter((s: JijiScreenshot) => !!s.url);
}

function parseJijiItem(page: any): JijiItem {
  const p = page?.properties ?? {};
  return {
    id: page?.id ?? "",
    title: propertyToPlainText(p["タイトル"]),
    body: propertyToPlainText(p["本文"]),
    publishedAt: p["掲載日時"]?.date?.start ?? "",
    url: p["URL"]?.url ?? "",
    aiSummary: propertyToPlainText(p["AI概要"]),
    companyName: propertyToPlainText(p["会社名"]),
    companyProfile: propertyToPlainText(p["会社概要"]),
    creditCode: propertyToPlainText(p["統一会社信用コード"]),
    category: propertyToPlainText(p["不安情報分類"]),
    screenshots: filesToScreenshots(p["スクリーンショット"]),
  };
}

async function queryAllJijiItems(databaseId: string): Promise<JijiItem[]> {
  if (!notion) return [];

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) {
    throw new Error("No data source found in NOTION_JIJI_DATABASE_ID");
  }

  const pages: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;
  while (hasMore) {
    const r: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...r.results);
    hasMore = r.has_more;
    cursor = r.next_cursor ?? undefined;
  }

  return pages.map(parseJijiItem);
}

app.get("/api/jiji-list", async (_req, res) => {
  const databaseId = process.env.NOTION_JIJI_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_JIJI_DATABASE_ID",
    });
  }
  try {
    const items = await queryAllJijiItems(databaseId);
    return res.json({ items, total: items.length });
  } catch (error) {
    console.error("Jiji list query error:", error);
    return res.status(500).json({ error: "Failed to query Notion jiji database" });
  }
});

// ── 界面新聞 (jiemian Notion DB 読み取り、jijinews と同一スキーマを再利用) ──
app.get("/api/jiemian-list", async (_req, res) => {
  const databaseId = process.env.NOTION_JIEMIAN_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.status(503).json({
      error: "Notion API credentials not configured",
      detail: "Please set NOTION_API_KEY and NOTION_JIEMIAN_DATABASE_ID",
    });
  }
  try {
    const items = await queryAllJijiItems(databaseId);
    return res.json({ items, total: items.length });
  } catch (error) {
    console.error("Jiemian list query error:", error);
    return res.status(500).json({ error: "Failed to query Notion jiemian database" });
  }
});

// ── Testcase Format (テストケース CSV を整形し Excel 出力 + 結果集計) ──

// 引用符・改行入りセルに対応した最小 CSV パーサ (UTF-8 前提, 先頭 BOM 除去)
// ユーザー入力による無制限ループ (DoS) を防ぐため、解析対象を定数上限で制限する。
// multerの50MB制限(バイト数)に合わせる: 文字数は必ずバイト数以下なので合法ファイルを弾かない。
const MAX_CSV_CHARS = 50 * 1024 * 1024;

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length > MAX_CSV_CHARS) {
    throw new Error("CSV file too large");
  }
  const len = Math.min(text.length, MAX_CSV_CHARS);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* CRLF: \n 側で処理 */ }
      else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const TESTCASE_HEADERS = [
  "ケース番号", "システム", "機能名", "要件名", "テスト内容",
  "前提", "ステップ", "予期結果", "ポイント", "優先級",
  "対応", "適用段階", "状態", "テスト結果", "作成者",
  "作成日", "更新者", "更新日", "バージョン", "関連NO", "備考",
];
const TESTCASE_COL_COUNT = TESTCASE_HEADERS.length; // 21
const RESULT_COL = 13;   // テスト結果 (0-based, CSV「结果」)
const GROUP_COL = 3;     // 要件名 (0-based, CSV「相关需求」)
const CASENO_COL = 0;    // ケース番号 (0-based, CSV「用例编号」)
const KEYWORD_COL = 8;   // ポイント (0-based, CSV「关键词」)
const REMARK_COL = 20;   // 備考 (0-based)
const SHIMATEKI_MARK = "指摘対応";

// CSV「关键词」列を ポイント / 備考 に分解する。
// - スラッシュ(半角 / ・全角 ／)で分割し、前段(head)に「指摘対応」を含めば ポイント=指摘対応・備考=後段(tail)。
//   前段に含まなければ ポイント=空・備考=元の値全体。
// - スラッシュ無しで「指摘対応」を含む場合は ポイント=指摘対応・備考=「指摘対応」以降の文字。
//   含まなければ ポイント=空・備考=元の値全体。
// - 空なら両方空。
function splitKeyword(raw: string): { point: string; remark: string } {
  const v = (raw ?? "").trim();
  if (v === "") return { point: "", remark: "" };
  const a = v.indexOf("/");
  const b = v.indexOf("／");
  const slashIdx = a === -1 ? b : b === -1 ? a : Math.min(a, b);
  if (slashIdx !== -1) {
    const head = v.slice(0, slashIdx).trim();
    const tail = v.slice(slashIdx + 1).trim();
    if (head.includes(SHIMATEKI_MARK)) return { point: SHIMATEKI_MARK, remark: tail };
    return { point: "", remark: v };
  }
  if (v.includes(SHIMATEKI_MARK)) {
    const after = v.slice(v.indexOf(SHIMATEKI_MARK) + SHIMATEKI_MARK.length).trim();
    return { point: SHIMATEKI_MARK, remark: after };
  }
  return { point: "", remark: v };
}

function mapTestResult(v: string): string {
  const s = (v ?? "").trim();
  if (s === "通过") return "OK";
  if (s === "阻塞") return "テスト不可";
  if (s === "失败") return "NG";
  if (s === "") return "未実施";
  return s;
}

type TestCaseGroupStat = {
  label: string;         // 相关需求(要件名) の値
  total: number;
  ok: number;
  block: number;
  ng: number;
  un: number;
  shimateki: number;
  blockCases: string[];
  ngCases: string[];
  unCases: string[];
  shimatekiCases: string[];
  // 画面表示用: 各結果の案件別「原因」(備考=关键词後段)
  ngReasons: { no: string; remark: string }[];
  blockReasons: { no: string; remark: string }[];
  unReasons: { no: string; remark: string }[];
};

// 1つの CSV → { xlsx バッファ, グループ統計, 出力ファイル名 }
async function buildTestCaseXlsx(originalName: string, csvText: string) {
  const rows = parseCsv(csvText);
  const dataRows = rows
    .slice(1) // 先頭は中国語ヘッダ
    .filter((r) => r.some((c) => (c ?? "").trim() !== "")); // 空行除去

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet");

  // ケース内容部分 (ヘッダ + データ行) の罫線
  const cellBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, left: { style: "thin" },
    bottom: { style: "thin" }, right: { style: "thin" },
  };

  // ヘッダ (深藍 + 白字 + 罫線)
  ws.addRow(TESTCASE_HEADERS);
  ws.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003366" } };
    cell.font = { color: { argb: "FFFFFFFF" } };
    cell.border = cellBorder;
  });

  const FILL = {
    OK: "FFD3D3D3",
    "テスト不可": "FFFFFF00",
    NG: "FFFF0000",
  } as const;

  // グループ統計 (相关需求ごと, 出現順)
  const groupMap = new Map<string, TestCaseGroupStat>();
  const groupOrder: string[] = [];

  for (const r of dataRows) {
    const out = new Array(TESTCASE_COL_COUNT).fill("");
    for (let i = 0; i < TESTCASE_COL_COUNT; i++) out[i] = r[i] ?? "";
    const mapped = mapTestResult(out[RESULT_COL]);
    out[RESULT_COL] = mapped;
    // 「关键词」列を ポイント / 備考 に分解 (備考は上書き)
    const { point, remark } = splitKeyword(r[KEYWORD_COL] ?? "");
    out[KEYWORD_COL] = point;
    out[REMARK_COL] = remark;

    const added = ws.addRow(out);
    const fillColor = (FILL as Record<string, string>)[mapped];
    added.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = cellBorder;
      if (fillColor) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      }
    });

    const key = (r[GROUP_COL] ?? "").trim();
    let g = groupMap.get(key);
    if (!g) {
      g = { label: key, total: 0, ok: 0, block: 0, ng: 0, un: 0, shimateki: 0,
        blockCases: [], ngCases: [], unCases: [], shimatekiCases: [],
        ngReasons: [], blockReasons: [], unReasons: [] };
      groupMap.set(key, g);
      groupOrder.push(key);
    }
    const caseNo = (r[CASENO_COL] ?? "").trim();
    g.total++;
    if (mapped === "OK") g.ok++;
    else if (mapped === "テスト不可") { g.block++; g.blockCases.push(caseNo); g.blockReasons.push({ no: caseNo, remark }); }
    else if (mapped === "NG") { g.ng++; g.ngCases.push(caseNo); g.ngReasons.push({ no: caseNo, remark }); }
    else if (mapped === "未実施") { g.un++; g.unCases.push(caseNo); g.unReasons.push({ no: caseNo, remark }); }
    if (point === SHIMATEKI_MARK) { g.shimateki++; g.shimatekiCases.push(caseNo); }
  }

  const baseName = originalName.replace(/\.[^.]+$/, "");
  const groups = groupOrder.map((k) => groupMap.get(k)!);

  // 統計ブロック (データ行の下, 相关需求ごと)
  const paren = (cases: string[]) => (cases.length ? ` （${cases.join(",")}）` : "");
  ws.addRow([]);
  ws.addRow([`文件名：${baseName}`]);
  groups.forEach((g, idx) => {
    ws.addRow([`用例${idx + 1}：${g.label}`]);
    ws.addRow([`テスト件数総計: ${g.total}`]);
    ws.addRow([`テストOK: ${g.ok}`]);
    ws.addRow([`テスト不可: ${g.block}${paren(g.blockCases)}`]);
    ws.addRow([`テストNG: ${g.ng}${paren(g.ngCases)}`]);
    ws.addRow([`未実施: ${g.un}${paren(g.unCases)}`]);
    ws.addRow([`指摘対応: ${g.shimateki}${paren(g.shimatekiCases)}`]);
  });

  // 列幅: ケース番号(A列)は固定10。他列は自動調整 (過大化を防ぐため上限 80)
  ws.columns.forEach((col, i) => {
    if (i === 0) { col.width = 10; return; }
    let maxLen = 0;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = cell.value == null ? 0 : String(cell.value).length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min((maxLen + 2) * 1.2, 80);
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    outputName: `【試験仕様書TestCenter】${baseName}.xlsx`,
    buffer,
    groups,
  };
}

// ── Testcase → Notion 登録 ────────────────────────────────────────────
// 親ページ配下に「{システム}{年度}」という子データベースを作り、CSV の各ケースを upsert する。
// ケース番号で突合し、差分があれば rich_text 項目を赤字にしてバージョンを +1、差分なしはスキップ。

// Notion 側の属性名と、CSV(=Excel 出力) の列インデックスの対応。
// col が null の列は CSV に対応が無いため常に空 (大分類/中分類/小分類)。
// 「対応」(col 10) は Notion 側に作らない。
type TcFieldKind = "title" | "select" | "rich_text" | "date" | "number";
type TcField = { name: string; kind: TcFieldKind; col: number | null };
const TESTCASE_NOTION_FIELDS: TcField[] = [
  { name: "ケース番号", kind: "title", col: 0 },
  { name: "システム", kind: "select", col: 1 },
  { name: "月次", kind: "select", col: null },      // アップロード時に選択した月 (行の値は選択値で固定)
  { name: "CMDB番号", kind: "rich_text", col: 3 },  // 要件名と同じ値 (要件名の書式変更時はここも追従)
  { name: "大分類", kind: "rich_text", col: null },
  { name: "中分類", kind: "rich_text", col: null },
  { name: "小分類", kind: "rich_text", col: null },
  { name: "機能名", kind: "rich_text", col: 2 },
  { name: "要件名", kind: "rich_text", col: 3 },
  { name: "テスト内容", kind: "rich_text", col: 4 },
  { name: "前提条件", kind: "rich_text", col: 5 },
  { name: "ステップ", kind: "rich_text", col: 6 },
  { name: "予期結果", kind: "rich_text", col: 7 },
  { name: "ポイント", kind: "rich_text", col: 8 },
  { name: "優先級", kind: "rich_text", col: 9 },
  { name: "カテゴリ", kind: "rich_text", col: 11 }, // CSV「適用段階」
  { name: "状態", kind: "rich_text", col: 12 },
  { name: "テスト結果", kind: "select", col: 13 },
  { name: "作成者", kind: "rich_text", col: 14 },
  { name: "作成日", kind: "date", col: 15 },
  { name: "更新者", kind: "rich_text", col: 16 },
  { name: "更新日", kind: "date", col: 17 },
  { name: "バージョン", kind: "number", col: 18 },
  { name: "関連NO", kind: "rich_text", col: 19 },
  { name: "備考", kind: "rich_text", col: 20 },
];
const TC_VERSION_FIELD = "バージョン";

// 「2026/8/3」「2026-08-03」→ ISO(YYYY-MM-DD)。解析できなければ null
function toIsoDate(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
}

// Excel 出力と同じ整形を適用した「1行 = 21列」を返す
function normalizeTestcaseRow(r: string[]): string[] {
  const out = new Array(TESTCASE_COL_COUNT).fill("");
  for (let i = 0; i < TESTCASE_COL_COUNT; i++) out[i] = (r[i] ?? "").trim();
  out[RESULT_COL] = mapTestResult(out[RESULT_COL]);
  const { point, remark } = splitKeyword(r[KEYWORD_COL] ?? "");
  out[KEYWORD_COL] = point;
  out[REMARK_COL] = remark;
  return out;
}

// Notion プロパティ値を作る。changed=true の rich_text は赤字にする
function buildTcPropertyValue(f: TcField, value: string, changed: boolean): any {
  switch (f.kind) {
    case "title":
      return { title: value ? [{ type: "text", text: { content: value } }] : [] };
    case "select":
      return { select: value ? { name: value } : null };
    case "date": {
      const iso = toIsoDate(value);
      return { date: iso ? { start: iso } : null };
    }
    case "number": {
      const n = Number(value.replace(/[^0-9.\-]/g, ""));
      return { number: Number.isFinite(n) && value !== "" ? n : null };
    }
    default:
      return {
        rich_text: value
          ? [{ type: "text", text: { content: value }, annotations: { color: changed ? "red" : "default" } }]
          : [],
      };
  }
}

// 既存ページから、比較用の素の文字列を取り出す
function readTcPlain(page: any, f: TcField): string {
  const p = page?.properties?.[f.name];
  if (!p) return "";
  if (f.kind === "date") return p.date?.start ?? "";
  if (f.kind === "number") return p.number == null ? "" : String(p.number);
  return propertyToPlainText(p);
}

// TESTCASE_NOTION_FIELDS から Notion のプロパティ定義を組み立てる
function buildTestcaseSchema(): Record<string, any> {
  const properties: Record<string, any> = {};
  for (const f of TESTCASE_NOTION_FIELDS) {
    if (f.kind === "title") properties[f.name] = { title: {} };
    else if (f.kind === "select") properties[f.name] = { select: {} };
    else if (f.kind === "date") properties[f.name] = { date: {} };
    else if (f.kind === "number") properties[f.name] = { number: {} };
    else properties[f.name] = { rich_text: {} };
  }
  return properties;
}

// 親ページ配下から「{system}{year}」のデータベースを探し、無ければ作る。
// SDK v5 (data source モデル) ではプロパティは data source 側に定義されるため、
// ページ作成・更新に使う data_source_id を返す。
// 既存テーブルに不足しているプロパティがあれば追加する (旧バージョンで作られた表への追従)。
async function ensureTestcaseDatabase(
  parentPageId: string,
  title: string
): Promise<{ databaseId: string; dataSourceId: string }> {
  if (!notion) throw new Error("Notion client not configured");

  // 親ページの子ブロックを走査して同名の child_database を探す
  let existingDbId: string | null = null;
  let cursor: string | undefined = undefined;
  do {
    const res: any = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results ?? []) {
      if (block.type === "child_database" && (block.child_database?.title ?? "").trim() === title) {
        existingDbId = block.id as string;
        break;
      }
    }
    cursor = existingDbId ? undefined : res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const schema = buildTestcaseSchema();

  if (existingDbId) {
    const db: any = await notion.databases.retrieve({ database_id: existingDbId });
    const dataSourceId = db?.data_sources?.[0]?.id as string | undefined;
    if (!dataSourceId) throw new Error(`データソースが見つかりません: ${title}`);
    // 既存プロパティを確認し、不足分のみ追加
    const ds: any = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
    const currentProps: Record<string, any> = ds?.properties ?? {};
    const existingProps = new Set(Object.keys(currentProps));
    const patch: Record<string, any> = {};

    // title プロパティは 1 つだけで型変更もできない。既定名(名前/Name 等)のままなら
    // 「ケース番号」にリネームする (別名だと未定義扱いで書き込みに失敗するため)
    if (!existingProps.has("ケース番号")) {
      const titleName = Object.entries(currentProps).find(([, def]) => (def as any)?.type === "title")?.[0];
      if (titleName) patch[titleName] = { name: "ケース番号" };
    }

    for (const [name, def] of Object.entries(schema)) {
      if (name === "ケース番号") continue; // title は上のリネームで担保
      if (!existingProps.has(name)) patch[name] = def;
    }
    if (Object.keys(patch).length > 0) {
      await (notion as any).dataSources.update({ data_source_id: dataSourceId, properties: patch });
    }
    return { databaseId: existingDbId, dataSourceId };
  }

  // 無ければ作成 (v5 では initial_data_source にスキーマを渡す)
  const created: any = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: { properties: schema },
  } as any);
  const newDsId = created?.data_sources?.[0]?.id as string | undefined;
  if (!newDsId) throw new Error(`作成したデータベースのデータソースが取得できません: ${title}`);
  return { databaseId: created.id as string, dataSourceId: newDsId };
}

// データソース内の全ページを ケース番号 → page で引けるようにする
async function loadTestcaseIndex(dataSourceId: string): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!notion) return map;
  let cursor: string | undefined = undefined;
  do {
    const r: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of r.results ?? []) {
      const no = propertyToPlainText(page?.properties?.["ケース番号"]).trim();
      if (no) map.set(no, page);
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return map;
}

type TcUploadResult = { created: number; updated: number; skipped: number };

// CSV 群を Notion の「{system}{year}」テーブルへ upsert
async function uploadTestcasesToNotion(
  parentPageId: string,
  system: string,
  year: number,
  month: number,
  csvTexts: string[]
): Promise<TcUploadResult> {
  if (!notion) throw new Error("Notion client not configured");
  const dbTitle = `${system}${year}`;
  const { dataSourceId } = await ensureTestcaseDatabase(parentPageId, dbTitle);
  const index = await loadTestcaseIndex(dataSourceId);

  const result: TcUploadResult = { created: 0, updated: 0, skipped: 0 };
  // 比較対象のフィールド (バージョンは比較しない: 更新時に +1 するため)
  const compareFields = TESTCASE_NOTION_FIELDS.filter((f) => f.name !== TC_VERSION_FIELD);

  for (const csvText of csvTexts) {
    const rows = parseCsv(csvText)
      .slice(1)
      .filter((r) => r.some((c) => (c ?? "").trim() !== ""));
    for (const raw of rows) {
      const out = normalizeTestcaseRow(raw);
      const caseNo = out[CASENO_COL];
      if (!caseNo) continue;
      const existing = index.get(caseNo);

      if (!existing) {
        const props: Record<string, any> = {};
        for (const f of TESTCASE_NOTION_FIELDS) {
          const v = f.col === null ? "" : out[f.col];
          props[f.name] = buildTcPropertyValue(f, v, false);
        }
        // システム・月次は選択された値で固定 (CSV 側の表記揺れを吸収 / CSVに月の情報が無い)
        props["システム"] = { select: { name: system } };
        props["月次"] = { select: { name: String(month) } };
        // v5 では data_source_id を parent に指定する (database_id ではプロパティが解決されない)
        await notion.pages.create({
          parent: { type: "data_source_id", data_source_id: dataSourceId } as any,
          properties: props,
        } as any);
        result.created++;
        continue;
      }

      // 差分判定
      const changedNames = new Set<string>();
      for (const f of compareFields) {
        const next = f.col === null ? "" : out[f.col];
        const nextCmp = f.kind === "date" ? (toIsoDate(next) ?? "") : next;
        const cur = readTcPlain(existing, f);
        if (nextCmp !== cur) changedNames.add(f.name);
      }
      // システム・月次は選択値で固定するため差分判定から除外
      changedNames.delete("システム");
      changedNames.delete("月次");

      if (changedNames.size === 0) {
        result.skipped++;
        continue;
      }

      const props: Record<string, any> = {};
      for (const f of TESTCASE_NOTION_FIELDS) {
        if (f.name === TC_VERSION_FIELD) continue;
        const v = f.col === null ? "" : out[f.col];
        // 変更された rich_text は赤字、それ以外は default に戻す (赤字は最新回の変更のみ示す)
        props[f.name] = buildTcPropertyValue(f, v, changedNames.has(f.name));
      }
      props["システム"] = { select: { name: system } };
      props["月次"] = { select: { name: String(month) } };
      // バージョンは Notion 側の現在値 +1
      const curVer = Number(existing?.properties?.[TC_VERSION_FIELD]?.number ?? 0);
      props[TC_VERSION_FIELD] = { number: (Number.isFinite(curVer) ? curVer : 0) + 1 };

      await notion.pages.update({ page_id: existing.id, properties: props } as any);
      result.updated++;
    }
  }
  return result;
}

// TestCase 画面用: 指定システム・年度のテーブルから全ケースを取得
app.get("/api/testcase/list", async (req, res) => {
  const system = String(req.query.system ?? "").trim();
  const year = Number(String(req.query.year ?? "").trim());
  if (!system || !Number.isFinite(year) || year <= 0) {
    return res.status(400).json({ error: "system と year は必須です" });
  }
  const parentPageId = process.env.NOTION_TESTCASE_PARENT_PAGE_ID;
  if (!notion || !parentPageId) {
    return res.status(503).json({
      error: "Notion 未設定",
      detail: "NOTION_API_KEY / NOTION_TESTCASE_PARENT_PAGE_ID を設定してください",
    });
  }
  try {
    const dbTitle = `${system}${year}`;
    // 既存テーブルのみ対象 (無い場合は空を返す。閲覧目的で新規作成はしない)
    let databaseId: string | null = null;
    let cursor: string | undefined = undefined;
    do {
      const r: any = await notion.blocks.children.list({
        block_id: parentPageId,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const block of r.results ?? []) {
        if (block.type === "child_database" && (block.child_database?.title ?? "").trim() === dbTitle) {
          databaseId = block.id as string;
          break;
        }
      }
      cursor = databaseId ? undefined : r.has_more ? r.next_cursor : undefined;
    } while (cursor);

    if (!databaseId) return res.json({ items: [], total: 0, exists: false, dbTitle });

    // v5: プロパティ/行は data source 側にあるため data_source_id を解決する
    const db: any = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = db?.data_sources?.[0]?.id as string | undefined;
    if (!dataSourceId) return res.json({ items: [], total: 0, exists: false, dbTitle });

    const index = await loadTestcaseIndex(dataSourceId);
    const items = Array.from(index.values()).map((page: any) => {
      const row: Record<string, string> = { id: page.id };
      for (const f of TESTCASE_NOTION_FIELDS) row[f.name] = readTcPlain(page, f);
      return row;
    });
    // ケース番号の数値順で安定ソート
    items.sort((a, b) =>
      (a["ケース番号"] || "").localeCompare(b["ケース番号"] || "", undefined, { numeric: true })
    );
    return res.json({ items, total: items.length, exists: true, dbTitle });
  } catch (error) {
    console.error("Testcase list error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "取得に失敗しました" });
  }
});

// 弾窓のシステム候補 (進捗管理表の System を重複排除)
app.get("/api/testcase-format/systems", async (_req, res) => {
  const databaseId = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.json({ systems: [] });
  }
  try {
    const items = await queryAllProgressItems(databaseId);
    const set = new Set<string>();
    for (const it of items) {
      const s = (it.system || "").trim();
      if (s) set.add(s);
    }
    return res.json({ systems: Array.from(set).sort() });
  } catch (error) {
    console.error("Testcase systems query error:", error);
    return res.json({ systems: [] });
  }
});

app.post("/api/testcase-format", upload.array("files", 20), async (req, res) => {
  const multerFiles = req.files as Express.Multer.File[];
  if (!multerFiles || multerFiles.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }
  try {
    const built: { outputName: string; buffer: Buffer; groups: TestCaseGroupStat[]; inputName: string }[] = [];
    const csvTexts: string[] = [];
    for (const file of multerFiles) {
      const inputName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const csvText = file.buffer.toString("utf8");
      csvTexts.push(csvText);
      const { outputName, buffer, groups } = await buildTestCaseXlsx(inputName, csvText);
      built.push({ inputName, outputName, buffer, groups });
    }

    // Notion 登録 (システム・年度が指定された場合のみ)。失敗しても Excel 出力は継続する
    const system = String((req.body as any)?.system ?? "").trim();
    const yearRaw = String((req.body as any)?.year ?? "").trim();
    const year = Number(yearRaw);
    const monthRaw = String((req.body as any)?.month ?? "").trim();
    const month = Number(monthRaw);
    let notionResult: TcUploadResult | null = null;
    let notionError: string | null = null;
    if (system && Number.isFinite(year) && year > 0 && Number.isFinite(month) && month >= 1 && month <= 12) {
      const parentPageId = process.env.NOTION_TESTCASE_PARENT_PAGE_ID;
      if (!notion || !parentPageId) {
        notionError = "Notion 未設定 (NOTION_API_KEY / NOTION_TESTCASE_PARENT_PAGE_ID)";
      } else {
        try {
          notionResult = await uploadTestcasesToNotion(parentPageId, system, year, month, csvTexts);
        } catch (e) {
          console.error("Testcase Notion upload error:", e);
          notionError = e instanceof Error ? e.message : "Notion 登録に失敗しました";
        }
      }
    }

    const results = built.map((b) => ({
      inputName: b.inputName,
      outputName: b.outputName,
      groups: b.groups,
    }));

    let downloadBase64: string;
    let downloadName: string;
    let downloadMime: string;
    if (built.length === 1) {
      downloadBase64 = built[0].buffer.toString("base64");
      downloadName = built[0].outputName;
      downloadMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const b of built) {
        // 同名 CSV が複数あっても zip 内で上書きされないよう連番を付与
        let name = b.outputName;
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf(".");
          const stem = dot >= 0 ? name.slice(0, dot) : name;
          const ext = dot >= 0 ? name.slice(dot) : "";
          let n = 1;
          do { name = `${stem}_${n}${ext}`; n++; } while (usedNames.has(name));
        }
        usedNames.add(name);
        zip.file(name, b.buffer);
      }
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      downloadBase64 = zipBuffer.toString("base64");
      downloadName = "testcase_formatted.zip";
      downloadMime = "application/zip";
    }

    return res.json({ results, downloadBase64, downloadName, downloadMime, notionResult, notionError });
  } catch (error) {
    console.error("TestCase format error:", error);
    return res.status(500).json({ error: "Failed to format testcase CSV" });
  }
});

// ── 環境バージョン設定 (Chrome / iOS / Android を Notion で一元管理) ──
// 取得できない場合のフォールバック。報告資料が欠けないよう常にこの値を返す。
const DEFAULT_ENV_VERSIONS: Record<string, string> = {
  chrome: "150.0.7871.115",
  IOS: "26.1",
  Android: "16",
};

// key → { value, comment } のマップを返す (key/value/comment 属性を持つ Notion DB を読む)
// chrome/IOS/Android の環境バージョンに加え、KPI_N_M の目標値も含む
type ConfigRow = { value: string; comment: string };
async function queryConfigTable(databaseId: string): Promise<Record<string, ConfigRow>> {
  if (!notion) return {};

  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (database as any)?.data_sources?.[0]?.id as string | undefined;
  if (!dataSourceId) {
    throw new Error("No data source found in NOTION_ENV_VERSION_DATABASE_ID");
  }

  const r: any = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: 100,
  });

  const map: Record<string, ConfigRow> = {};
  for (const page of r.results ?? []) {
    const p = page?.properties ?? {};
    const key = propertyToPlainText(p["key"]).trim();
    const value = propertyToPlainText(p["value"]).trim();
    const comment = propertyToPlainText(p["comment"]).trim();
    if (key && value) map[key] = { value, comment };
  }
  return map;
}

// KPI_N_M の行を 上期(_1)/下期(_2) に振り分ける。ラベルは comment 列から取得し、
// "上期" / "下期" 接頭辞は表示側でグループ見出しがあるため取り除く
function partitionKpiTargets(map: Record<string, ConfigRow>): {
  first: { label: string; value: string }[];
  second: { label: string; value: string }[];
} {
  const first: { label: string; value: string }[] = [];
  const second: { label: string; value: string }[] = [];
  const stripPrefix = (s: string) => s.replace(/^(上期|下期)/, '').trim();
  // key 名の N をソート順とするための補助
  const parseIndex = (key: string): number => {
    const m = key.match(/^KPI_(\d+)_[12]$/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const rows: { key: string; row: ConfigRow; suffix: '1' | '2' }[] = [];
  for (const [key, row] of Object.entries(map)) {
    if (!key.startsWith("KPI_")) continue;
    if (key.endsWith("_1")) rows.push({ key, row, suffix: '1' });
    else if (key.endsWith("_2")) rows.push({ key, row, suffix: '2' });
  }
  rows.sort((a, b) => parseIndex(a.key) - parseIndex(b.key));
  for (const { row, suffix } of rows) {
    const label = stripPrefix(row.comment) || row.comment;
    if (!label) continue;
    (suffix === '1' ? first : second).push({ label, value: row.value });
  }
  return { first, second };
}

app.get("/api/config/env-versions", async (_req, res) => {
  const databaseId = process.env.NOTION_ENV_VERSION_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.json({ ...DEFAULT_ENV_VERSIONS });
  }
  try {
    const map = await queryConfigTable(databaseId);
    // 既定値をベースに、表で取得できた chrome/IOS/Android のみ上書き
    // (KPI_ 行はここでは無視される。互換性のため既定値はそのまま返す)
    const envOnly: Record<string, string> = {};
    for (const [k, row] of Object.entries(map)) {
      if (k === "chrome" || k === "IOS" || k === "ios" || k === "Android") {
        // IOS/ios 表記の揺れを吸収して IOS に統一
        envOnly[k === "ios" ? "IOS" : k] = row.value;
      }
    }
    return res.json({ ...DEFAULT_ENV_VERSIONS, ...envOnly });
  } catch (error) {
    console.error("Env versions query error:", error);
    return res.json({ ...DEFAULT_ENV_VERSIONS });
  }
});

// KPI 目標値を取得 (案件一覧の上期/下期モードで最上方に表示)
app.get("/api/config/kpi-targets", async (_req, res) => {
  const databaseId = process.env.NOTION_ENV_VERSION_DATABASE_ID;
  if (!notion || !databaseId) {
    return res.json({ first: [], second: [] });
  }
  try {
    const map = await queryConfigTable(databaseId);
    return res.json(partitionKpiTargets(map));
  } catch (error) {
    console.error("KPI targets query error:", error);
    return res.json({ first: [], second: [] });
  }
});

export default app;


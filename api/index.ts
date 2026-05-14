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
} from "@adobe/pdfservices-node-sdk";
import { PassThrough } from "stream";
import type { Page, BrowserContext } from "playwright-core";

// Loads .env in local dev; Vercel injects env vars at runtime, dotenv.config() is a no-op there
dotenv.config();

const app = express();
const notion = process.env.NOTION_API_KEY ? new Client({ auth: process.env.NOTION_API_KEY }) : null;
app.use(express.json());

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

type TestCenterArea = "jmotto" | "univ" | "overseas" | "credit" | "jmotto-app" | "univ-app" | "univ-contents" | "nayose" | "gyoshu" | "ros";

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
  designEstimate: string;
  implementationEstimate: string;
  executionEstimate: string;
  reviewEstimate: string;
  system: string;
  childProjectIds: string[];
};

type ResultUpdateItem = {
  id: string;
  testTotalCount: string;
  bugCount: string;
  testBlockedCount: string;
  pendingConfirmCount: string;
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
    system: propertyToPlainText(properties["System"]),
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
      return matchesAny(["univ2", "univcontents", "univ"]);
    case "overseas":
      return matchesAny(["海外調書", "海外调书"]);
    case "credit":
      return matchesAny(["企業情報", "企業信用情報", "企业信用情报", "企业信息"]);
    case "jmotto-app":
      return matchesAny(["jmottoアプリ"]);
    case "univ-app":
      return matchesAny(["univアプリ", "univ アプリ"]);
    case "univ-contents":
      return matchesAny(["univcontents", "univ contents", "univコンテンツ"]);
    case "nayose":
      return matchesAny(["名寄せアプリ", "名寄せ"]);
    case "gyoshu":
      return matchesAny(["業種別", "业种别"]);
    case "ros":
      return matchesAny(["与信ROS"]);
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

async function retrievePagesByIds(pageIds: string[]): Promise<ProgressItem[]> {
  if (!notion || pageIds.length === 0) return [];

  const uniquePageIds = Array.from(new Set(pageIds));
  const pages = await Promise.all(
    uniquePageIds.map((pageId) =>
      notion.pages
        .retrieve({ page_id: pageId })
        .then((page) => parseProgressItem(page))
        .catch((error) => {
          console.error(`Failed to retrieve Notion page ${pageId}:`, error);
          return null;
        })
    )
  );

  return pages.filter((page): page is ProgressItem => !!page);
}

// ── Routes ────────────────────────────────────────────────────────────

app.get("/api/pdf-status", (_req, res) => {
  const ready = !!(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET);
  res.json({ ready, error: ready ? null : "Adobe API credentials not configured" });
});

app.get("/api/test-center", async (req, res) => {
  const area = req.query.area as TestCenterArea | undefined;
  const validAreas: TestCenterArea[] = ["jmotto", "univ", "overseas", "credit", "jmotto-app", "univ-app", "univ-contents", "nayose", "gyoshu", "ros"];
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
        testTotalCount,
        bugCount,
        testBlockedCount,
        pendingConfirmCount,
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
        testTotalCount,
        bugCount,
        testBlockedCount,
        pendingConfirmCount,
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

  const sheetName = (req.body.sheetName as string) || "全部";
  const downloadPath = (req.body.downloadPath as string) || "";

  try {
    const mainZip = new JSZip();
    const resultsFolder = downloadPath ? mainZip.folder(downloadPath) : mainZip;

    for (const file of multerFiles) {
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const fileBuffer = file.buffer;

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

      const zip = new JSZip();
      const imagesFolder = zip.folder("images");

      let markdown = "";
      let sheetsToConvert: ExcelJS.Worksheet[];
      if (sheetName === "全部") {
        sheetsToConvert = workbook.worksheets;
      } else {
        const found = workbook.getWorksheet(sheetName);
        if (!found) {
          const available = workbook.worksheets.map((ws) => ws.name).join("、");
          markdown += `> ⚠️ 文件「${originalName}」中不存在工作表「${sheetName}」。\n> 可用工作表：${available || "（无）"}\n\n`;
          sheetsToConvert = [];
        } else {
          sheetsToConvert = [found];
        }
      }

      for (const worksheet of sheetsToConvert) {
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

        // Images
        const imgs = worksheet.getImages();
        if (imgs.length && workbook.model.media) {
          markdown += `### Images in ${worksheet.name}\n\n`;
          for (const img of imgs) {
            const media = (workbook.model.media as any)[img.imageId];
            if (media) {
              const imgName = `image_${worksheet.id}_${img.imageId}.${media.extension}`;
              imagesFolder?.file(imgName, media.buffer);
              markdown += `![${imgName}](images/${imgName})\n\n`;
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

      zip.file("output.md", markdown);
      const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
      resultsFolder?.file(originalName.replace(/\.(xlsx|xls)$/i, ".zip"), zipBuf);
    }

    const mainZipBuffer = await mainZip.generateAsync({ type: "nodebuffer" });
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="excel_conversions.zip"`);
    res.send(mainZipBuffer);
  } catch (error) {
    console.error("Excel convert error:", error);
    res.status(500).json({ error: "Failed to convert Excel file" });
  }
});

// ── 時事速報 収集 ──────────────────────────────────────────────────────

const JIJI_LOGIN_URL = "https://jijiweb.jiji.jp/login/sokuhou/index.html";
const JIJI_SEARCH_URL = "https://jijiweb.jiji.jp/apps/contents/genresearch/";
const JIJI_RESULT_ROOT = "https://jijiweb.jiji.jp";

const JIJI_RESULT_SELECTORS = [
  "#resultList li",
  "article#resultList li",
  "ul.article-list li",
  ".article-list li",
];

const REGION_LABEL_MAP: Record<string, string> = {
  china: "中国",
  "beijing-tianjin": "北京・天津",
  "dalian-shenyang": "大連・瀋陽・東北",
  "qingdao-shandong": "青島・山東省",
  "shanghai-east": "上海・華東",
  "sichuan-west": "四川・中西部",
  "hongkong-south": "香港・華南",
};

const REGION_CHECKBOX_VALUE_MAP: Record<string, string> = {
  "中国": "CHN",
  "北京・天津": "PKN",
  "大連・瀋陽・東北": "DALIAN",
  "青島・山東省": "SHANDONG",
  "上海・華東": "SHH",
  "四川・中西部": "SICHUAN",
  "香港・華南": "HKG",
};

function jijiCleanText(text: string): string {
  return (text || "").replace(/[ \t]+/g, " ").trim();
}

function jijiParseTime(timeText: string): { publishedDate: string | null } {
  const m = (timeText || "").trim().match(/(\d{2,4})\/(\d{1,2})\/(\d{1,2})-(\d{1,2}):(\d{2})/);
  if (!m) return { publishedDate: null };
  let year = parseInt(m[1], 10);
  if (year < 100) year += 2000;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return {
    publishedDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function jijiExtractDetailPath(href: string): string | null {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const m = href.match(/shownews\('([^']+)'\)/);
  if (m) return new URL(m[1], JIJI_RESULT_ROOT).href;
  if (href.startsWith("/")) return new URL(href, JIJI_RESULT_ROOT).href;
  return null;
}

function jijiRegionFromTitle(title: string, regionLabels: string[]): string {
  for (const region of regionLabels) {
    if (title.includes(region)) return region;
  }
  return "";
}

async function jijiFillInput(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const cnt = await loc.count();
    if (cnt === 0) continue;
    for (let i = 0; i < cnt; i++) {
      const el = loc.nth(i);
      try {
        if (await el.isVisible() && await el.isEditable()) {
          await el.fill(value);
          return true;
        }
      } catch { continue; }
    }
  }
  return false;
}

async function jijiSetKeyword(page: Page, keyword: string): Promise<boolean> {
  const candidates = [
    "#searchFrm input[name='keyword'][type='text']",
    "#searchFrm input.search-txt",
    "#searchFrm textarea[name='keyword']",
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    const cnt = await loc.count();
    if (cnt === 0) continue;
    for (let i = 0; i < cnt; i++) {
      const el = loc.nth(i);
      try {
        if (!await el.isEditable()) continue;
        await el.fill(keyword);
        if (((await el.inputValue()) || "").trim() === keyword) return true;
      } catch { continue; }
    }
  }
  return false;
}

async function jijiClickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel);
    if (await loc.count() > 0) {
      await loc.first().click();
      return true;
    }
  }
  return false;
}

async function jijiEnsureTermselectFromto(page: Page): Promise<boolean> {
  const radios = page.locator("#searchFrm input[type='radio'][name='termselect'][value='fromto']");
  if (await radios.count() === 0) return false;
  const cnt = await radios.count();
  for (let i = 0; i < cnt; i++) {
    const r = radios.nth(i);
    try { await r.click({ force: true }); } catch { /* ignore */ }
    try { await r.check({ force: true }); } catch { /* ignore */ }
  }
  for (let i = 0; i < cnt; i++) {
    try { if (await radios.nth(i).isChecked()) return true; } catch { continue; }
  }
  return false;
}

async function jijiSetSelectByName(page: Page, name: string, value: number | string): Promise<boolean> {
  const selects = page.locator(`#searchFrm select[name='${name}']`);
  if (await selects.count() === 0) return false;
  const optionVal = String(value);
  let anyOk = false;
  const cnt = await selects.count();
  for (let i = 0; i < cnt; i++) {
    const sel = selects.nth(i);
    try {
      const ok = await sel.evaluate(
        (el: HTMLSelectElement, val: string) => {
          const has = Array.from(el.options).some(o => o.value === val);
          if (!has) return false;
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        optionVal,
      );
      if (!ok) await sel.selectOption(optionVal, { force: true });
      anyOk = true;
    } catch { continue; }
  }
  return anyOk;
}

async function jijiGetSelectValue(page: Page, name: string): Promise<string | null> {
  const select = page.locator(`#searchFrm select[name='${name}']`);
  if (await select.count() === 0) return null;
  try {
    return await select.first().evaluate((el: HTMLSelectElement) => String(el.value));
  } catch { return null; }
}

async function jijiVerifyDateRange(
  page: Page,
  start: { year: number; month: number; day: number },
  end: { year: number; month: number; day: number },
): Promise<{ ok: boolean; msg: string }> {
  const expected: Record<string, string> = {
    termStartYear: String(start.year),
    termStartMonth: String(start.month),
    termStartDay: String(start.day),
    termEndYear: String(end.year),
    termEndMonth: String(end.month),
    termEndDay: String(end.day),
  };
  const mismatches: string[] = [];
  for (const [k, v] of Object.entries(expected)) {
    const actual = await jijiGetSelectValue(page, k);
    if (actual !== v) mismatches.push(`${k}=${actual}(exp:${v})`);
  }
  return mismatches.length === 0
    ? { ok: true, msg: "" }
    : { ok: false, msg: mismatches.join("; ") };
}

async function jijiIsRegionChecked(page: Page, regionText: string): Promise<boolean> {
  const around = page.locator(`li:has-text('${regionText}') input[type='checkbox']`);
  const cnt = await around.count();
  for (let i = 0; i < cnt; i++) {
    try { if (await around.nth(i).isChecked()) return true; } catch { continue; }
  }
  return false;
}

async function jijiCheckRegionCheckbox(page: Page, regionText: string): Promise<boolean> {
  if (await jijiIsRegionChecked(page, regionText)) return true;

  const mapped = REGION_CHECKBOX_VALUE_MAP[regionText];
  if (mapped) {
    const byVal = page.locator(`input[type='checkbox'][value='${mapped}']`);
    const cnt = await byVal.count();
    for (let i = 0; i < cnt; i++) {
      try {
        await byVal.nth(i).check({ force: true });
        if (await jijiIsRegionChecked(page, regionText)) return true;
      } catch { continue; }
    }
  }

  const label = page.locator(`label:has-text('${regionText}')`);
  const labelCnt = await label.count();
  for (let i = 0; i < labelCnt; i++) {
    const item = label.nth(i);
    try {
      if (!await item.isVisible()) continue;
      const targetId = await item.getAttribute("for");
      if (targetId) {
        const cb = page.locator(`input[type='checkbox']#${targetId}`);
        if (await cb.count() > 0) {
          await cb.first().check({ force: true });
          if (await jijiIsRegionChecked(page, regionText)) return true;
        }
      }
      await item.click();
      if (await jijiIsRegionChecked(page, regionText)) return true;
    } catch { continue; }
  }
  try {
    await label.first().click({ force: true });
    if (await jijiIsRegionChecked(page, regionText)) return true;
  } catch { /* ignore */ }

  const around = page.locator(`li:has-text('${regionText}') input[type='checkbox']`);
  const aroundCnt = await around.count();
  for (let i = 0; i < aroundCnt; i++) {
    try {
      await around.nth(i).check({ force: true });
      if (await jijiIsRegionChecked(page, regionText)) return true;
    } catch { continue; }
  }
  return false;
}

async function jijiExpandCountryRegionPanel(page: Page): Promise<void> {
  const toggleCandidates = [
    "h4:has-text('国・地域から検索')",
    "h4:has-text('国・地域')",
    ".acordion-hd:has-text('国・地域')",
    ".accordion-hd:has-text('国・地域')",
    ".search-option h4:has-text('国・地域')",
  ];
  for (const sel of toggleCandidates) {
    const loc = page.locator(sel);
    if (await loc.count() === 0) continue;
    try {
      await loc.first().click({ force: true });
      await page.waitForTimeout(120);
      break;
    } catch { continue; }
  }
  await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(".acordion-list, .accordion-list")
    ) as HTMLElement[];
    for (const n of nodes) {
      n.style.display = "block";
      n.style.overflow = "visible";
      n.classList.remove("close");
      if (!n.classList.contains("open")) n.classList.add("open");
    }
  });
  await page.waitForTimeout(120);
}

async function jijiGetFirstMatchingItems(page: Page) {
  for (const sel of JIJI_RESULT_SELECTORS) {
    const loc = page.locator(sel);
    if (await loc.count() > 0) return loc;
  }
  return page.locator(JIJI_RESULT_SELECTORS[0]);
}

async function jijiFetchDetailBody(context: BrowserContext, url: string): Promise<string | null> {
  const detailPage = await context.newPage();
  try {
    await detailPage.goto(url, { waitUntil: "domcontentloaded" });
    const bodyLoc = detailPage.locator("#mainArticle article.news-wrap");
    if (await bodyLoc.count() > 0) {
      return jijiCleanText(await bodyLoc.first().innerText());
    }
    return null;
  } catch {
    return null;
  } finally {
    await detailPage.close();
  }
}

app.post("/api/jiji-search", async (req, res) => {
  const { keywords, dateFrom, dateTo, regions: regionIds } = req.body as {
    keywords?: string;
    dateFrom?: string;
    dateTo?: string;
    regions?: string[];
  };

  const token = process.env.BROWSERLESS_TOKEN;
  const loginId = process.env.JIJI_LOGIN_ID;
  const password = process.env.JIJI_PASSWORD;

  if (!token) {
    res.status(500).json({ error: "BROWSERLESS_TOKEN が設定されていません" });
    return;
  }
  if (!loginId || !password) {
    res.status(500).json({ error: "JIJI_LOGIN_ID / JIJI_PASSWORD が設定されていません" });
    return;
  }

  const regionLabels = (regionIds ?? [])
    .map(id => REGION_LABEL_MAP[id])
    .filter((label): label is string => !!label);
  if (regionLabels.length === 0) {
    res.status(400).json({ error: "地域を1つ以上選択してください" });
    return;
  }

  const parseIsoDate = (s: string) => {
    const [year, month, day] = s.split("-").map(Number);
    return { year, month, day };
  };
  const startDate = parseIsoDate(dateFrom ?? new Date().toISOString().slice(0, 10));
  const endDate   = parseIsoDate(dateTo   ?? new Date().toISOString().slice(0, 10));
  const keyword = keywords || "倒産 or 破産 or 廃業 or 撤退 or 経営難 or 閉鎖 or 債務 or 不渡 or 負債";
  const MAX_PAGES = 10;
  const DETAIL_CONCURRENCY = 5;

  let browser: import("playwright-core").Browser | undefined;
  try {
    const { chromium } = await import("playwright-core");
    // Playwright WebSocket protocol (same as Python p.chromium.connect)
    browser = await chromium.connect(`wss://production-sfo.browserless.io?token=${token}`);
    const context = await browser.newContext({ locale: "ja-JP" });
    await context.addInitScript(
      "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // Step 1: Login
    await page.goto(JIJI_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await jijiFillInput(page, [
      "input[name='loginid']", "input#idtxt", "input[name='id']",
      "input[name='login_id']", "input[type='text']",
    ], loginId);
    await jijiFillInput(page, ["input[name='password']", "input[type='password']"], password);

    const idInput  = page.locator("input[name='loginid']");
    const pwdInput = page.locator("input[name='password']");
    const idLen  = await idInput.count()  > 0 ? (await idInput.first().inputValue()).length  : 0;
    const pwdLen = await pwdInput.count() > 0 ? (await pwdInput.first().inputValue()).length : 0;
    if (idLen === 0 || pwdLen === 0) {
      throw new Error("ログイン情報の入力に失敗しました。アカウント設定を確認してください。");
    }

    const loginClicked = await jijiClickFirst(page, [
      "form#loginForm input.login-btn[type='submit']",
      "button[type='submit']",
      "input[type='submit']",
      "button:has-text('ログイン')",
    ]);
    if (!loginClicked) throw new Error("ログインボタンが見つかりません");

    try {
      await page.locator("form#loginForm").first().evaluate(
        (form: HTMLFormElement) => form.requestSubmit()
      );
    } catch { /* ignore */ }

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      await page.waitForLoadState("domcontentloaded");
    }

    await page.goto(JIJI_SEARCH_URL, { waitUntil: "domcontentloaded" });
    if (page.url().toLowerCase().includes("login")) {
      throw new Error("ログインに失敗しました。アカウントとパスワードを確認してください。");
    }

    // Step 2: Fill search form
    if (!await jijiSetKeyword(page, keyword)) {
      throw new Error("キーワードの入力に失敗しました");
    }
    if (!await jijiEnsureTermselectFromto(page)) {
      throw new Error("日付指定の選択に失敗しました");
    }

    await jijiSetSelectByName(page, "termStartYear",  startDate.year);
    await jijiSetSelectByName(page, "termStartMonth", startDate.month);
    await jijiSetSelectByName(page, "termStartDay",   startDate.day);
    await jijiSetSelectByName(page, "termEndYear",    endDate.year);
    await jijiSetSelectByName(page, "termEndMonth",   endDate.month);
    await jijiSetSelectByName(page, "termEndDay",     endDate.day);

    const { ok: dateOk, msg: dateMsg } = await jijiVerifyDateRange(page, startDate, endDate);
    if (!dateOk) {
      throw new Error(`日付条件の設定が一致しません: ${dateMsg}`);
    }

    await jijiExpandCountryRegionPanel(page);

    const failedRegions: string[] = [];
    for (const regionText of regionLabels) {
      const ok = await jijiCheckRegionCheckbox(page, regionText);
      if (!ok || !await jijiIsRegionChecked(page, regionText)) {
        failedRegions.push(regionText);
      }
    }
    if (failedRegions.length > 0) {
      throw new Error(`地域チェックに失敗しました: ${failedRegions.join(", ")}`);
    }
    await page.waitForTimeout(300);

    // Step 3: Submit search
    const searchClicked = await jijiClickFirst(page, [
      "input.search-btn[value*='この条件で検索']",
      "input[value*='この条件で検索']",
      "button:has-text('検索')",
      "button:has-text('检索')",
      "input[value*='検索']",
    ]);
    if (!searchClicked) {
      await page.evaluate("if (typeof search === 'function') { search(); }");
    }
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1200);

    // Step 4: Paginate result list
    const collectedItems: Array<{
      title: string;
      detailUrl: string;
      publishedTimeRaw: string;
    }> = [];
    let pageNo = 1;

    while (pageNo <= MAX_PAGES) {
      let found = false;
      for (const sel of JIJI_RESULT_SELECTORS) {
        try { await page.waitForSelector(sel, { timeout: 5000 }); found = true; break; }
        catch { continue; }
      }
      if (!found) {
        if (pageNo === 1) throw new Error("検索結果が見つかりません。条件を確認してください。");
        break;
      }

      const items = await jijiGetFirstMatchingItems(page);
      const count = await items.count();
      for (let i = 0; i < count; i++) {
        const li = items.nth(i);
        const a = li.locator("a").first();
        const title     = await a.count() > 0 ? jijiCleanText(await a.innerText()) : "";
        const href      = await a.count() > 0 ? (await a.getAttribute("href") ?? "") : "";
        const detailUrl = jijiExtractDetailPath(href);
        if (!detailUrl) continue;
        const timeLoc = li.locator("time");
        const timeText = await timeLoc.count() > 0 ? jijiCleanText(await timeLoc.first().innerText()) : "";
        collectedItems.push({ title, detailUrl, publishedTimeRaw: timeText });
      }

      const nextBtn = page.locator("nav.pager-box a.btn").filter({
        has: page.locator("i.fa-angle-right"),
      });
      const fallbackNext = await nextBtn.count() > 0
        ? nextBtn
        : page.locator("a:has-text('次へ'), button:has-text('次へ')");
      if (await fallbackNext.count() === 0) break;
      if (await fallbackNext.first().getAttribute("disabled") !== null) break;
      await fallbackNext.first().click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(600);
      pageNo++;
    }

    // Step 5: Fetch detail pages in parallel batches
    const allResults: Array<{
      title: string; date: string; region: string; url: string; summary: string;
    }> = [];

    for (let i = 0; i < collectedItems.length; i += DETAIL_CONCURRENCY) {
      const batch = collectedItems.slice(i, i + DETAIL_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const { publishedDate } = jijiParseTime(item.publishedTimeRaw);
          const body = await jijiFetchDetailBody(context, item.detailUrl);
          return {
            title:   item.title,
            date:    publishedDate ?? item.publishedTimeRaw,
            region:  jijiRegionFromTitle(item.title, regionLabels),
            url:     item.detailUrl,
            summary: body ? body.slice(0, 200) : "",
          };
        })
      );
      allResults.push(...batchResults);
    }

    res.json({ results: allResults });
  } catch (err: any) {
    console.error("jiji-search error:", err);
    const msg: string = err.message ?? "";
    const isTimeout = msg.includes("Timeout") || msg.includes("timeout");
    res.status(500).json({
      error: isTimeout
        ? "タイムアウトしました。条件を絞って再試行してください。"
        : msg || "データ収集に失敗しました",
    });
  } finally {
    await browser?.close();
  }
});

export default app;

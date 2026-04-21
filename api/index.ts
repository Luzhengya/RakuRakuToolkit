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

type TestCenterArea = "jmotto" | "univ" | "overseas" | "credit" | "jmotto-app" | "univ-app" | "univ-contents" | "nayose" | "gyoshu";

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
    bugCount: propertyToPlainText(properties["BUG数"]),
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
  const validAreas: TestCenterArea[] = ["jmotto", "univ", "overseas", "credit", "jmotto-app", "univ-app", "univ-contents", "nayose", "gyoshu"];
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
        ["BUG数"]: buildUpdatableProperty(properties["BUG数"], update.bugCount ?? "", "BUG数"),
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

    for (const file of multerFiles) {
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      try {
        const docxBuffer = await convertPdfToWordBuffer(file.buffer);
        folder?.file(originalName.replace(/\.pdf$/i, ".docx"), docxBuffer);
      } catch (e) {
        console.error(`Adobe conversion error for ${originalName}:`, e);
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="converted_pdfs.zip"`);
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
      const sheetsToConvert =
        sheetName === "全部"
          ? workbook.worksheets
          : ([workbook.getWorksheet(sheetName)].filter(Boolean) as ExcelJS.Worksheet[]);

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

        // Shape text
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
            markdown += `### Extracted Text from Shapes (${worksheet.name})\n\n`;
            shapeTexts.forEach((t) => { markdown += `> ${t}\n\n`; });
          }
        } catch { /* optional */ }
      }

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

export default app;

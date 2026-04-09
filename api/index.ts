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

// ── Routes ────────────────────────────────────────────────────────────

app.get("/api/pdf-status", (_req, res) => {
  const ready = !!(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET);
  res.json({ ready, error: ready ? null : "Adobe API credentials not configured" });
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
          await workbook.xlsx.load(file.buffer);
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

// PDF merge: client re-sends files in the correct (user-chosen) order
app.post("/api/pdf-merge", upload.array("files", 20), async (req, res) => {
  const multerFiles = req.files as Express.Multer.File[];
  if (!multerFiles || multerFiles.length < 2) {
    return res.status(400).json({ error: "At least 2 files are required for merging" });
  }

  const outputName = (req.body.outputName as string) || "merged.pdf";

  try {
    const mergedBuffer = await mergePDFBuffers(multerFiles.map((f) => f.buffer));
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
      await workbook.xlsx.load(fileBuffer);

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

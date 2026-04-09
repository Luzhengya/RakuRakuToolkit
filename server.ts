import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
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

// Loads .env locally; silently no-ops on Vercel (env vars injected at runtime)
dotenv.config();

const app = express();
const PORT = 3000;

// On Vercel, only /tmp is writable. Locally use ./uploads.
const uploadDir = process.env.VERCEL
  ? "/tmp/uploads"
  : path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Disk storage: used only for /api/upload (Excel sheet detection)
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Memory storage: used for PDF convert/merge — avoids cross-invocation /tmp issues on Vercel
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Helpers ───────────────────────────────────────────────────────────

function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn(`Failed to delete temp file: ${filePath}`, e);
  }
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ── PDF merge using pdf-lib (pure JS, no Python needed) ───────────────
async function mergePDFBuffers(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

// ── PDF → Word via Adobe PDF Services API ─────────────────────────────
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
  const jobResponse = await pdfServices.getJobResult({
    pollingURL,
    resultType: ExportPDFResult,
  });

  if (!jobResponse.result) {
    throw new Error("Adobe PDF Services returned empty result");
  }

  const streamAsset = await pdfServices.getContent({ asset: jobResponse.result.asset });
  return streamToBuffer(streamAsset.readStream);
}

// ── Periodic cleanup for orphaned temp files ──────────────────────────
function startUploadCleanup() {
  const MAX_AGE_MS = 60 * 60 * 1000;   // 1 hour
  const INTERVAL_MS = 30 * 60 * 1000;  // every 30 min

  function sweep() {
    try {
      const now = Date.now();
      let removed = 0;
      for (const name of fs.readdirSync(uploadDir)) {
        const filePath = path.join(uploadDir, name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(filePath);
            removed++;
          }
        } catch { /* file already gone */ }
      }
      if (removed > 0) console.log(`[cleanup] Removed ${removed} stale file(s)`);
    } catch (e) {
      console.warn("[cleanup] Sweep error:", e);
    }
  }

  sweep();
  setInterval(sweep, INTERVAL_MS);
}

// ── Routes ────────────────────────────────────────────────────────────

// Adobe API health check
app.get("/api/pdf-status", (req, res) => {
  const ready = !!(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET);
  res.json({ ready, error: ready ? null : "Adobe API credentials not configured" });
});

// Upload files — store to temp dir and return metadata
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
          await workbook.xlsx.readFile(file.path);
          const sheetNames = workbook.worksheets.map((ws) => ws.name);
          return { filename: file.filename, originalName, type: "excel" as const, sheetNames };
        } else if (originalName.endsWith(".pdf")) {
          return { filename: file.filename, originalName, type: "pdf" as const };
        }
        return { filename: file.filename, originalName, type: "unknown" as const, error: "Unsupported file type" };
      })
    );
    res.json({ files: results });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to read uploaded files" });
  }
});

// PDF → Word (Adobe PDF Services API)
// Accepts multipart/form-data so client re-sends file bytes — no cross-invocation disk dependency
app.post("/api/pdf-convert", memUpload.array("files", 10), async (req, res) => {
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
    const resultsFolder = downloadPath ? zip.folder(downloadPath) : zip;

    for (const file of multerFiles) {
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      try {
        const docxBuffer = await convertPdfToWordBuffer(file.buffer);
        const outputName = originalName.replace(/\.pdf$/i, ".docx");
        resultsFolder?.file(outputName, docxBuffer);
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

// PDF merge (pdf-lib, pure JS)
// Accepts multipart/form-data with files in the correct order — no cross-invocation disk dependency
app.post("/api/pdf-merge", memUpload.array("files", 20), async (req, res) => {
  const multerFiles = req.files as Express.Multer.File[];
  if (!multerFiles || multerFiles.length < 2) {
    return res.status(400).json({ error: "At least 2 files are required for merging" });
  }

  const outputName = (req.body.outputName as string) || "merged.pdf";

  try {
    const buffers = multerFiles.map((f) => f.buffer);
    const mergedBuffer = await mergePDFBuffers(buffers);
    const filename = outputName.replace(/[^\w\u4e00-\u9fff\-_.]/g, "_");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(mergedBuffer);
  } catch (error) {
    console.error("PDF merge error:", error);
    res.status(500).json({ error: "Failed to merge PDF files" });
  }
});

// Excel → Markdown
app.post("/api/convert", express.json(), async (req, res) => {
  const { files, sheetName, downloadPath } = req.body;
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }

  try {
    const mainZip = new JSZip();
    const resultsFolder = downloadPath ? mainZip.folder(downloadPath) : mainZip;

    for (const fileInfo of files) {
      const { filename, originalName } = fileInfo;
      const filePath = path.join(uploadDir, filename);
      if (!fs.existsSync(filePath)) continue;

      try {
        const fileBuffer = fs.readFileSync(filePath);

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
          let maxColsInSheet = 0;

          worksheet.eachRow({ includeEmpty: true }, (row) => {
            const rowData: string[] = [];
            for (let i = 1; i <= row.cellCount; i++) {
              const cell = row.getCell(i);
              let val = "";
              try {
                const cellValue = cell.value;
                if (cellValue === null || cellValue === undefined) val = "";
                else if (typeof cellValue === "object") {
                  if ("richText" in cellValue && Array.isArray(cellValue.richText)) {
                    val = cellValue.richText.map((rt: any) => rt.text || "").join("");
                  } else if ("formula" in cellValue) {
                    val =
                      cellValue.result !== null && cellValue.result !== undefined
                        ? cellValue.result.toString()
                        : "";
                  } else if (cellValue instanceof Date) {
                    val = cellValue.toISOString();
                  } else {
                    val = JSON.stringify(cellValue);
                  }
                } else {
                  val = cellValue.toString();
                }
              } catch {
                val = cell.text || "";
              }
              val = val.replace(/\|/g, "\\|").trim();
              rowData.push(val);
            }
            allRows.push(rowData);
            if (rowData.length > maxColsInSheet) maxColsInSheet = rowData.length;
          });

          const blocks: string[][][] = [];
          let currentBlock: string[][] = [];
          for (const row of allRows) {
            const isEmpty = row.every((cell) => cell === "");
            if (isEmpty) {
              if (currentBlock.length > 0) { blocks.push(currentBlock); currentBlock = []; }
            } else {
              currentBlock.push(row);
            }
          }
          if (currentBlock.length > 0) blocks.push(currentBlock);

          for (const block of blocks) {
            const blockMaxCols = Math.max(...block.map((r) => r.length));
            const activeColIndices: number[] = [];
            for (let j = 0; j < blockMaxCols; j++) {
              if (block.some((row) => row[j] && row[j] !== "")) activeColIndices.push(j);
            }
            const finalBlockRows = block.map((row) => activeColIndices.map((idx) => row[idx] || ""));
            const numRows = finalBlockRows.length;
            const numCols = activeColIndices.length;
            if (numRows === 0 || numCols === 0) continue;

            if (numCols > 1 && numRows > 1) {
              const formatRow = (r: string[]) => `| ${r.join(" | ")} |`;
              markdown += `${formatRow(finalBlockRows[0])}\n`;
              markdown += `| ${Array(numCols).fill("---").join(" | ")} |\n`;
              for (let i = 1; i < finalBlockRows.length; i++) {
                markdown += `${formatRow(finalBlockRows[i])}\n`;
              }
              markdown += "\n";
            } else {
              for (const row of finalBlockRows) {
                const line = row.filter((c) => c !== "").join(" ");
                if (line) markdown += `${line}  \n`;
              }
              markdown += "\n";
            }
          }

          const worksheetImages = worksheet.getImages();
          if (worksheetImages.length > 0 && workbook.model.media) {
            markdown += `### Images in ${worksheet.name}\n\n`;
            for (const img of worksheetImages) {
              const media = (workbook.model.media as any)[img.imageId];
              if (media) {
                const imgFilename = `image_${worksheet.id}_${img.imageId}.${media.extension}`;
                imagesFolder?.file(imgFilename, media.buffer);
                markdown += `![${imgFilename}](images/${imgFilename})\n\n`;
              }
            }
          }

          try {
            const xlsxZip = await JSZip.loadAsync(fileBuffer);
            const drawingFiles = Object.keys(xlsxZip.files).filter((n) =>
              n.startsWith("xl/drawings/drawing")
            );
            const shapeTexts: string[] = [];
            for (const drawingFile of drawingFiles) {
              const content = await xlsxZip.file(drawingFile)?.async("string");
              if (content) {
                content.match(/<a:t>([^<]+)<\/a:t>/g)?.forEach((m) => {
                  const text = m.replace(/<\/?a:t>/g, "");
                  if (text && !shapeTexts.includes(text)) shapeTexts.push(text);
                });
              }
            }
            if (shapeTexts.length > 0) {
              markdown += `### Extracted Text from Shapes (${worksheet.name})\n\n`;
              shapeTexts.forEach((txt) => { markdown += `> ${txt}\n\n`; });
            }
          } catch { /* shape extraction is optional */ }
        }

        zip.file("output.md", markdown);
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        const zipName = originalName
          ? originalName.replace(/\.(xlsx|xls)$/i, ".zip")
          : `${filename}.zip`;
        resultsFolder?.file(zipName, zipBuffer);
      } finally {
        safeUnlink(filePath);
      }
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

// ── Static / SPA serving ──────────────────────────────────────────────

async function startDevServer() {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Dev server running on http://localhost:${PORT}`);
    startUploadCleanup();
  });
}

if (process.env.NODE_ENV !== "production") {
  startDevServer();
} else if (!process.env.VERCEL) {
  // Production Docker / self-hosted
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startUploadCleanup();
  });
}

// Vercel: export the Express app as the default handler
export default app;

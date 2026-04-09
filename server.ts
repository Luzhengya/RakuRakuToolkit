import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import JSZip from "jszip";
import { spawn, exec } from "child_process";
import { promisify } from "util";

const app = express();
const PORT = 3000;
const execPromise = promisify(exec);

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 100MB limit per file
const upload = multer({ dest: "uploads/", limits: { fileSize: 100 * 1024 * 1024 } });

// Find Python executable by scanning PATH directories in Node.js (no shell spawning).
// Avoids Windows Microsoft Store stub which hangs when invoked via exec/where.exe.
function findPythonInPath(): string | null {
  const isWindows = process.platform === "win32";
  const pathDirs = (process.env.PATH ?? "").split(isWindows ? ";" : ":");
  const names = isWindows ? ["python.exe", "python3.exe"] : ["python3", "python"];

  for (const dir of pathDirs) {
    // Skip Windows Store stub directory entirely
    if (isWindows && dir.toLowerCase().includes("windowsapps")) continue;
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // not found in this dir, keep searching
      }
    }
  }
  return null;
}

function getPythonCmd(): string {
  const found = findPythonInPath();
  if (found) return found;
  throw new Error("Python not found. Please install Python 3.");
}

// Safely run Python script using spawn (prevents shell injection)
// Captures both stdout and stderr for complete error messages
function runPythonScript(pythonCmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const detail = (stderr || stdout).trim() || "(no output)";
        reject(new Error(`Python exited with code ${code}: ${detail}`));
      }
    });
    proc.on("error", reject);
  });
}

// Safe file deletion helper
function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn(`Failed to delete temp file: ${filePath}`, e);
  }
}

// Periodically delete orphaned files in uploads/ (uploaded but never converted).
// Runs immediately on startup to clean previous session's leftovers, then every 30 min.
function startUploadCleanup() {
  const MAX_AGE_MS  = 60 * 60 * 1000;  // files older than 1 hour are considered orphaned
  const INTERVAL_MS = 30 * 60 * 1000;  // scan every 30 minutes

  function sweep() {
    try {
      const now = Date.now();
      const entries = fs.readdirSync(uploadDir);
      let removed = 0;
      for (const name of entries) {
        const filePath = path.join(uploadDir, name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(filePath);
            removed++;
            console.log(`[cleanup] Deleted stale upload: ${name}`);
          }
        } catch {
          // file may have been deleted by a concurrent request — ignore
        }
      }
      if (removed > 0) {
        console.log(`[cleanup] Removed ${removed} stale file(s) from uploads/`);
      }
    } catch (e) {
      console.warn("[cleanup] Error during upload sweep:", e);
    }
  }

  sweep(); // run once immediately on startup
  setInterval(sweep, INTERVAL_MS);
}

async function startServer() {
  let pythonCmd: string;
  try {
    pythonCmd = getPythonCmd();
    console.log(`Python detected: ${pythonCmd}`);
  } catch (e: any) {
    console.warn("Python detection failed:", e.message, "— falling back to 'python'");
    pythonCmd = "python";
  }

  // In preview environment, install dependencies dynamically
  if (process.env.NODE_ENV !== "production") {
    console.log("Ensuring pdf2docx is installed...");
    // --break-system-packages is only valid on Debian/Ubuntu system Python; skip on Windows
    const pipArgs = process.platform === "win32"
      ? `"${pythonCmd}" -m pip install pdf2docx opencv-python-headless`
      : `"${pythonCmd}" -m pip install pdf2docx opencv-python-headless --break-system-packages`;
    exec(pipArgs, (error, stdout, stderr) => {
      if (error) console.error("Error installing pdf2docx:", stderr || error.message);
      else console.log("pdf2docx ready.");
    });
  }

  // Check if Python and pdf2docx are actually available
  app.get("/api/pdf-status", async (req, res) => {
    try {
      await execPromise(`"${pythonCmd}" -c "import pdf2docx"`);
      res.json({ ready: true, error: null });
    } catch (e: any) {
      res.json({ ready: false, error: e.message || "pdf2docx not available" });
    }
  });

  app.get("/api/test-python", async (req, res) => {
    try {
      const { stdout, stderr } = await execPromise(`"${pythonCmd}" -c "import pdf2docx; print('pdf2docx ok')" && "${pythonCmd}" --version`);
      res.json({ stdout, stderr, error: null });
    } catch (e: any) {
      res.json({ stdout: "", stderr: "", error: e.message });
    }
  });

  // API routes
  app.post("/api/upload", upload.array("files", 10), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    try {
      const results = await Promise.all(files.map(async (file) => {
        // Fix filename encoding (common issue with multer and non-ASCII filenames)
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

        if (originalName.endsWith('.xlsx') || originalName.endsWith('.xls')) {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.readFile(file.path);
          const sheetNames = workbook.worksheets.map((ws) => ws.name);
          return { filename: file.filename, originalName, type: 'excel' as const, sheetNames };
        } else if (originalName.endsWith('.pdf')) {
          return { filename: file.filename, originalName, type: 'pdf' as const };
        }
        return { filename: file.filename, originalName, type: 'unknown' as const, error: 'Unsupported file type' };
      }));

      res.json({ files: results });
    } catch (error) {
      console.error("Error reading files:", error);
      res.status(500).json({ error: "Failed to read files" });
    }
  });

  app.post("/api/pdf-convert", express.json(), async (req, res) => {
    const { files, downloadPath } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    try {
      const zip = new JSZip();
      const resultsFolder = downloadPath ? zip.folder(downloadPath) : zip;

      for (const fileInfo of files) {
        const { filename, originalName } = fileInfo;
        const filePath = path.join(process.cwd(), "uploads", filename);
        const outputDocxPath = path.join(process.cwd(), "uploads", `${filename}.docx`);

        if (!fs.existsSync(filePath)) continue;

        try {
          // Use spawn to avoid shell injection — arguments passed as array, not string concatenation
          const scriptPath = path.join(process.cwd(), "convert_pdf.py");
          await runPythonScript(pythonCmd, [scriptPath, filePath, outputDocxPath]);

          if (fs.existsSync(outputDocxPath)) {
            const buffer = fs.readFileSync(outputDocxPath);
            const outputName = originalName ? originalName.replace(/\.pdf$/i, '.docx') : `${filename}.docx`;
            resultsFolder?.file(outputName, buffer);
          }
        } catch (pyError) {
          console.error(`Python conversion error for ${originalName}:`, pyError);
        } finally {
          // Always clean up temp files regardless of success or failure
          safeUnlink(outputDocxPath);
          safeUnlink(filePath);
        }
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="converted_pdfs.zip"`);
      res.send(zipBuffer);
    } catch (error) {
      console.error("Error converting PDFs:", error);
      res.status(500).json({ error: "Failed to convert PDF files" });
    }
  });

  app.post("/api/pdf-merge", express.json(), async (req, res) => {
    const { files, outputName } = req.body;
    if (!files || !Array.isArray(files) || files.length < 2) {
      return res.status(400).json({ error: "At least 2 files are required for merging" });
    }

    const outputPdfPath = path.join(process.cwd(), "uploads", `merged_${Date.now()}.pdf`);
    const inputPaths: string[] = [];

    try {
      for (const fileInfo of files) {
        const filePath = path.join(process.cwd(), "uploads", fileInfo.filename);
        if (fs.existsSync(filePath)) {
          inputPaths.push(filePath);
        } else {
          console.warn(`Merge: file not found on server: ${fileInfo.originalName}`);
        }
      }

      if (inputPaths.length < 2) {
        return res.status(400).json({ error: "Not enough valid files found on server" });
      }

      const scriptPath = path.join(process.cwd(), "merge_pdf.py");
      await runPythonScript(pythonCmd, [scriptPath, outputPdfPath, ...inputPaths]);

      if (!fs.existsSync(outputPdfPath)) {
        return res.status(500).json({ error: "Merged file was not created" });
      }

      const buffer = fs.readFileSync(outputPdfPath);
      const filename = (outputName || "merged.pdf").replace(/[^\w\u4e00-\u9fff\-_.]/g, "_");
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buffer);
    } catch (error) {
      console.error("PDF merge error:", error);
      res.status(500).json({ error: "Failed to merge PDF files" });
    } finally {
      safeUnlink(outputPdfPath);
      for (const p of inputPaths) safeUnlink(p);
    }
  });

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
        const filePath = path.join("uploads", filename);
        if (!fs.existsSync(filePath)) continue;

        try {
          // Read file buffer once, reuse for both ExcelJS and JSZip (avoids double file read)
          const fileBuffer = fs.readFileSync(filePath);

          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(fileBuffer);

          const zip = new JSZip();
          const imagesFolder = zip.folder("images");

          let markdown = "";
          const sheetsToConvert = sheetName === "全部"
            ? workbook.worksheets
            : [workbook.getWorksheet(sheetName)].filter(Boolean) as ExcelJS.Worksheet[];

          for (const worksheet of sheetsToConvert) {
            markdown += `## Sheet: ${worksheet.name}\n\n`;

            // --- 1. Extract and Process Data Blocks ---
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
                  else if (typeof cellValue === 'object') {
                    if ('richText' in cellValue && Array.isArray(cellValue.richText)) {
                      val = cellValue.richText.map((rt: any) => rt.text || "").join("");
                    } else if ('formula' in cellValue) {
                      val = (cellValue.result !== null && cellValue.result !== undefined) ? cellValue.result.toString() : "";
                    } else if (cellValue instanceof Date) {
                      val = cellValue.toISOString();
                    } else {
                      val = JSON.stringify(cellValue);
                    }
                  } else {
                    val = cellValue.toString();
                  }
                } catch (e) {
                  val = cell.text || "";
                }
                val = val.replace(/\|/g, "\\|").trim();
                rowData.push(val);
              }
              allRows.push(rowData);
              if (rowData.length > maxColsInSheet) maxColsInSheet = rowData.length;
            });

            // Split into blocks based on empty rows
            const blocks: string[][][] = [];
            let currentBlock: string[][] = [];

            for (const row of allRows) {
              const isEmpty = row.every(cell => cell === "");
              if (isEmpty) {
                if (currentBlock.length > 0) {
                  blocks.push(currentBlock);
                  currentBlock = [];
                }
              } else {
                currentBlock.push(row);
              }
            }
            if (currentBlock.length > 0) blocks.push(currentBlock);

            for (const block of blocks) {
              const blockMaxCols = Math.max(...block.map(r => r.length));
              const activeColIndices: number[] = [];
              for (let j = 0; j < blockMaxCols; j++) {
                const isColActive = block.some(row => row[j] && row[j] !== "");
                if (isColActive) activeColIndices.push(j);
              }

              const finalBlockRows = block.map(row => activeColIndices.map(idx => row[idx] || ""));
              const numRows = finalBlockRows.length;
              const numCols = activeColIndices.length;

              if (numRows === 0 || numCols === 0) continue;

              const isTable = numCols > 1 && numRows > 1;

              if (isTable) {
                const formatRow = (r: string[]) => `| ${r.join(" | ")} |`;
                const header = finalBlockRows[0];
                markdown += `${formatRow(header)}\n`;
                markdown += `| ${Array(numCols).fill("---").join(" | ")} |\n`;
                for (let i = 1; i < finalBlockRows.length; i++) {
                  markdown += `${formatRow(finalBlockRows[i])}\n`;
                }
                markdown += "\n";
              } else {
                for (const row of finalBlockRows) {
                  const line = row.filter(c => c !== "").join(" ");
                  if (line) {
                    markdown += `${line}  \n`;
                  }
                }
                markdown += "\n";
              }
            }

            // --- 2. Extract Images ---
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

            // --- 3. Extract Shape Text (reuse already-loaded buffer) ---
            try {
              const xlsxZip = await JSZip.loadAsync(fileBuffer);
              const drawingFiles = Object.keys(xlsxZip.files).filter(name => name.startsWith('xl/drawings/drawing'));

              const shapeTexts: string[] = [];
              for (const drawingFile of drawingFiles) {
                const content = await xlsxZip.file(drawingFile)?.async("string");
                if (content) {
                  const matches = content.match(/<a:t>([^<]+)<\/a:t>/g);
                  if (matches) {
                    matches.forEach(m => {
                      const text = m.replace(/<\/?a:t>/g, "");
                      if (text && !shapeTexts.includes(text)) shapeTexts.push(text);
                    });
                  }
                }
              }

              if (shapeTexts.length > 0) {
                markdown += `### Extracted Text from Shapes (${worksheet.name})\n\n`;
                shapeTexts.forEach(txt => {
                  markdown += `> ${txt}\n\n`;
                });
              }
            } catch (shapeErr) {
              console.warn("Could not extract shape text:", shapeErr);
            }
          }

          zip.file("output.md", markdown);
          const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
          const zipName = originalName ? originalName.replace(/\.(xlsx|xls)$/i, '.zip') : `${filename}.zip`;
          resultsFolder?.file(zipName, zipBuffer);
        } finally {
          // Always clean up uploaded file
          safeUnlink(filePath);
        }
      }

      const mainZipBuffer = await mainZip.generateAsync({ type: "nodebuffer" });

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="excel_conversions.zip"`);
      res.send(mainZipBuffer);
    } catch (error) {
      console.error("Error converting excel:", error);
      res.status(500).json({ error: "Failed to convert Excel file" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startUploadCleanup();
  });
}

startServer();

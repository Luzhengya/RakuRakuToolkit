import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import JSZip from "jszip";

const app = express();
const PORT = 3000;

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: "uploads/" });

let isPdfToolReady = false;
let pdfToolError: string | null = null;

async function startServer() {
  const { exec } = await import("child_process");
  console.log("Starting pdf2docx installation...");
  exec("python3 -m pip install --upgrade pip && python3 -m pip install pdf2docx --break-system-packages", (error, stdout, stderr) => {
    if (error) {
      console.error("Error installing pdf2docx:", error);
      pdfToolError = stderr || error.message;
    } else {
      console.log("pdf2docx installed successfully.");
      isPdfToolReady = true;
    }
  });

  app.get("/api/pdf-status", (req, res) => {
    res.json({ ready: isPdfToolReady, error: pdfToolError });
  });

  app.get("/api/test-python", async (req, res) => {
    const { exec } = await import("child_process");
    exec("python3 --version && pip3 --version", (error, stdout, stderr) => {
      res.json({ stdout, stderr, error: error?.message });
    });
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
          return { filename: file.filename, originalName, type: 'excel', sheetNames };
        } else if (originalName.endsWith('.pdf')) {
          return { filename: file.filename, originalName, type: 'pdf' };
        }
        return { filename: file.filename, originalName, type: 'unknown', error: 'Unsupported file type' };
      }));
      
      res.json({ files: results });
    } catch (error) {
      console.error("Error reading files:", error);
      res.status(500).json({ error: "Failed to read files" });
    }
  });

  app.post("/api/pdf-convert", express.json(), async (req, res) => {
    if (!isPdfToolReady) {
      return res.status(503).json({ 
        error: "PDF conversion engine is still initializing or failed to start. Please try again in a minute.",
        details: pdfToolError
      });
    }

    const { files, downloadPath } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    const { exec } = await import("child_process");
    const util = await import("util");
    const execPromise = util.promisify(exec);

    try {
      const zip = new JSZip();
      const resultsFolder = downloadPath ? zip.folder(downloadPath) : zip;

      for (const fileInfo of files) {
        const { filename, originalName } = fileInfo;
        const filePath = path.join(process.cwd(), "uploads", filename);
        const outputDocxPath = path.join(process.cwd(), "uploads", `${filename}.docx`);
        
        if (!fs.existsSync(filePath)) continue;

        try {
          // Call Python script
          await execPromise(`python3 convert_pdf.py "${filePath}" "${outputDocxPath}"`);
          
          if (fs.existsSync(outputDocxPath)) {
            const buffer = fs.readFileSync(outputDocxPath);
            const outputName = originalName ? originalName.replace(/\.pdf$/i, '.docx') : `${filename}.docx`;
            resultsFolder?.file(outputName, buffer);
            
            // Cleanup docx
            fs.unlinkSync(outputDocxPath);
          }
        } catch (pyError) {
          console.error(`Python conversion error for ${originalName}:`, pyError);
        }

        // Cleanup original pdf
        fs.unlinkSync(filePath);
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

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

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
                  val = cellValue.richText.map(rt => rt.text || "").join("");
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

        // Process each block
        for (const block of blocks) {
          // Trim empty columns within this specific block
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

          // Heuristic: Determine if it's a table
          // 1. More than 1 column AND more than 1 row -> Table
          // 2. Otherwise -> Text
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
            // Output as plain text or list
            for (const row of finalBlockRows) {
              const line = row.filter(c => c !== "").join(" ");
              if (line) {
                markdown += `${line}  \n`; // Double space for line break in MD
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

        // --- 3. Extract Shape Text (Experimental XML Parsing) ---
        try {
          // Re-read file as ZIP to find drawing XMLs
          const fileBuffer = fs.readFileSync(filePath);
          const xlsxZip = await JSZip.loadAsync(fileBuffer);
          
          // Drawings are usually in xl/drawings/drawing1.xml etc.
          // We look for all drawing files
          const drawingFiles = Object.keys(xlsxZip.files).filter(name => name.startsWith('xl/drawings/drawing'));
          
          let shapeTexts: string[] = [];
          for (const drawingFile of drawingFiles) {
            const content = await xlsxZip.file(drawingFile)?.async("string");
            if (content) {
              // Simple regex to find text inside <a:t> tags which are often used in shapes
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

        // Cleanup
        fs.unlinkSync(filePath);
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
  });
}

startServer();

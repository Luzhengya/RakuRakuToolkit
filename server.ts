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

async function startServer() {
  // API routes
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      const sheetNames = workbook.worksheets.map((ws) => ws.name);
      
      // Keep the file for conversion later, or delete it if we only wanted names
      // For simplicity, we'll return the names and the filename
      res.json({ filename: req.file.filename, sheetNames });
    } catch (error) {
      console.error("Error reading excel:", error);
      res.status(500).json({ error: "Failed to read Excel file" });
    }
  });

  app.post("/api/convert", express.json(), async (req, res) => {
    const { filename, sheetName } = req.body;
    if (!filename) {
      return res.status(400).json({ error: "Missing filename" });
    }

    const filePath = path.join("uploads", filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    try {
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
        
        // --- 1. Extract Table Data ---
        const rows: string[][] = [];
        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          const rowData: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            if (!cell) {
              rowData.push("");
              return;
            }
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
            val = val.replace(/\|/g, "\\|");
            rowData.push(val);
          });
          rows.push(rowData);
        });

        if (rows.length > 0) {
          const maxCols = Math.max(...rows.map(r => r.length));
          const formatRow = (r: string[]) => {
            const padded = [...r];
            while (padded.length < maxCols) padded.push("");
            return `| ${padded.join(" | ")} |`;
          };
          const header = rows[0];
          markdown += `${formatRow(header)}\n`;
          markdown += `| ${Array(maxCols).fill("---").join(" | ")} |\n`;
          for (let i = 1; i < rows.length; i++) {
            markdown += `${formatRow(rows[i])}\n`;
          }
          markdown += "\n";
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
      const content = await zip.generateAsync({ type: "nodebuffer" });

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="conversion_result.zip"`);
      res.send(content);

      // Cleanup
      fs.unlinkSync(filePath);
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

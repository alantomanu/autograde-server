// Add dotenv import at the top
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fileUpload from 'express-fileupload';
import fs from 'fs/promises';
import path from 'path';
import { convertPdfToSingleImage } from './sticher.js';  // Ensure the file name is correct
import sharp from 'sharp';
import cors from 'cors';
import { processImageWithAI } from './ocr.js';
import { initializeCloudinary, uploadImage } from './cloudinary.js';
import { fileURLToPath } from 'url';
import { extractTextFromPDF, parseAnswerKeyToJSON } from './pdfProcessor.js';
import { evaluateAnswerSheet, evaluateSingleAnswer } from './evaluator.js';

// Load environment variables from .env file
dotenv.config();

// First, log that we're starting
console.log("=== SCRIPT START ===");

// Log after imports
console.log("=== IMPORTS COMPLETED ===");

// Remove the old Cloudinary config block and add this line
initializeCloudinary();

// Initialize Express
console.log("=== INITIALIZING EXPRESS ===");
const app = express();
const PORT = process.env.PORT || 3000;

// Configure __dirname for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Enable CORS
app.use(cors());

// Enable file upload
app.use(fileUpload());
app.use(express.json());

// Ensure upload directories exist
const uploadDir = path.join(__dirname, "../uploads");
const outputDir = path.join(__dirname, "../output");

async function createDirectory(path) {
  try {
    await fs.access(path);
    console.log("Given Directory already exists !!");
  } catch (error) {
    // If the directory does not exist, create it
    try {
      await fs.mkdir(path, { recursive: true });
      console.log("New Directory created successfully !!");
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError);
    }
  }
}



// Health Check
app.get("/", (req, res) => {
  res.send("API is running!");
});

// Endpoint to process PDF and return stitched image
app.post("/stitch", async (req, res) => {
createDirectory(uploadDir);
createDirectory(outputDir);
  try {
    const { pdfUrl, forceReprocess } = req.body;

    if (!pdfUrl) {
      return res.status(400).json({ error: "No PDF URL provided" });
    }

    // Download PDF from URL
    const response = await axios({
      url: pdfUrl,
      responseType: 'arraybuffer'
    });

    // Save PDF temporarily
    const pdfFileName = `temp-${Date.now()}.pdf`;
    const pdfPath = path.join(uploadDir, pdfFileName);
    await fs.writeFile(pdfPath, response.data);

    // Process PDF to image
    const outputFileName = `output-${Date.now()}.png`;
    const outputPath = path.join(outputDir, outputFileName);
    await convertPdfToSingleImage(pdfPath, outputPath);

    // Compress the image before uploading to Cloudinary
    const compressedOutputPath = path.join(outputDir, `compressed_${Date.now()}.png`);
    await sharp(outputPath)
      .resize(2000, null, { // Limit width to 2000px
        withoutEnlargement: true,
        fit: 'inside'
      })
      .png({ 
        quality: 80,
        compressionLevel: 9
      })
      .toFile(compressedOutputPath);

    try {
      const timestamp = Date.now();
      const uploadResult = await uploadImage(compressedOutputPath, timestamp);

      // Cleanup files and folders
      try {
        await fs.unlink(pdfPath);
        await fs.unlink(outputPath);
        await fs.unlink(compressedOutputPath);

        const uploadFiles = await fs.readdir(uploadDir);
        const outputFiles = await fs.readdir(outputDir);

        if (uploadFiles.length === 0) await fs.rmdir(uploadDir);
        if (outputFiles.length === 0) await fs.rmdir(outputDir);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }

      res.json({
        success: true,
        ...uploadResult
      });

    } catch (uploadError) {
      console.error('Cloudinary Upload Error:', uploadError);
      res.status(500).json({
        success: false,
        error: "Upload failed",
        details: uploadError.message
      });
    }

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: "Processing failed",
      details: error.message
    });
  }
});

// OCR processing endpoint
app.post('/process-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    console.log('Received request with imageUrl:', imageUrl);

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    const result = await processImageWithAI(imageUrl, process.env.TOGETHER_API_KEY);
    res.json(result);

  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process image',
      details: error.message 
    });
  }
});

// Endpoint to process PDF and convert to JSON
app.post('/convert-pdf', async (req, res) => {
  try {
    const { pdfUrl } = req.body;

    if (!pdfUrl) {
      return res.status(400).json({ error: 'PDF URL is required' });
    }

    console.log(`Processing PDF from URL: ${pdfUrl}`);

    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data);

    const extractedText = await extractTextFromPDF(pdfBuffer);

    const jsonData = parseAnswerKeyToJSON(extractedText);

    res.json({ success: true, data: jsonData });

  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to process PDF' });
  }
});

// Add these new endpoints before the server start
app.post('/evaluate', async (req, res) => {
  try {
    const result = await evaluateAnswerSheet(req.body);
    res.json(result);
  } catch (error) {
    console.error('Error evaluating answers:', error);
    res.status(500).json({ success: false, error: "Internal server error: " + error.message });
  }
});

app.post('/evaluate-single', async (req, res) => {
  try {
    const result = await evaluateSingleAnswer(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error evaluating answer:', error);
    res.status(500).json({ success: false, error: "Internal server error: " + error.message });
  }
});

// Serve the output images
app.use("/output", express.static(outputDir));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

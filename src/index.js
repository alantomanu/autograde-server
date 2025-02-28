// Add dotenv import at the top
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fileUpload from 'express-fileupload';
import fs from 'fs';
import path from 'path';
import { convertPdfToSingleImage } from './sticher.js';  // Ensure the file name is correct
import sharp from 'sharp';
import cors from 'cors';
import { processImageWithAI } from './ocr.js';
import { initializeCloudinary, uploadImage } from './cloudinary.js';
import { fileURLToPath } from 'url';

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

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Health Check
app.get("/", (req, res) => {
  res.send("API is running!");
});

// Endpoint to process PDF and return stitched image
app.post("/stitch", async (req, res) => {
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
    await fs.promises.writeFile(pdfPath, response.data);

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
        await fs.promises.unlink(pdfPath);
        await fs.promises.unlink(outputPath);
        await fs.promises.unlink(compressedOutputPath);

        const uploadFiles = await fs.promises.readdir(uploadDir);
        const outputFiles = await fs.promises.readdir(outputDir);

        if (uploadFiles.length === 0) await fs.promises.rmdir(uploadDir);
        if (outputFiles.length === 0) await fs.promises.rmdir(outputDir);
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

// Serve the output images
app.use("/output", express.static(outputDir));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

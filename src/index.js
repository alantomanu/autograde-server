// Add dotenv import at the top
require('dotenv').config();

// First, log that we're starting
console.log("=== SCRIPT START ===");

// Import statements
const express = require("express");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");
const { convertPdfToSingleImage } = require("./sticher");  // Ensure the file name is correct
const sharp = require("sharp");

const cors = require("cors");
const cloudinary = require("cloudinary").v2;
const axios = require("axios");

// Log after imports
console.log("=== IMPORTS COMPLETED ===");

// Configure Cloudinary with environment variables
try {
    console.log("=== CONFIGURING CLOUDINARY ===");
    
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    
    // Verify configuration
    const config = cloudinary.config();
    console.log("Cloudinary Config Object:", {
        cloud_name: config.cloud_name,
        api_key: config.api_key ? "Present" : "Missing",
        api_secret: config.api_secret ? "Present" : "Missing"
    });
} catch (error) {
    console.error("=== CLOUDINARY CONFIG ERROR ===");
    console.error(error);
}

// Initialize Express
console.log("=== INITIALIZING EXPRESS ===");
const app = express();
const PORT = process.env.PORT || 5000;

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
  res.send("Stitcher API is running!");
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
      const imageName = `stitched_${timestamp}`;
      
      const uploadResult = await cloudinary.uploader.upload(
        compressedOutputPath, // Use compressed image
        {
          public_id: imageName,
          folder: 'stiched_image',
          resource_type: 'image',
          overwrite: true
        }
      );

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
        imageUrl: uploadResult.secure_url,
        optimizedUrl: cloudinary.url(`stiched_image/${imageName}`, {
          fetch_format: 'auto',
          quality: 'auto'
        })
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

// Serve the output images
app.use("/output", express.static(outputDir));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

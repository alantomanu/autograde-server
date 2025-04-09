// Add dotenv import at the top
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fileUpload from 'express-fileupload';
import fs from 'fs/promises';
import path from 'path';
import { processImageWithAI } from './ocr.js';
import { fileURLToPath } from 'url';
import { extractTextFromPDF, parseAnswerKeyToJSON } from './pdfProcessor.js';
import { evaluateAnswerSheet, evaluateSingleAnswer } from './evaluator.js';


dotenv.config();


console.log("=== SCRIPT START ===");


console.log("=== IMPORTS COMPLETED ===");



console.log("=== INITIALIZING EXPRESS ===");
const app = express();
const PORT = process.env.PORT || 3000;


const __dirname = path.dirname(fileURLToPath(import.meta.url));


app.use(cors());


app.use(fileUpload());
app.use(express.json());


const uploadDir = path.join(__dirname, "../uploads");
const outputDir = path.join(__dirname, "../output");

async function createDirectory(path) {
  try {
    await fs.access(path);
    console.log("Given Directory already exists !!");
  } catch (error) {
    
    try {
      await fs.mkdir(path, { recursive: true });
      console.log("New Directory created successfully !!");
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError);
    }
  }
}




app.get("/", (req, res) => {
  res.send("API is running!");
});


app.post('/perform-ocr', async (req, res) => {
  try {
    const { pdfUrl } = req.body;
    console.log('Received request with pdfUrl:', pdfUrl);

    if (!pdfUrl) {
      return res.status(400).json({ error: 'PDF URL is required' });
    }

    const result = await processImageWithAI(pdfUrl, process.env.TOGETHER_API_KEY);
    res.json(result);

  } catch (error) {
    console.error('Error processing OCR:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process OCR',
      details: error.message 
    });
  }
});


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


app.use("/output", express.static(outputDir));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

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
import { splitIntoParagraphs } from "../utils/pdf-utils.js";

import {
  initSchema,
  upsertRagDocuments,
  countDocuments,
  retrieveCandidates,
  rerank,
} from "./rag-pg.js";

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


app.use(express.static(path.join(__dirname, '../public')));


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
  res.sendFile(path.join(__dirname, '../public/index.html'));
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




// ---- RAG: init schema (one-time safe)
app.post("/rag/init", async (_req, res) => {
  try {
    await initSchema();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- RAG: upload PDF -> paragraphs -> embed -> store
app.post("/knowledgebase", async (req, res) => {
  try {
    if (!req.files || !req.files.pdf) {
      return res.status(400).json({ success: false, error: "No PDF file uploaded" });
    }
    const pdfFile = req.files.pdf;
    const text = await extractTextFromPDF(pdfFile.data);
    const paragraphs = splitIntoParagraphs(text);
    if (!paragraphs.length) {
      return res.status(400).json({ success: false, error: "No valid paragraphs found" });
    }

    const docs = paragraphs.map((p, i) => ({
      content: p,
      metadata: { type: "pdf_upload", source: pdfFile.name, paragraph: i + 1 },
    }));

    await upsertRagDocuments(docs);

    res.json({
      success: true,
      message: `Inserted ${docs.length} paragraphs`,
      file: pdfFile.name,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Failed to process PDF" });
  }
});

// ---- RAG: search + local re-ranking
//   /search?q=chromosomes&k=5&fetchK=20
app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").toString();
    const k = parseInt(req.query.k || "5", 10);
    const fetchK = parseInt(req.query.fetchK || "20", 10);
    if (!q) return res.status(400).json({ success: false, error: "Missing q" });

    const candidates = await retrieveCandidates(q, fetchK);
    const ranked = await rerank(q, candidates, k);

    res.json({
      success: true,
      query: q,
      topK: k,
      results: ranked,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/status", async (_req, res) => {
  try {
    const count = await countDocuments();
    res.json({ success: true, total_paragraphs: count });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});






app.get('/ping', (req, res) => {
  res.send('pong');
});

app.use("/output", express.static(outputDir));




app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});


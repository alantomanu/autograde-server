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
  const apiDocs = `
    <html>
      <head>
        <title>AutoGrade API Documentation</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
          }
          h1 {
            color: #2c3e50;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
          }
          .endpoint {
            background: #f8f9fa;
            padding: 15px;
            margin: 15px 0;
            border-radius: 5px;
          }
          code {
            background: #e9ecef;
            padding: 2px 5px;
            border-radius: 3px;
          }
          .method {
            font-weight: bold;
            color: #2c3e50;
          }
        </style>
      </head>
      <body>
        <h1 style="text-align: center;">AutoGrade API Documentation</h1>
        
        <p style="text-align: center;">Welcome to the AutoGrade API! This service helps you automatically grade answer sheets and process PDFs. Here's how to use our endpoints:</p>

        <div class="endpoint">
          <h2>1. Perform OCR on PDF</h2>
          <p><span class="method">POST</span> <code>/perform-ocr</code></p>
          <p>Extract text from a PDF using OCR technology. This process involves extracting images from the PDF, sending them to Meta LLaMA 90B for text extraction, and converting the results into a structured JSON format.</p>
          <p><strong>Request Body:</strong></p>
          <code>
            {
              "pdfUrl": "URL_TO_YOUR_PDF"
            }
          </code>
          <p><strong>Sample Output:</strong></p>
          <pre><code>
{
  "margin_number": "1",
  "answer": "Sample answer extracted from the PDF"
}
</code></pre>
        </div>

        <div class="endpoint">
          <h2>2. Convert PDF to JSON</h2>
          <p><span class="method">POST</span> <code>/convert-pdf</code></p>
          <p>Convert a PDF answer key into structured JSON data using the PDF parse module. This module extracts text and formats it into JSON.</p>
          <p><strong>Request Body:</strong></p>
          <code>
            {
              "pdfUrl": "URL_TO_YOUR_PDF"
            }
          </code>
          <p><strong>Sample Output:</strong></p>
          <pre><code>
{
  "questions": [
    {
      "question_number": "1",
      "logic": "Question: QUESTION_TEXT | Definition: X mark | Equation: Y mark | Unit: Z mark <br> &nbsp;&nbsp;&nbsp&nbsp&nbsp&nbsp;Irrelevant Data: W mark (max mark: TOTAL marks)",
      "diagram": true
    },
    
  ]
}
</code></pre>
        </div>

        <div class="endpoint">
          <h2>3. Evaluate Answer Sheet</h2>
          <p><span class="method">POST</span> <code>/evaluate</code></p>
          <p>Evaluate a complete answer sheet against an answer key using Meta LLaMA 3.3 70B. This AI model compares the student's answers with the answer key and provides a detailed evaluation.</p>
          <p><strong>Request Body:</strong></p>
          <p>Send the answer sheet data and answer key in the request body.</p>
        </div>

        <footer style="text-align: center; font-family: Arial, sans-serif; margin-top: 40px; padding: 20px; background-color: #f5f5f5; border-top: 1px solid #ddd;">
          <p style="margin: 8px 0; font-size: 16px;">
            For any questions or issues, please contact at 
            <a href="mailto:alantomanu501@gmail.com" style="color: #007BFF; text-decoration: none;">alantomanu501@gmail.com</a>
          </p>
          <p style="margin: 8px 0; font-size: 14px; color: #555;">
            &copy; <span id="year"></span> Autograde. All rights reserved.
          </p>
        </footer>

        <script>
          // Automatically set current year
          document.getElementById("year").textContent = new Date().getFullYear();
        </script>
      </body>
    </html>
  `;
  res.send(apiDocs);
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

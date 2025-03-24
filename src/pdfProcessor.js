// src/pdfProcessor.js

import pdf from 'pdf-parse';

// Function to extract text from the PDF
export const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:',error);
    throw new Error('Failed to extract text from PDF');
  }
};

// Function to parse the extracted text into JSON format
export const parseAnswerKeyToJSON = (text) => {
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\n+/g, '\n').trim();
  
  const lines = cleanText.split('\n')
    .map(line => line.trim())
    .filter(line => line && 
      line.toLowerCase() !== 'answer key' && 
      line.toLowerCase() !== 'question number grading logic');
  
  // Validate the format of the answer key
  const invalidLines = lines.filter(line => !/^\d+\s+.+/.test(line));
  if (invalidLines.length === lines.length) {
    throw new Error('Answer key does not follow the desired format. Please download the answer key template.');
  }

  const result = {};
  let currentQuestion = null;
  let currentDetails = '';

  lines.forEach(line => {
    // Look for lines starting with a number followed by text
    const questionMatch = line.match(/^(\d+)[\s|](.+)/);

    if (questionMatch) {
      // If we have a previous question stored, save it
      if (currentQuestion !== null) {
        // Create an object with logic and diagram flag
        result[currentQuestion] = {
          logic: currentDetails.trim(),
          diagram: hasDiagramReference(currentDetails)
        };
      }

      // Start new question
      currentQuestion = questionMatch[1];
      currentDetails = questionMatch[2];
    } else if (currentQuestion !== null) {
      // Append non-question lines to current question details
      currentDetails += ' ' + line;
    }
  });

  // Save the last question if exists
  if (currentQuestion !== null) {
    result[currentQuestion] = {
      logic: currentDetails.trim(),
      diagram: hasDiagramReference(currentDetails)
    };
  }

  return result;
};

// Helper function to check for diagram references
const hasDiagramReference = (text) => {
  const diagramKeywords = ['diagram', 'figure', 'fig', 'drawing', 'illustration','block diagram','flow chart','tabl'];
  return diagramKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
};
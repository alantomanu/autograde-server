// src/pdfProcessor.js

import pdf from 'pdf-parse';

// Function to extract text from the PDF
export const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
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
    const questionMatch = line.match(/^(\d+)\s*(.+)/);

    if (questionMatch) {
      if (currentQuestion !== null) {
        const maxMarkMatch = currentDetails.match(/\(max\.mark:(\d+)\)/);
        if (maxMarkMatch) {
          result[currentQuestion] = currentDetails.trim();
        } else {
          currentDetails += ' ' + line;
        }
      }

      currentQuestion = questionMatch[1];
      currentDetails = questionMatch[2];
    } else {
      if (currentQuestion !== null) {
        currentDetails += ' ' + line;
        
        const maxMarkMatch = currentDetails.match(/\(max\.mark:(\d+)\)/);
        if (maxMarkMatch) {
          result[currentQuestion] = currentDetails.trim();
          currentQuestion = null;
          currentDetails = '';
        }
      }
    }
  });

  if (currentQuestion !== null) {
    const maxMarkMatch = currentDetails.match(/\(max\.mark:(\d+)\)/);
    if (maxMarkMatch) {
      result[currentQuestion] = currentDetails.trim();
    }
  }

  return result;
};
// pdfUtils.js
import pdfParse from "pdf-parse";


export async function extractTextFromPDF(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}


export function splitIntoParagraphs(text) {
  return text
    .split(/\n\s*\n/)           
    .map(p => p.replace(/\s+/g, " ").trim()) 
    .filter(p => p.length > 30); 
}

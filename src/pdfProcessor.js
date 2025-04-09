

import pdf from 'pdf-parse';


export const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:',error);
    throw new Error('Failed to extract text from PDF');
  }
};


export const parseAnswerKeyToJSON = (text) => {
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\n+/g, '\n').trim();
  
  const lines = cleanText.split('\n')
    .map(line => line.trim())
    .filter(line => line && 
      line.toLowerCase() !== 'answer key' && 
      line.toLowerCase() !== 'question number grading logic');
  
 
  const invalidLines = lines.filter(line => !/^\d+\s+.+/.test(line));
  if (invalidLines.length === lines.length) {
    throw new Error('Answer key does not follow the desired format. Please download the answer key template.');
  }

  const result = {};
  let currentQuestion = null;
  let currentDetails = '';

  lines.forEach(line => {

    const questionMatch = line.match(/^(\d+)[\s|](.+)/);

    if (questionMatch) {
   
      if (currentQuestion !== null) {
   
        result[currentQuestion] = {
          logic: currentDetails.trim(),
          diagram: hasDiagramReference(currentDetails)
        };
      }


      currentQuestion = questionMatch[1];
      currentDetails = questionMatch[2];
    } else if (currentQuestion !== null) {
      
      currentDetails += ' ' + line;
    }
  });


  if (currentQuestion !== null) {
    result[currentQuestion] = {
      logic: currentDetails.trim(),
      diagram: hasDiagramReference(currentDetails)
    };
  }

  return result;
};


const hasDiagramReference = (text) => {
  const diagramKeywords = ['diagram', 'figure', 'fig', 'drawing', 'illustration','block diagram','flow chart','tabl'];
  return diagramKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
};
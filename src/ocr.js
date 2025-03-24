import Together from "together-ai";
import https from 'https';
import fs from "fs";
import pdf from "pdf-poppler";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getPDFPageCount(pdfPath) {
    console.log('Getting PDF page count for:', pdfPath);
    try {
        const opts = { format: "jpeg", out_dir: "./temp", out_prefix: "page" };
        const info = await pdf.info(pdfPath, opts);
        console.log('PDF info:', info);
        return info.pages || 1;
    } catch (error) {
        console.error('Error getting PDF page count:', error);
        throw error;
    }
}

function formatAnswersToJson(text) {
    const answers = [];
    const lines = text.split("\n");
    let currentMarginNumber = null;
    let currentAnswer = [];

    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (match) {
            if (currentMarginNumber !== null) {
                answers.push({ marginNumber: parseInt(currentMarginNumber), answer: currentAnswer.join(" ").trim() });
            }
            currentMarginNumber = match[1];
            currentAnswer = [match[2]];
        } else if (currentMarginNumber !== null) {
            currentAnswer.push(line);
        }
    }

    if (currentMarginNumber !== null) {
        answers.push({ marginNumber: parseInt(currentMarginNumber), answer: currentAnswer.join(" ").trim() });
    }

    return { answers };
}

function getImagePath(pageNumber) {
    return `./temp/page-${pageNumber.toString().padStart(2, "0")}.jpg`;
}

async function downloadFile(url, outputPath) {
    console.log('Downloading file from:', url);
    console.log('Saving to:', outputPath);
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                console.error('Download failed with status:', response.statusCode);
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const fileStream = fs.createWriteStream(outputPath);
            response.pipe(fileStream);

            fileStream.on('finish', () => {
                console.log('Download completed successfully');
                fileStream.close();
                resolve(outputPath);
            });

            fileStream.on('error', (err) => {
                console.error('Error writing file:', err);
                fs.unlink(outputPath, () => reject(err));
            });
        }).on('error', (err) => {
            console.error('Error downloading file:', err);
            reject(err);
        });
    });
}

async function processImageWithAI(pdfUrl, apiKey) {
    console.log('Starting processImageWithAI with URL:', pdfUrl);
    console.log('API Key provided:', apiKey ? 'Yes' : 'No');
    
    try {
        const result = await ocr({
            filePath: pdfUrl,
            apiKey: apiKey,
            model: "Llama-3.2-90B-Vision"
        });

        console.log('OCR processing completed');
        
        // Parse the JSON string back to an object if it isn't already an object
        const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('Parsed result:', parsedResult);
        return parsedResult;
    } catch (error) {
        console.error("Error in processImageWithAI:", error);
        console.error("Stack trace:", error.stack);
        throw error;
    }
}

async function convertPDFToImage(pdfPath, pageNumber) {
    const opts = {
        format: "jpeg",
        out_dir: "./temp",
        out_prefix: "page",
        page: pageNumber,
        quality: 100, // Higher quality for better OCR
    };

    await pdf.convert(pdfPath, opts);
    const generatedPath = `./temp/page-${pageNumber}.jpg`;
    const desiredPath = getImagePath(pageNumber);

    if (fs.existsSync(generatedPath) && generatedPath !== desiredPath) {
        fs.renameSync(generatedPath, desiredPath);
    }

    return desiredPath;
}

async function getMarkDown(params) {
    const finalImageUrl = isRemoteFile(params.filePath)
        ? params.filePath
        : `data:image/jpeg;base64,${encodeImage(params.filePath)}`;

    try {
        const output = await params.together.chat.completions.create({
            model: params.visionLLM,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: params.systemPrompt },
                        {
                            type: "image_url",
                            image_url: { url: finalImageUrl },
                        },
                    ],
                },
            ],
            max_tokens: 1024,
            temperature: 0.2, // Lower temperature for more accurate extraction
        });

        return output?.choices[0]?.message?.content || "";
    } catch (error) {
        console.error("Error in API call to Together AI:", error);
        return "Error processing this page.";
    }
}

function encodeImage(filePath) {
    return fs.readFileSync(filePath).toString("base64");
}

function processPageText(
  pageText,
  lastMarginNumber,
  lastAnswer,
  existingResponses,
  pageNumber,
  totalPages
) {
  const lines = pageText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  const responses = [...existingResponses];
  let currentMarginNumber = lastMarginNumber;
  let currentAnswer = [...lastAnswer];
  
  // Enhanced margin number detection regex
  const marginNumberRegex = /^(?:Question\s*)?(\d+)(?:\.|\s*[-:)\.]|\s*\)|\s+)(.*)$/i;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marginMatch = line.match(marginNumberRegex);
    
    if (marginMatch) {
      const newMarginNumber = parseInt(marginMatch[1]);
      const answerText = marginMatch[2].trim();
      
      // Always treat margin numbers as new answers on the last page
      if (newMarginNumber > 0 && newMarginNumber < 100) {
        if (currentMarginNumber !== null && currentAnswer.length > 0) {
          saveOrUpdateAnswer(responses, currentMarginNumber, currentAnswer.join(' ').trim());
        }
        
        currentMarginNumber = newMarginNumber;
        currentAnswer = answerText ? [answerText] : [];
      } else {
        if (currentMarginNumber !== null) {
          currentAnswer.push(line);
        }
      }
    } else {
      if (currentMarginNumber !== null) {
        currentAnswer.push(line);
      }
    }
  }

  // Always save the final answer from this page
  if (currentMarginNumber !== null && currentAnswer.length > 0) {
    saveOrUpdateAnswer(responses, currentMarginNumber, currentAnswer.join(' ').trim());
  }

  return {
    updatedResponses: responses,
    lastProcessedMargin: currentMarginNumber,
    lastProcessedAnswer: currentAnswer
  };
}

function saveOrUpdateAnswer(responses, marginNumber, answerText) {
  if (!answerText.trim()) return;
  
  const existingIndex = responses.findIndex(r => r.marginNumber === marginNumber);
  
  if (existingIndex === -1) {
    // Always create a new entry for a new margin number
    responses.push({
      marginNumber,
      answer: answerText.trim()
    });
  } else {
    // For existing answers, append with proper spacing
    const existingAnswer = responses[existingIndex].answer;
    const needsSpace = existingAnswer && 
                      !existingAnswer.endsWith(' ') && 
                      answerText && 
                      !answerText.startsWith(' ');
    responses[existingIndex].answer = existingAnswer + (needsSpace ? ' ' : '') + answerText;
    responses[existingIndex].answer = responses[existingIndex].answer.replace(/\s+/g, ' ').trim();
  }
}

async function ocr({
    filePath,
    apiKey,
    model = "Llama-3.2-90B-Vision",
}) {
    console.log('Starting OCR process with:', { filePath, model });
    let localFilePath = filePath;
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync('./temp')) {
        console.log('Creating temp directory');
        fs.mkdirSync('./temp', { recursive: true });
    }
    
    try {
        // Download file if it's a remote PDF
        if (isRemoteFile(filePath) && filePath.toLowerCase().endsWith('.pdf')) {
            console.log('Downloading remote PDF file');
            const tempPdfPath = path.join('./temp', 'temp.pdf');
            localFilePath = await downloadFile(filePath, tempPdfPath);
            console.log('PDF downloaded to:', localFilePath);
        }

        if (localFilePath.toLowerCase().endsWith(".pdf")) {
            console.log('Processing PDF file');
            const pageCount = await getPDFPageCount(localFilePath);
            console.log(`PDF has ${pageCount} pages`);
            let allResponses = [];
            let lastMarginNumber = null;
            let lastAnswer = [];

            console.log(`Processing PDF with ${pageCount} pages`);

            for (let page = 1; page <= pageCount; page++) {
                console.log(`Processing page ${page}/${pageCount}`);
                const imageFilePath = await convertPDFToImage(localFilePath, page);
                console.log(`Created image for page ${page} at: ${imageFilePath}`);
                
                const visionLLM = model === "free"
                    ? "meta-llama/Llama-Vision-Free"
                    : `meta-llama/${model}-Instruct-Turbo`;

                const together = new Together({ apiKey });
                
                const contextPrompt = `
                    Extract all answers from this exam answer sheet. Each answer begins with a margin number (e.g., "1.", "2.", etc.).

                    Rules:
                    1. Only extract margin numbers and their corresponding answers
                    2. If you see text without a margin number at the beginning of the page, it belongs to the previous answer
                    3. Only start a new answer when you see a new margin number
                    4. Format as: [Margin Number]. [Answer Text]
                    
                    Current last processed margin number: ${lastMarginNumber !== null ? lastMarginNumber : "None"}
                    
                    Just extract the text as it appears without adding any comments or explanations.
                `;

                console.log(`Sending page ${page} to Together AI for processing`);
                const pageText = await getMarkDown({
                    together,
                    visionLLM,
                    filePath: imageFilePath,
                    systemPrompt: contextPrompt
                });
                console.log(`Received response for page ${page}, text length: ${pageText.length}`);

                const { updatedResponses, lastProcessedMargin, lastProcessedAnswer } = 
                    processPageText(pageText, lastMarginNumber, lastAnswer, allResponses, page, pageCount);

                allResponses = updatedResponses;
                lastMarginNumber = lastProcessedMargin;
                lastAnswer = lastProcessedAnswer;

                console.log(`Processed page ${page}, current answers count: ${allResponses.length}`);

                // Clean up page image after processing
                if (fs.existsSync(imageFilePath)) {
                    fs.unlinkSync(imageFilePath);
                }
            }

            // Clean up downloaded PDF if it was temporary
            if (localFilePath !== filePath && fs.existsSync(localFilePath)) {
                fs.unlinkSync(localFilePath);
            }

            // Filter and clean up responses
            allResponses = allResponses
                .filter(answer => 
                    answer.marginNumber > 0 && 
                    answer.marginNumber < 100 && 
                    answer.answer.trim().length > 0
                )
                .sort((a, b) => a.marginNumber - b.marginNumber)
                .map(item => ({
                    marginNumber: item.marginNumber,
                    answer: item.answer.replace(/\s+/g, ' ').trim()
                }));

            console.log(`Final processed answers count: ${allResponses.length}`);
            return JSON.stringify({ answers: allResponses }, null, 2);
        } else {
            console.log('Processing single image file');
            // For single image files
            const textOutput = await getMarkDown({
                together: new Together({ apiKey }),
                visionLLM: `meta-llama/${model}-Instruct-Turbo`,
                filePath,
                systemPrompt: 'Extract margin numbers and their answers exactly as they appear. No formatting or explanation needed.'
            });

            return formatAnswersToJson(textOutput);
        }
    } catch (error) {
        console.error('Error in OCR process:', error);
        console.error('Stack trace:', error.stack);
        throw error;
    } finally {
        // Cleanup moved here after all processing is complete
        console.log('Cleaning up temporary files');
        if (fs.existsSync('./temp')) {
            fs.rmSync('./temp', { recursive: true, force: true });
        }
    }
}

// Add missing helper functions
function isRemoteFile(filePath) {
    return filePath.startsWith('http://') || filePath.startsWith('https://');
}

// Add this at the end to catch unhandled promise rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    console.error('Stack trace:', error.stack);
});

// Export using ES modules syntax
export { processImageWithAI }; 
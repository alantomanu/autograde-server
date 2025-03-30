import Together from "together-ai";
import https from 'https';
import fs from "fs";
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execPromise = promisify(exec);

async function getPDFPageCount(pdfPath) {
    console.log('Getting PDF page count for:', pdfPath);
    try {
        const { stdout } = await execPromise(`pdfinfo "${pdfPath}"`);
        const pages = stdout.match(/Pages:\s+(\d+)/);
        return pages ? parseInt(pages[1]) : 1;
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

function getImagePath(pageNumber, tempDir) {
    return path.join(tempDir, `page-${pageNumber.toString().padStart(2, "0")}.jpg`);
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

async function convertPDFToImage(pdfPath, pageNumber, tempDir) {
    try {
        // Create a base name for the output file without extension
        const baseName = path.join(tempDir, `page-${pageNumber.toString().padStart(2, "0")}`);
        
        console.log('PDF conversion details:', {
            pdfPath,
            baseName,
            tempDir,
            pageNumber
        });

        // Ensure the directory exists
        await fs.promises.mkdir(tempDir, { recursive: true });
        
        // Execute pdftoppm with more detailed options
        const command = `pdftoppm -jpeg -f ${pageNumber} -l ${pageNumber} -r 300 "${pdfPath}" "${baseName}"`;
        console.log('Executing command:', command);
        
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            console.error('pdftoppm stderr:', stderr);
        }
        
        // Wait for the file system
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check for both possible filenames
        const possibleFiles = [
            `${baseName}-1.jpg`,
            `${baseName}-${pageNumber}.jpg`
        ];
        
        console.log('Looking for output files:', possibleFiles);
        
        let outputFile = null;
        for (const file of possibleFiles) {
            if (fs.existsSync(file)) {
                outputFile = file;
                break;
            }
        }
        
        if (!outputFile) {
            console.error('Expected output file not found');
            const files = await fs.promises.readdir(tempDir);
            console.log('Files in temp directory:', files);
            throw new Error(`PDF conversion failed: output file not created. Checked paths: ${possibleFiles.join(', ')}`);
        }
        
        // Return the path to the found file
        console.log('Successfully created image at:', outputFile);
        return outputFile;
    } catch (error) {
        console.error('Error in convertPDFToImage:', error);
        console.error('Error details:', {
            message: error.message,
            command: error.cmd,
            stderr: error.stderr,
            stdout: error.stdout
        });
        throw error;
    }
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
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File does not exist: ${filePath}`);
            }
            return fs.readFileSync(filePath).toString("base64");
        } catch (error) {
            attempts++;
            if (attempts === maxAttempts) {
                throw error;
            }
            // Wait 1 second before retrying
            console.log(`Retry ${attempts} reading file: ${filePath}`);
            new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
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
    // Create a unique temp directory for this request
    const tempDir = path.join('./temp', Date.now().toString());
    console.log('Creating temp directory:', tempDir);
    
    try {
        await fs.promises.mkdir(tempDir, { recursive: true });
        let localFilePath = filePath;
        
        if (isRemoteFile(filePath)) {
            console.log('Downloading remote file:', filePath);
            const tempPdfPath = path.join(tempDir, 'temp.pdf');
            localFilePath = await downloadFile(filePath, tempPdfPath);
            console.log('Downloaded to:', localFilePath);
            
            // Verify the downloaded file exists and has content
            const stats = await fs.promises.stat(localFilePath);
            console.log('Downloaded file size:', stats.size);
            if (stats.size === 0) {
                throw new Error('Downloaded file is empty');
            }
        }

        if (localFilePath.toLowerCase().endsWith('.pdf')) {
            const pageCount = await getPDFPageCount(localFilePath);
            console.log(`Processing PDF with ${pageCount} pages from ${localFilePath}`);
            let allResponses = [];
            let lastMarginNumber = null;
            let lastAnswer = [];

            console.log(`Processing PDF with ${pageCount} pages`);

            for (let page = 1; page <= pageCount; page++) {
                console.log(`Processing page ${page}/${pageCount}`);
                const imageFilePath = await convertPDFToImage(localFilePath, page, tempDir);
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
        // Cleanup temp directory
        try {
            if (fs.existsSync(tempDir)) {
                const files = await fs.promises.readdir(tempDir);
                for (const file of files) {
                    await fs.promises.unlink(path.join(tempDir, file));
                }
                await fs.promises.rmdir(tempDir);
                console.log('Cleaned up temp directory:', tempDir);
            }
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError);
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
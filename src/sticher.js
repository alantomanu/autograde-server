import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function convertPdfToSingleImage(
  pdfPath,
  outputPath,
  options = {
    format: "png",
    outDir: "temp",
    density: 300,
    quality: 100,
  }
) {
  try {
    console.log('Starting PDF conversion...');
    
    // Create temp directory
    await fs.mkdir(options.outDir, { recursive: true });
    
    // Convert PDF to images using pdftoppm directly
    const tempOutputPrefix = path.join(options.outDir, 'page');
    const command = `pdftoppm -png -r ${options.density} "${pdfPath}" "${tempOutputPrefix}"`;
    
    console.log('Running conversion command:', command);
    await execPromise(command);

    // Read generated images
    console.log('Reading generated images...');
    const files = await fs.readdir(options.outDir);
    const imageFiles = files
      .filter((file) => file.startsWith("page"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0");
        const numB = parseInt(b.match(/\d+/)?.[0] || "0");
        return numA - numB;
      })
      .map((file) => path.join(options.outDir, file));

    if (imageFiles.length === 0) {
      throw new Error('No images were generated from PDF');
    }

    console.log(`Found ${imageFiles.length} images to process`);

    // Get dimensions
    const dimensions = await Promise.all(imageFiles.map((file) => sharp(file).metadata()));
    const maxWidth = Math.max(...dimensions.map((d) => d.width || 0));
    const totalHeight = dimensions.reduce((sum, dim) => sum + (dim.height || 0), 0);

    console.log(`Processing images with dimensions: ${maxWidth}x${totalHeight}`);

    // Resize images
    const resizedImages = await Promise.all(
      imageFiles.map(async (file, index) => ({
        buffer: await sharp(file).resize({ width: maxWidth }).toBuffer(),
        height: dimensions[index].height || 0,
      }))
    );

    // Create final stitched image
    console.log('Creating final stitched image...');
    let currentY = 0;
    const composite = sharp({
      create: {
        width: maxWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    });

    await composite
      .composite(resizedImages.map(({ buffer, height }) => ({
        input: buffer,
        top: (currentY += height) - height,
        left: 0
      })))
      .toFile(outputPath);

    // Cleanup
    console.log('Cleaning up temporary files...');
    await Promise.all(imageFiles.map((file) => fs.unlink(file)));

    // Remove the temp directory after all files are deleted
    await fs.rmdir(options.outDir);

    console.log("Successfully stitched:", outputPath);
  } catch (error) {
    console.error("Error in convertPdfToSingleImage:", error);
    throw error;
  }
}

export { convertPdfToSingleImage };

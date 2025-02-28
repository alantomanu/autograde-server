const cloudinary = require("cloudinary").v2;

// Configure Cloudinary with environment variables
const initializeCloudinary = () => {
    try {
        console.log("=== CONFIGURING CLOUDINARY ===");
        
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });
        
        // Verify configuration
        const config = cloudinary.config();
        console.log("Cloudinary Config Object:", {
            cloud_name: config.cloud_name,
            api_key: config.api_key ? "Present" : "Missing",
            api_secret: config.api_secret ? "Present" : "Missing"
        });
    } catch (error) {
        console.error("=== CLOUDINARY CONFIG ERROR ===");
        console.error(error);
        throw error;
    }
};

const uploadImage = async (imagePath, timestamp) => {
    const imageName = `stitched_${timestamp}`;
    
    const uploadResult = await cloudinary.uploader.upload(
        imagePath,
        {
            public_id: imageName,
            folder: 'stiched_image',
            resource_type: 'image',
            overwrite: true
        }
    );

    return {
        imageUrl: uploadResult.secure_url,
        optimizedUrl: cloudinary.url(`stiched_image/${imageName}`, {
            fetch_format: 'auto',
            quality: 'auto'
        })
    };
};

module.exports = { initializeCloudinary, uploadImage }; 
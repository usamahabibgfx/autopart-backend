const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const sharp = require('sharp');

// Max width (px) per upload folder. Logos/icons get aggressive downscaling;
// product/gallery images stay larger. `null` means no resize.
const FOLDER_MAX_WIDTH = {
    brands: 480,
    categories: 800,
    icons: 256,
};

const getMaxWidthForFolder = (folder) => {
    if (!folder) return null;
    return FOLDER_MAX_WIDTH[folder] ?? null;
};

exports.uploadImage = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    let filename = req.file.filename;

    try {
        // Optimize image with sharp to WebP format if it's an image file
        if (req.file.mimetype.startsWith('image/')) {
            const originalPath = req.file.path;
            const parsedPath = path.parse(originalPath);
            const optimizedFilename = `${parsedPath.name}.webp`;
            const optimizedPath = path.join(parsedPath.dir, optimizedFilename);

            const maxWidth = getMaxWidthForFolder(req.query.folder);
            let pipeline = sharp(originalPath);
            if (maxWidth) {
                pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
            }
            await pipeline.webp({ quality: 80, effort: 4 }).toFile(optimizedPath);

            // Delete the original file
            await fsPromises.unlink(originalPath).catch(err => console.error('Error deleting original image:', err));

            filename = optimizedFilename;
        }

        const relativePath = req.query.folder ? `${req.query.folder}/${filename}` : filename;
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${relativePath}`;

        res.status(200).json({
            success: true,
            data: fileUrl,
            message: 'Image uploaded successfully'
        });
    } catch (error) {
        console.error('Image processing error:', error);
        // Fallback to original file
        const relativePath = req.query.folder ? `${req.query.folder}/${filename}` : filename;
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${relativePath}`;
        res.status(200).json({
            success: true,
            data: fileUrl,
            message: 'Image uploaded successfully (unoptimized)'
        });
    }
};

exports.uploadFile = (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const relativePath = req.query.folder ? `${req.query.folder}/${req.file.filename}` : req.file.filename;
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${relativePath}`;

    res.status(200).json({
        success: true,
        data: fileUrl,
        message: 'File uploaded successfully'
    });
};

exports.uploadImages = async (req, res, next) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Please upload files' });
    }

    try {
        const fileUrls = await Promise.all(req.files.map(async (file) => {
            let filename = file.filename;

            if (file.mimetype.startsWith('image/')) {
                try {
                    const originalPath = file.path;
                    const parsedPath = path.parse(originalPath);
                    const optimizedFilename = `${parsedPath.name}.webp`;
                    const optimizedPath = path.join(parsedPath.dir, optimizedFilename);

                    const maxWidth = getMaxWidthForFolder(req.query.folder);
                    let pipeline = sharp(originalPath);
                    if (maxWidth) {
                        pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
                    }
                    await pipeline.webp({ quality: 80, effort: 4 }).toFile(optimizedPath);

                    // Delete original
                    await fsPromises.unlink(originalPath).catch(err => console.error('Error deleting original image:', err));

                    filename = optimizedFilename;
                } catch (err) {
                    console.error('Fast optimization err for file:', file.filename, err);
                    // Keep original filename if optimization fails
                }
            }
            const relativePath = req.query.folder ? `${req.query.folder}/${filename}` : filename;
            return `${req.protocol}://${req.get('host')}/uploads/${relativePath}`;
        }));

        res.status(200).json({
            success: true,
            data: fileUrls,
            message: 'Images uploaded successfully'
        });
    } catch (error) {
        console.error('Batch image processing error:', error);
        next(error);
    }
};

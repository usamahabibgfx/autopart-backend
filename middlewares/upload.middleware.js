const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists.
// UPLOAD_DIR lets uploads live OUTSIDE the project so they survive code updates/redeploys.
// Resolved relative to the app root (so "../uploads" → a sibling folder of the app), or used
// as-is if an absolute path is given. Falls back to the in-project ./uploads when unset.
const appRoot = path.join(__dirname, '..');
const uploadDir = process.env.UPLOAD_DIR
    ? path.resolve(appRoot, process.env.UPLOAD_DIR)
    : path.join(appRoot, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let targetDir = uploadDir;
        if (req.query.folder) {
            targetDir = path.join(uploadDir, req.query.folder);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
        }
        cb(null, targetDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter (images and documents)
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only image and PDF files are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

module.exports = upload;

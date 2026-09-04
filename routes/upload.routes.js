const express = require('express');
const { uploadImage, uploadImages, uploadFile } = require('../controllers/upload.controller');
const upload = require('../middlewares/upload.middleware');
const { protect, authorize } = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/image', protect, authorize('admin'), upload.single('image'), uploadImage);
router.post('/images', protect, authorize('admin'), upload.array('images', 5), uploadImages);
router.post('/document', protect, authorize('admin'), upload.single('file'), uploadFile);

module.exports = router;

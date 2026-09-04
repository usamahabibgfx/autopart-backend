const express = require('express');
const { getProducts, getProduct, createProduct, updateProduct, deleteProduct, bulkImport, bulkUpdateProducts, deleteProducts, getSuggestions, getSearchDropdown, subscribeStockNotification, getProductStats } = require('../controllers/product.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for temporary excel storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `bulk-import-${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

router.route('/')
    .get(getProducts)
    .post(protect, authorize('admin'), createProduct);

router.get('/stats', protect, authorize('admin'), getProductStats);
router.get('/suggestions', getSuggestions);
router.get('/search-dropdown', getSearchDropdown);

// Public: subscribe an email to a product's back-in-stock alert
router.post('/:id/notify-me', subscribeStockNotification);

router.post('/bulk-import', protect, authorize('admin'), upload.single('file'), bulkImport);
router.patch('/bulk-update', protect, authorize('admin'), bulkUpdateProducts);
router.delete('/bulk-delete', protect, authorize('admin'), deleteProducts);

router.route('/:id')
    .get(getProduct)
    .put(protect, authorize('admin'), updateProduct)
    .delete(protect, authorize('admin'), deleteProduct);

module.exports = router;

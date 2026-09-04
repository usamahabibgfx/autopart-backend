const express = require('express');
const router = express.Router();
const sellerController = require('../controllers/seller.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// Protect all seller routes and ensure they are sellers
router.use(protect);
router.use(authorize('seller', 'admin')); // Using admin as fallback for testing

// Dashboard stats
router.get('/stats', sellerController.getSellerDashboardStats);

// Products
router.get('/products', sellerController.getSellerProducts);
router.get('/products/:id', sellerController.getSellerProduct);
router.post('/products', sellerController.createSellerProduct);
router.put('/products/:id', sellerController.updateSellerProduct);
router.delete('/products/:id', sellerController.deleteSellerProduct);

// Orders
router.get('/orders', sellerController.getSellerOrders);
router.get('/orders/:id', sellerController.getSellerOrder);

module.exports = router;

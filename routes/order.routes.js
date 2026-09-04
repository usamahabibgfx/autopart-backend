const express = require('express');
const rateLimit = require('express-rate-limit');
const { createOrder, getMyOrders, getOrder, updateOrderStatus, tabbyWebhook, stripeWebhook } = require('../controllers/order.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

const router = express.Router();

// Checkout rate limiter — prevents order spam
const checkoutLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Limit each IP to 20 orders per hour
    message: { success: false, message: 'Too many orders placed from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Webhooks - must be BEFORE protect middleware (called server-to-server)
router.post('/webhook/tabby', tabbyWebhook);
router.post('/webhook/stripe', stripeWebhook);

router.use(protect);

router.route('/')
    .get(getMyOrders)
    .post(checkoutLimiter, createOrder);

router.route('/:id')
    .get(getOrder)
    .put(authorize('admin'), updateOrderStatus);

module.exports = router;

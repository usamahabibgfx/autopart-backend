const express = require('express');
const { getCoupons, getAvailableCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon } = require('../controllers/coupon.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

const router = express.Router();

// Public routes
router.get('/available', getAvailableCoupons);
router.post('/validate', validateCoupon);

router.use(protect);

// Admin routes
router.route('/')
    .get(authorize('admin'), getCoupons)
    .post(authorize('admin'), createCoupon);

router.route('/:id')
    .put(authorize('admin'), updateCoupon)
    .delete(authorize('admin'), deleteCoupon);

module.exports = router;

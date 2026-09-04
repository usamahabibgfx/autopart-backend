const express = require('express');
const { createReview, getProductReviews, deleteReview } = require('../controllers/review.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.route('/:productId')
    .get(getProductReviews);

router.route('/:id')
    .delete(protect, deleteReview);

router.route('/')
    .post(protect, createReview);

module.exports = router;

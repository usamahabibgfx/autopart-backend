const Review = require('../models/review.model');

exports.createReview = async (req, res, next) => {
    try {
        const { product_id, rating, comment } = req.body;
        const user_id = req.user.id;

        const reviewId = await Review.create({
            product_id,
            user_id,
            rating,
            comment
        });

        res.status(201).json({
            success: true,
            data: { id: reviewId },
            message: 'Review added successfully'
        });
    } catch (error) {
        next(error);
    }
};

exports.getProductReviews = async (req, res, next) => {
    try {
        const reviews = await Review.getByProduct(req.params.productId);
        const stats = await Review.getAverageRating(req.params.productId);

        res.json({
            success: true,
            data: reviews,
            stats
        });
    } catch (error) {
        next(error);
    }
};

exports.getAllReviews = async (req, res, next) => {
    try {
        const reviews = await Review.getAll();
        res.json({
            success: true,
            data: reviews
        });
    } catch (error) {
        next(error);
    }
};

exports.deleteReview = async (req, res, next) => {
    try {
        const review = await Review.findById(req.params.id);

        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        // Make sure user is review owner or admin
        if (review.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: 'Not authorized to delete this review' });
        }

        await Review.delete(req.params.id);

        res.json({
            success: true,
            message: 'Review removed'
        });
    } catch (error) {
        next(error);
    }
};

const Wishlist = require('../models/wishlist.model');

exports.getWishlist = async (req, res, next) => {
    try {
        const items = await Wishlist.getByUser(req.user.id);
        res.json({ success: true, data: items });
    } catch (error) {
        next(error);
    }
};

exports.addToWishlist = async (req, res, next) => {
    try {
        await Wishlist.add(req.user.id, req.body.product_id);
        res.json({ success: true, message: 'Added to wishlist' });
    } catch (error) {
        next(error);
    }
};

exports.removeFromWishlist = async (req, res, next) => {
    try {
        await Wishlist.remove(req.user.id, req.params.productId);
        res.json({ success: true, message: 'Removed from wishlist' });
    } catch (error) {
        next(error);
    }
};

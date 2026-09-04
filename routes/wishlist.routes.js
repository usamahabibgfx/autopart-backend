const express = require('express');
const { getWishlist, addToWishlist, removeFromWishlist } = require('../controllers/wishlist.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getWishlist)
    .post(addToWishlist);

router.delete('/:productId', removeFromWishlist);

module.exports = router;

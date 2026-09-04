const express = require('express');
const { getCart, addToCart, updateCartItem, removeFromCart, clearCart } = require('../controllers/cart.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getCart)
    .post(addToCart)
    .delete(clearCart);

router.route('/update')
    .put(updateCartItem);

router.route('/:id')
    .delete(removeFromCart);

module.exports = router;

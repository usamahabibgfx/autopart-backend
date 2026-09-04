const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { register, login, googleLogin, getMe, updateMe, logout, forgotPassword, resetPassword, updateLocale } = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // Limit each IP to 30 requests per windowMs
    message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes' }
});

router.post('/register', authLimiter, [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    validate
], register);

router.post('/login', authLimiter, [
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').exists().withMessage('Password is required'),
    validate
], login);

router.post('/google-login', googleLogin);

router.get('/logout', logout);

router.post('/forgot-password', authLimiter, [
    body('email').isEmail().withMessage('Please include a valid email'),
    validate
], forgotPassword);

router.post('/reset-password', authLimiter, [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    validate
], resetPassword);

router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.post('/locale', protect, updateLocale);

module.exports = router;

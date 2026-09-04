const express = require('express');
const rateLimit = require('express-rate-limit');
const {
    sendOtp, checkOtp,
    sendEmailOtpForProfile, verifyEmailOtpForProfile,
    sendSignupOtp, verifySignupOtp
} = require('../controllers/verify.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

const sendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many OTP requests. Please wait a minute.' }
});

const checkLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please wait a minute.' }
});

// Public — signup OTP flow (account created only after OTP verified)
router.post('/signup/send-otp', sendLimiter, sendSignupOtp);
router.post('/signup/verify-otp', checkLimiter, verifySignupOtp);

// Authenticated — phone OTP (existing) + profile email change
router.post('/send-otp', protect, sendLimiter, sendOtp);
router.post('/check-otp', protect, checkLimiter, checkOtp);
router.post('/email/send-otp', protect, sendLimiter, sendEmailOtpForProfile);
router.post('/email/verify-otp', protect, checkLimiter, verifyEmailOtpForProfile);

module.exports = router;

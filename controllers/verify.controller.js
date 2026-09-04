const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const whatsapp = require('../services/whatsapp.service');
const { sendOtpEmail, sendWelcomeEmail } = require('../utils/sendEmail');

/**
 * Generate a random 6-digit OTP
 */
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (e) => typeof e === 'string' && EMAIL_RE.test(e.trim());

const sendAuthCookie = (user, res) => {
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/'
    });
    return token;
};

exports.sendOtp = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const phone = (req.body.phone || user.phone_number || '').trim();
        if (!phone) return res.status(400).json({ success: false, message: 'No phone number on file. Add one in your profile first.' });

        if (!whatsapp.isConfigured()) {
            return res.status(503).json({ success: false, message: 'WhatsApp service not configured' });
        }

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Save OTP to database
        await User.saveOtp(req.user.id, otp, expiresAt);

        // Send via WhatsApp
        await whatsapp.sendOtp(phone, otp);

        const formatted = whatsapp.formatPhone(phone);
        const masked = formatted.slice(0, formatted.length - 4).replace(/\d/g, '*') + formatted.slice(-4);

        res.json({ success: true, message: 'OTP sent via WhatsApp', phone: masked });
    } catch (err) {
        console.error('Send OTP Error:', err);
        next(err);
    }
};

exports.checkOtp = async (req, res, next) => {
    try {
        const { code } = req.body;
        if (!code || String(code).length !== 6) {
            return res.status(400).json({ success: false, message: 'Invalid OTP format. Must be 6 digits.' });
        }

        const user = await User.getOtp(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.otp_code || user.otp_code !== String(code)) {
            return res.status(400).json({ success: false, message: 'Invalid verification code' });
        }

        if (new Date() > new Date(user.otp_expires_at)) {
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
        }

        const fullUser = await User.findById(req.user.id);
        const phone = (req.body.phone || fullUser.phone_number || '').trim();

        // Mark as verified and clear OTP
        await User.setPhoneVerified(req.user.id, phone);

        // Possibly award the profile-completion bonus (atomic, idempotent).
        const bonusAwarded = await User.awardProfileBonusIfEligible(req.user.id);

        res.json({
            success: true,
            message: 'Phone verified successfully',
            phone_verified: 1,
            bonus_awarded: bonusAwarded,
            bonus_points: bonusAwarded ? 3000 : 0
        });
    } catch (err) {
        console.error('Check OTP Error:', err);
        next(err);
    }
};

// =========================
// Email OTP — profile email change (authenticated)
// =========================

exports.sendEmailOtpForProfile = async (req, res, next) => {
    try {
        const newEmail = String(req.body.email || '').trim().toLowerCase();
        if (!isValidEmail(newEmail)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
        }

        const me = await User.findById(req.user.id);
        if (!me) return res.status(404).json({ success: false, message: 'User not found' });

        if (me.email && me.email.toLowerCase() === newEmail && me.email_verified) {
            return res.status(400).json({ success: false, message: 'This email is already verified on your account' });
        }

        const existing = await User.findByEmail(newEmail);
        if (existing && existing.id !== req.user.id) {
            return res.status(409).json({ success: false, message: 'This email is already in use by another account' });
        }

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await User.saveEmailOtp(req.user.id, newEmail, otp, expiresAt);
        // Fire-and-forget — SMTP latency must not block the HTTP response.
        const ecLocale = String(req.body?.locale || req.headers?.['x-locale'] || req.cookies?.NEXT_LOCALE || req.headers?.['accept-language'] || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
        sendOtpEmail(newEmail, me.name, otp, { purpose: 'email-change', locale: ecLocale })
            .catch(err => console.error('[OTP] Failed to send email-change OTP:', err.message));

        res.json({ success: true, message: 'Verification code sent to your email', email: maskEmail(newEmail) });
    } catch (err) {
        console.error('Send Email OTP Error:', err);
        next(err);
    }
};

exports.verifyEmailOtpForProfile = async (req, res, next) => {
    try {
        const code = String(req.body.code || '').trim();
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ success: false, message: 'Invalid OTP format. Must be 6 digits.' });
        }

        const row = await User.getEmailOtp(req.user.id);
        if (!row || !row.email_otp_code || !row.pending_email) {
            return res.status(400).json({ success: false, message: 'No pending email verification. Request a new code.' });
        }
        if (row.email_otp_code !== code) {
            return res.status(400).json({ success: false, message: 'Invalid verification code' });
        }
        if (new Date() > new Date(row.email_otp_expires_at)) {
            return res.status(400).json({ success: false, message: 'Code expired. Please request a new one.' });
        }

        // Re-check uniqueness right before commit
        const existing = await User.findByEmail(row.pending_email);
        if (existing && existing.id !== req.user.id) {
            await User.clearEmailOtp(req.user.id);
            return res.status(409).json({ success: false, message: 'This email is already in use by another account' });
        }

        await User.setEmailVerified(req.user.id, row.pending_email);
        const bonusAwarded = await User.awardProfileBonusIfEligible(req.user.id);
        const updated = await User.findById(req.user.id);
        res.json({
            success: true,
            message: 'Email verified successfully',
            data: updated,
            bonus_awarded: bonusAwarded,
            bonus_points: bonusAwarded ? 3000 : 0
        });
    } catch (err) {
        console.error('Verify Email OTP Error:', err);
        next(err);
    }
};

// =========================
// Signup OTP — account created only after OTP verified (public)
// =========================

exports.sendSignupOtp = async (req, res, next) => {
    try {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
        if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
        if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

        const existing = await User.findByEmail(email);
        if (existing) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        await User.signupOtpUpsert({ email, name, passwordHash, code: otp, expiresAt });
        // Fire-and-forget — SMTP latency must not block the HTTP response.
        const otpLocale = String(req.body?.locale || req.headers?.['x-locale'] || req.cookies?.NEXT_LOCALE || req.headers?.['accept-language'] || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
        sendOtpEmail(email, name, otp, { purpose: 'signup', locale: otpLocale })
            .catch(err => console.error('[OTP] Failed to send signup OTP:', err.message));

        res.json({ success: true, message: 'Verification code sent to your email', email: maskEmail(email) });
    } catch (err) {
        console.error('Send Signup OTP Error:', err);
        next(err);
    }
};

exports.verifySignupOtp = async (req, res, next) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();
        if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Invalid email' });
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: 'Invalid OTP format. Must be 6 digits.' });

        const pending = await User.signupOtpFind(email);
        if (!pending) return res.status(400).json({ success: false, message: 'No pending signup found. Please start again.' });

        if (pending.attempts >= 6) {
            await User.signupOtpDelete(email);
            return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please start over.' });
        }

        if (pending.otp_code !== code) {
            await User.signupOtpIncrementAttempts(email);
            return res.status(400).json({ success: false, message: 'Invalid verification code' });
        }

        if (new Date() > new Date(pending.otp_expires_at)) {
            return res.status(400).json({ success: false, message: 'Code expired. Please request a new one.' });
        }

        // Race-safety: someone may have registered the email in the meantime
        const existing = await User.findByEmail(email);
        if (existing) {
            await User.signupOtpDelete(email);
            return res.status(409).json({ success: false, message: 'An account with this email already exists' });
        }

        const userId = await User.createWithHash({ name: pending.name, email, passwordHash: pending.password_hash });
        await User.signupOtpDelete(email);

        const wLocale = String(req.body?.locale || req.headers?.['x-locale'] || req.cookies?.NEXT_LOCALE || req.headers?.['accept-language'] || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
        User.updatePreferredLocale(userId, wLocale).catch(() => {});
        sendWelcomeEmail(email, pending.name, wLocale).catch(err => console.error('Failed to send welcome email:', err));

        const user = { id: userId, name: pending.name, email, role: 'user', reward_points: 1000, email_verified: 1 };
        const token = sendAuthCookie(user, res);
        res.status(201).json({ success: true, token, user });
    } catch (err) {
        console.error('Verify Signup OTP Error:', err);
        next(err);
    }
};

function maskEmail(email) {
    const [local, domain] = String(email).split('@');
    if (!domain) return email;
    const visible = local.slice(0, Math.min(3, local.length));
    return `${visible}${'*'.repeat(Math.max(0, local.length - visible.length))}@${domain}`;
}

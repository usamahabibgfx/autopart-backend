const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/user.model');
const { sendPasswordResetEmail, sendWelcomeEmail } = require('../utils/sendEmail');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

// Resolve the user's UI language from the request so emails match the site language.
// Priority: explicit body.locale → x-locale header → NEXT_LOCALE cookie → Accept-Language.
const getReqLocale = (req) => {
    const raw =
        req.body?.locale ||
        req.headers?.['x-locale'] ||
        req.cookies?.NEXT_LOCALE ||
        req.headers?.['accept-language'] ||
        'en';
    return String(raw).toLowerCase().startsWith('ar') ? 'ar' : 'en';
};

const sendTokenResponse = (user, statusCode, res) => {
    const token = generateToken(user.id);
    const isProduction = process.env.NODE_ENV === 'production';

    const options = {
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-domain cookies (Vercel <-> Render)
        path: '/'
    };

    res.status(statusCode).cookie('token', token, options).json({
        success: true,
        token,
        user
    });
};

exports.register = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        const userExists = await User.findByEmail(email);
        if (userExists) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        const userId = await User.create({ name, email, password });
        const user = { id: userId, name, email, role: 'user', reward_points: 1000 };

        const locale = getReqLocale(req);
        User.updatePreferredLocale(userId, locale).catch(() => {});

        // Send Welcome Email in the user's language
        sendWelcomeEmail(email, name, locale).catch(err => console.error('Failed to send welcome email:', err));

        sendTokenResponse(user, 201, res);
    } catch (error) {
        next(error);
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const user = await User.findByEmail(email);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // Check if user is suspended
        if (user.status === 'suspended') {
            return res.status(403).json({
                success: false,
                type: 'ACCOUNT_SUSPENDED',
                message: 'Your account has been suspended. Please contact admin for more details.'
            });
        }

        sendTokenResponse({
            id: user.id,
            name: user.name,
            email: user.email,
            email_verified: user.email_verified ? 1 : 0,
            role: user.role,
            phone_number: user.phone_number,
            phone_verified: user.phone_verified ? 1 : 0,
            company_name: user.company_name,
            vat_number: user.vat_number,
            reward_points: user.reward_points,
            staff_permissions: user.staff_permissions ?? null
        }, 200, res);
    } catch (error) {
        next(error);
    }
};

exports.googleLogin = async (req, res, next) => {
    try {
        const { token } = req.body;

        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            return res.status(401).json({ success: false, message: 'Invalid Google Token' });
        }

        const { name, email, picture } = await response.json();

        let user = await User.findByEmail(email);

        if (!user) {
            const randomPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
            const userId = await User.create({ name, email, password: randomPassword });
            // Google has already verified the email — mark it so the user doesn't see an unnecessary verify prompt.
            await User.markCurrentEmailVerified(userId);
            user = await User.findById(userId);

            // Send Welcome Email for new Google users in their language
            const gLocale = getReqLocale(req);
            User.updatePreferredLocale(userId, gLocale).catch(() => {});
            sendWelcomeEmail(email, name, gLocale).catch(err => console.error('Failed to send welcome email (Google):', err));
        } else if (!user.email_verified) {
            // Existing account signing in via Google for the first time — trust Google's email verification.
            await User.markCurrentEmailVerified(user.id);
            user.email_verified = 1;
        }

        // Check if user is suspended
        if (user.status === 'suspended') {
            return res.status(403).json({
                success: false,
                type: 'ACCOUNT_SUSPENDED',
                message: 'Your account has been suspended. Please contact admin for more details.'
            });
        }

        // Email is now verified — try to award the profile-completion bonus
        // (will only succeed when phone is also verified and name is set).
        const bonusAwarded = await User.awardProfileBonusIfEligible(user.id);
        if (bonusAwarded) {
            const refreshed = await User.findById(user.id);
            user.reward_points = refreshed.reward_points;
        }

        sendTokenResponse({
            id: user.id,
            name: user.name,
            email: user.email,
            email_verified: user.email_verified ? 1 : 0,
            role: user.role,
            phone_number: user.phone_number,
            phone_verified: user.phone_verified ? 1 : 0,
            company_name: user.company_name,
            vat_number: user.vat_number,
            reward_points: user.reward_points,
            staff_permissions: user.staff_permissions ?? null,
            bonus_awarded: bonusAwarded,
            bonus_points: bonusAwarded ? 3000 : 0
        }, 200, res);
    } catch (error) {
        console.error('Google login error:', error);
        res.status(401).json({ success: false, message: 'Google authentication failed' });
    }
};

exports.getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

exports.updateMe = async (req, res, next) => {
    try {
        const success = await User.update(req.user.id, req.body);
        if (success) {
            const updatedUser = await User.findById(req.user.id);
            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: updatedUser
            });
        } else {
            res.status(400).json({ success: false, message: 'Failed to update profile' });
        }
    } catch (error) {
        next(error);
    }
};

exports.logout = async (req, res, next) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', 'none', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/'
    });
    res.status(200).json({ success: true, data: {} });
};

exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        const user = await User.findByEmail(email);

        if (!user) {
            return res.status(404).json({ success: false, message: 'No account found with that email address' });
        }

        // Generate a cryptographically secure random token
        const resetToken = crypto.randomBytes(32).toString('hex');

        // Hash the token before storing in DB
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        // Token expires in 15 minutes
        const expires = new Date(Date.now() + 15 * 60 * 1000);

        // Save hashed token and expiry to user record
        await User.setResetToken(user.id, hashedToken, expires);

        // Build the reset URL — the unhashed token goes in the URL
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

        // Send email in the user's preferred language (fall back to request locale)
        const resetLocale = user.preferred_locale || getReqLocale(req);
        await sendPasswordResetEmail(user.email, user.name, resetUrl, resetLocale);

        res.json({ success: true, message: 'Password reset link sent to your email' });
    } catch (error) {
        console.error('Forgot password error:', error);
        next(error);
    }
};

// Persist the logged-in user's email language preference (called when they toggle EN/AR).
exports.updateLocale = async (req, res, next) => {
    try {
        const locale = String(req.body?.locale || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
        await User.updatePreferredLocale(req.user.id, locale);
        res.json({ success: true, locale });
    } catch (error) {
        next(error);
    }
};

exports.resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ success: false, message: 'Token and new password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        // Hash the incoming token to compare with DB
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // Find user with valid (non-expired) token
        const user = await User.findByResetToken(hashedToken);

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
        }

        // Update the password
        await User.update(user.id, { password });

        // Clear the reset token so it can't be reused
        await User.clearResetToken(user.id);

        res.json({ success: true, message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        next(error);
    }
};


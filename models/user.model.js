const db = require('../config/db');
const bcrypt = require('bcryptjs');

class User {
    static async findByEmail(email) {
        const [rows] = await db.execute(
            'SELECT u.*, COALESCE(u.status, \'active\') as status, r.name as role FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.email = ?',
            [email]
        );
        return rows[0];
    }

    static async findById(id) {
        const [rows] = await db.execute(
            'SELECT u.id, u.name, u.email, u.email_verified, u.pending_email, u.phone_number, u.phone_verified, u.company_name, u.vat_number, u.reward_points, u.profile_bonus_awarded, u.staff_permissions, r.name as role FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
            [id]
        );
        return rows[0];
    }

    static async setPhoneVerified(id, phone) {
        await db.execute(
            'UPDATE users SET phone_verified = 1, phone_number = ?, otp_code = NULL, otp_expires_at = NULL WHERE id = ?',
            [phone, id]
        );
    }

    static async saveOtp(userId, code, expiresAt) {
        await db.execute(
            'UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?',
            [code, expiresAt, userId]
        );
    }

    static async getOtp(userId) {
        const [rows] = await db.execute(
            'SELECT otp_code, otp_expires_at FROM users WHERE id = ?',
            [userId]
        );
        return rows[0];
    }

    static async clearOtp(userId) {
        await db.execute(
            'UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?',
            [userId]
        );
    }

    // --- Email OTP (profile email change) ---

    static async saveEmailOtp(userId, pendingEmail, code, expiresAt) {
        await db.execute(
            'UPDATE users SET pending_email = ?, email_otp_code = ?, email_otp_expires_at = ? WHERE id = ?',
            [pendingEmail, code, expiresAt, userId]
        );
    }

    static async getEmailOtp(userId) {
        const [rows] = await db.execute(
            'SELECT pending_email, email_otp_code, email_otp_expires_at FROM users WHERE id = ?',
            [userId]
        );
        return rows[0];
    }

    static async setEmailVerified(userId, email) {
        await db.execute(
            'UPDATE users SET email = ?, email_verified = 1, pending_email = NULL, email_otp_code = NULL, email_otp_expires_at = NULL WHERE id = ?',
            [email, userId]
        );
    }

    /**
     * Mark an existing user's current email as verified, without changing the address.
     * Used by Google login (Google attests the email is verified).
     */
    static async markCurrentEmailVerified(userId) {
        await db.execute('UPDATE users SET email_verified = 1 WHERE id = ?', [userId]);
    }

    /**
     * Atomic "award profile-completion bonus" check.
     * Adds +3000 reward_points and sets profile_bonus_awarded = 1 ONLY when
     * the user has name + verified email + verified phone AND hasn't been
     * awarded before. The conditions live inside the UPDATE so two concurrent
     * verifications can't double-award.
     *
     * @returns {Promise<boolean>} true when the bonus was just awarded.
     */
    static async awardProfileBonusIfEligible(userId, bonus = 3000) {
        const [result] = await db.execute(
            `UPDATE users
                SET reward_points = reward_points + ?, profile_bonus_awarded = 1
              WHERE id = ?
                AND profile_bonus_awarded = 0
                AND email_verified = 1
                AND phone_verified = 1
                AND name IS NOT NULL AND name <> ''`,
            [bonus, userId]
        );
        const awarded = result.affectedRows > 0;
        // Log the bonus so it appears in the rewards statement and matches the
        // live balance. Only on the run that actually awarded it. Non-fatal.
        if (awarded) {
            try {
                await db.execute(
                    "INSERT INTO reward_points_history (user_id, points, transaction_type, description) VALUES (?, ?, 'earned', 'Profile completion bonus')",
                    [userId, bonus]
                );
            } catch (e) { console.error('[Rewards] profile-bonus history insert failed:', e.message); }
        }
        return awarded;
    }

    static async clearEmailOtp(userId) {
        await db.execute(
            'UPDATE users SET pending_email = NULL, email_otp_code = NULL, email_otp_expires_at = NULL WHERE id = ?',
            [userId]
        );
    }

    // --- Signup OTP (account created only after OTP verified) ---

    static async signupOtpUpsert({ email, name, passwordHash, code, expiresAt }) {
        await db.execute(
            `INSERT INTO signup_otps (email, name, password_hash, otp_code, otp_expires_at, attempts, created_at)
             VALUES (?, ?, ?, ?, ?, 0, NOW())
             ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash),
               otp_code = VALUES(otp_code), otp_expires_at = VALUES(otp_expires_at), attempts = 0, created_at = NOW()`,
            [email, name, passwordHash, code, expiresAt]
        );
    }

    static async signupOtpFind(email) {
        const [rows] = await db.execute(
            'SELECT email, name, password_hash, otp_code, otp_expires_at, attempts FROM signup_otps WHERE email = ?',
            [email]
        );
        return rows[0];
    }

    static async signupOtpIncrementAttempts(email) {
        await db.execute('UPDATE signup_otps SET attempts = attempts + 1 WHERE email = ?', [email]);
    }

    static async signupOtpDelete(email) {
        await db.execute('DELETE FROM signup_otps WHERE email = ?', [email]);
    }

    static async createWithHash({ name, email, passwordHash }) {
        const [result] = await db.execute(
            "INSERT INTO users (name, email, password, role_id, reward_points, email_verified) VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'user'), 1000, 1)",
            [name, email, passwordHash]
        );
        const userId = result.insertId;
        // Log the 1000 welcome points so they appear in the rewards statement. Non-fatal.
        try {
            await db.execute(
                "INSERT INTO reward_points_history (user_id, points, transaction_type, description) VALUES (?, 1000, 'earned', 'Welcome bonus')",
                [userId]
            );
        } catch (e) { console.error('[Rewards] welcome-bonus history insert failed:', e.message); }
        return userId;
    }

    static async update(id, data) {
        const fields = [];
        const values = [];

        if (data.name) {
            fields.push('name = ?');
            values.push(data.name);
        }
        if (data.phone_number !== undefined) {
            fields.push('phone_verified = CASE WHEN phone_number = ? THEN phone_verified ELSE 0 END');
            fields.push('phone_number = ?');
            values.push(data.phone_number, data.phone_number);
        }
        if (data.company_name !== undefined) {
            fields.push('company_name = ?');
            values.push(data.company_name);
        }
        if (data.vat_number !== undefined) {
            fields.push('vat_number = ?');
            values.push(data.vat_number);
        }
        if (data.password) {
            const hashedPassword = await bcrypt.hash(data.password, 10);
            fields.push('password = ?');
            values.push(hashedPassword);
        }

        if (fields.length === 0) return false;

        values.push(id);
        const [result] = await db.execute(
            `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
        return result.affectedRows > 0;
    }

    static async create({ name, email, password }) {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            "INSERT INTO users (name, email, password, role_id, reward_points) VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'user'), 1000)",
            [name, email, hashedPassword]
        );
        const userId = result.insertId;
        // Log the 1000 welcome points so they appear in the rewards statement. Non-fatal.
        try {
            await db.execute(
                "INSERT INTO reward_points_history (user_id, points, transaction_type, description) VALUES (?, 1000, 'earned', 'Welcome bonus')",
                [userId]
            );
        } catch (e) { console.error('[Rewards] welcome-bonus history insert failed:', e.message); }
        return userId;
    }

    // Preferred email language ('en' | 'ar'). Used to localize outgoing emails.
    static async updatePreferredLocale(userId, locale) {
        const loc = String(locale).startsWith('ar') ? 'ar' : 'en';
        await db.execute('UPDATE users SET preferred_locale = ? WHERE id = ?', [loc, userId]);
    }

    static async getPreferredLocale(userId) {
        try {
            const [rows] = await db.execute('SELECT preferred_locale FROM users WHERE id = ?', [userId]);
            return rows[0]?.preferred_locale || 'en';
        } catch (_) { return 'en'; }
    }

    static async createByAdmin({ name, email, password, role_id }) {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            'INSERT INTO users (name, email, password, role_id, reward_points) VALUES (?, ?, ?, ?, 0)',
            [name, email, hashedPassword, role_id]
        );
        return result.insertId;
    }

    static async updatePoints(userId, points, type) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const updateQuery = type === 'earned'
                ? 'UPDATE users SET reward_points = reward_points + ? WHERE id = ?'
                : 'UPDATE users SET reward_points = reward_points - ? WHERE id = ?';

            await connection.execute(updateQuery, [points, userId]);

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    /**
     * Store a hashed reset token and expiry for a user
     */
    static async setResetToken(userId, hashedToken, expires) {
        await db.execute(
            'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
            [hashedToken, expires, userId]
        );
    }

    /**
     * Find user by hashed reset token that hasn't expired
     */
    static async findByResetToken(hashedToken) {
        const [rows] = await db.execute(
            'SELECT u.id, u.name, u.email, r.name as role FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.reset_password_token = ? AND u.reset_password_expires > NOW()',
            [hashedToken]
        );
        return rows[0];
    }

    /**
     * Clear the reset token fields after password has been reset
     */
    static async clearResetToken(userId) {
        await db.execute(
            'UPDATE users SET reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
            [userId]
        );
    }
}

module.exports = User;

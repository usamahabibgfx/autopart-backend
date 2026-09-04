const db = require('../config/db');

class Address {
    static async getByUser(userId) {
        const [rows] = await db.execute('SELECT * FROM addresses WHERE user_id = ?', [userId]);
        return rows;
    }

    static async create(userId, data) {
        const address_type = ['home', 'work', 'other'].includes(data.address_type) ? data.address_type : 'other';

        if (address_type === 'home' || address_type === 'work') {
            const [existing] = await db.execute(
                'SELECT id FROM addresses WHERE user_id = ? AND address_type = ?',
                [userId, address_type]
            );
            if (existing.length) {
                const err = new Error(`You can only save one ${address_type} address.`);
                err.statusCode = 400;
                throw err;
            }
        }

        if (data.is_default) {
            await db.execute('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
        }

        const { first_name, last_name, company_name, email, address_line1, address_line2, city, state, zip_code, country, phone, is_default } = data;
        const address_label = address_type === 'other' ? (data.address_label || null) : null;
        const [result] = await db.execute(
            `INSERT INTO addresses (user_id, address_type, address_label, first_name, last_name, company_name, email, address_line1, address_line2, city, state, zip_code, country, phone, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, address_type, address_label, first_name || null, last_name || null, company_name || null, email || null, address_line1, address_line2 || null, city, state || null, zip_code, country, phone, is_default]
        );
        return result.insertId;
    }

    static async delete(userId, addressId) {
        await db.execute('DELETE FROM addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
    }

    static async update(userId, addressId, data) {
        const address_type = ['home', 'work', 'other'].includes(data.address_type) ? data.address_type : 'other';

        if (address_type === 'home' || address_type === 'work') {
            const [existing] = await db.execute(
                'SELECT id FROM addresses WHERE user_id = ? AND address_type = ? AND id != ?',
                [userId, address_type, addressId]
            );
            if (existing.length) {
                const err = new Error(`You can only save one ${address_type} address.`);
                err.statusCode = 400;
                throw err;
            }
        }

        if (data.is_default) {
            await db.execute('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
        }

        const { first_name, last_name, company_name, email, address_line1, address_line2, city, state, zip_code, country, phone, is_default } = data;
        const address_label = address_type === 'other' ? (data.address_label || null) : null;
        await db.execute(
            `UPDATE addresses
             SET address_type = ?, address_label = ?, first_name = ?, last_name = ?, company_name = ?, email = ?, address_line1 = ?, address_line2 = ?, city = ?, state = ?, zip_code = ?, country = ?, phone = ?, is_default = ?
             WHERE id = ? AND user_id = ?`,
            [address_type, address_label, first_name || null, last_name || null, company_name || null, email || null, address_line1, address_line2 || null, city, state || null, zip_code, country, phone, is_default, addressId, userId]
        );
    }
}

module.exports = Address;

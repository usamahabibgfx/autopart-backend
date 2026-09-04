const db = require('../config/db');

class Coupon {
    static async create(couponData) {
        const code = couponData.code;
        const discount_type = couponData.discount_type || 'percentage';
        const discount_value = parseFloat(couponData.discount_value) || 0;
        const expiry_date = couponData.expiry_date || null;
        const usage_limit = parseInt(couponData.usage_limit) || 0;
        const min_order_amount = parseFloat(couponData.min_order_amount) || 0;
        const is_active = couponData.is_active === undefined ? 1 : (couponData.is_active ? 1 : 0);
        const applicable_brands = couponData.applicable_brands || null;
        const applicable_products = couponData.applicable_products || null;

        const [result] = await db.execute(
            `INSERT INTO coupons (code, discount_type, discount_value, expiry_date, usage_limit, min_order_amount, is_active, applicable_brands, applicable_products) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [code, discount_type, discount_value, expiry_date, usage_limit, min_order_amount, is_active, applicable_brands, applicable_products]
        );
        return result.insertId;
    }

    static async getAll() {
        const [rows] = await db.execute('SELECT * FROM coupons ORDER BY created_at DESC');
        return rows;
    }

    static async getAvailable() {
        const [rows] = await db.execute('SELECT * FROM coupons WHERE is_active = 1 AND (expiry_date >= CURDATE() OR expiry_date IS NULL) ORDER BY created_at DESC');
        return rows;
    }

    static async findByCode(code) {
        const [rows] = await db.execute('SELECT * FROM coupons WHERE code = ?', [code]);
        return rows[0];
    }

    static async updateUsage(id) {
        await db.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [id]);
    }

    static async delete(id) {
        await db.execute('DELETE FROM coupons WHERE id = ?', [id]);
    }

    static async update(id, data) {
        const code = data.code;
        const discount_type = data.discount_type || 'percentage';
        const discount_value = parseFloat(data.discount_value) || 0;
        const expiry_date = data.expiry_date || null;
        const usage_limit = parseInt(data.usage_limit) || 0;
        const min_order_amount = parseFloat(data.min_order_amount) || 0;
        const is_active = data.is_active === undefined ? 1 : (data.is_active ? 1 : 0);
        const applicable_brands = data.applicable_brands || null;
        const applicable_products = data.applicable_products || null;

        await db.execute(
            `UPDATE coupons SET code=?, discount_type=?, discount_value=?, expiry_date=?, usage_limit=?, min_order_amount=?, is_active=?, applicable_brands=?, applicable_products=? WHERE id=?`,
            [code, discount_type, discount_value, expiry_date, usage_limit, min_order_amount, is_active, applicable_brands, applicable_products, id]
        );
    }
}

module.exports = Coupon;

const db = require('../config/db');

class Review {
    static async create(reviewData) {
        const { product_id, user_id, rating, comment } = reviewData;
        const [result] = await db.execute(
            'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)',
            [product_id, user_id, rating, comment]
        );
        return result.insertId;
    }

    static async getByProduct(productId) {
        const [rows] = await db.execute(`
            SELECT r.*, u.name as user_name 
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = ?
            ORDER BY r.created_at DESC
        `, [productId]);
        return rows;
    }

    static async getAverageRating(productId) {
        const [rows] = await db.execute(
            'SELECT AVG(rating) as averageRating, COUNT(*) as count FROM reviews WHERE product_id = ?',
            [productId]
        );
        return rows[0];
    }

    static async delete(id) {
        await db.execute('DELETE FROM reviews WHERE id = ?', [id]);
    }

    static async getAll() {
        const [rows] = await db.execute(`
            SELECT r.*, u.name as user_name, p.name as product_name,
            (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as product_image
            FROM reviews r
            LEFT JOIN users u ON r.user_id = u.id
            LEFT JOIN products p ON r.product_id = p.id
            ORDER BY r.created_at DESC
        `);
        return rows;
    }

    static async findById(id) {
        const [rows] = await db.execute('SELECT * FROM reviews WHERE id = ?', [id]);
        return rows[0];
    }
}

module.exports = Review;

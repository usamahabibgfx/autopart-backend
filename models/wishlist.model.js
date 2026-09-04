const db = require('../config/db');

class Wishlist {
    static async getByUser(userId) {
        const [rows] = await db.execute(`
            SELECT w.id, w.product_id, p.name, p.price, p.offer_price, p.slug, p.stock_quantity,
            (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as image
            FROM wishlists w
            JOIN products p ON w.product_id = p.id
            WHERE w.user_id = ?
        `, [userId]);
        return rows;
    }

    static async add(userId, productId) {
        await db.execute('INSERT IGNORE INTO wishlists (user_id, product_id) VALUES (?, ?)', [userId, productId]);
    }

    static async remove(userId, productId) {
        await db.execute('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?', [userId, productId]);
    }
}

module.exports = Wishlist;

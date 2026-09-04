const db = require('../config/db');

class Brand {
    static async findAll() {
        const [rows] = await db.execute('SELECT * FROM brands ORDER BY priority IS NULL ASC, priority ASC, name ASC');
        return rows;
    }

    static async findByCategoryId(categoryId) {
        const [catRows] = await db.execute(
            'SELECT id FROM categories WHERE slug = ? OR id = ? LIMIT 1',
            [categoryId, categoryId]
        );
        if (catRows.length === 0) return [];

        const rootId = catRows[0].id;
        const [allCatRows] = await db.execute(
            'SELECT id FROM categories WHERE id = ? OR parent_id = ? OR parent_id IN (SELECT id FROM categories WHERE parent_id = ?)',
            [rootId, rootId, rootId]
        );
        const catIds = allCatRows.map(r => r.id);
        const placeholders = catIds.map(() => '?').join(',');

        const query = `
            SELECT b.*, COUNT(p.id) as product_count
            FROM brands b
            JOIN products p ON b.id = p.brand_id
            WHERE (p.category_id IN (${placeholders}) OR p.sub_category_id IN (${placeholders}) OR p.sub_sub_category_id IN (${placeholders}))
              AND p.status = 'active' AND b.is_active = 1
            GROUP BY b.id
            ORDER BY b.priority ASC, b.name ASC
        `;
        const [rows] = await db.execute(query, [...catIds, ...catIds, ...catIds]);
        return rows;
    }

    static async findWithDailyOffers(category) {
        return this.findActiveBrands({ category, is_daily_offer: true });
    }

    /**
     * Find brands that have active products matching the given filters.
     * Useful for dynamic filter sidebars.
     */
    static async findActiveBrands(filters = {}) {
        const { category, search, is_featured, is_limited_offer, is_weekly_deal, is_daily_offer, seller, minPrice, maxPrice } = filters;

        let catIds = null;
        if (category) {
            const [catRows] = await db.execute(
                'SELECT id FROM categories WHERE slug = ? OR id = ? LIMIT 1',
                [category, category]
            );
            if (catRows.length > 0) {
                const rootId = catRows[0].id;
                const [allCatRows] = await db.execute(
                    'SELECT id FROM categories WHERE id = ? OR parent_id = ? OR parent_id IN (SELECT id FROM categories WHERE parent_id = ?)',
                    [rootId, rootId, rootId]
                );
                catIds = allCatRows.map(r => r.id);
            }
        }

        let query = `
            SELECT b.*, COUNT(DISTINCT p.id) as product_count
            FROM brands b
            JOIN products p ON b.id = p.brand_id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE (p.status = 'active' OR p.status IS NULL) AND p.is_active = 1 AND b.is_active = 1
        `;
        const params = [];

        if (catIds && catIds.length > 0) {
            const placeholders = catIds.map(() => '?').join(',');
            query += ` AND (p.category_id IN (${placeholders}) OR p.sub_category_id IN (${placeholders}) OR p.sub_sub_category_id IN (${placeholders}))`;
            params.push(...catIds, ...catIds, ...catIds);
        }

        if (search) {
            const searchWords = search.trim().split(/\s+/).filter(word => word.length > 0);
            if (searchWords.length > 0) {
                const wordConditions = searchWords.map(word => {
                    params.push(`%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`, `%${word}%`);
                    return '(p.name LIKE ? OR p.name_ar LIKE ? OR p.description LIKE ? OR p.description_ar LIKE ? OR p.short_description LIKE ? OR p.short_description_ar LIKE ? OR c.name LIKE ? OR p.product_group LIKE ? OR p.sub_category LIKE ? OR b.name LIKE ? OR b.name_ar LIKE ?)';
                });
                query += ' AND (' + wordConditions.join(' AND ') + ')';
            }
        }

        if (is_featured) query += ' AND p.is_featured = 1';
        // A null offer_end means "no expiry" (active) — keep brands consistent with the product filter.
        if (is_limited_offer) query += ' AND p.is_limited_offer = 1 AND p.is_weekly_deal = 0 AND (p.offer_end IS NULL OR p.offer_end > NOW())';
        if (is_weekly_deal) query += ' AND p.is_weekly_deal = 1 AND p.is_limited_offer = 0 AND (p.offer_end IS NULL OR p.offer_end > NOW())';
        if (is_daily_offer) query += ' AND p.is_daily_offer = 1 AND (p.offer_end IS NULL OR p.offer_end > NOW())';

        if (seller) {
            query += ' AND (p.seller_id = ? OR p.seller_name = ?)';
            params.push(seller, seller);
        }

        if (minPrice !== undefined && minPrice !== null) {
            query += ' AND (CASE WHEN p.offer_price > 0 THEN p.offer_price ELSE p.price END) >= ?';
            params.push(minPrice);
        }
        if (maxPrice !== undefined && maxPrice !== null) {
            query += ' AND (CASE WHEN p.offer_price > 0 THEN p.offer_price ELSE p.price END) <= ?';
            params.push(maxPrice);
        }

        query += ' GROUP BY b.id ORDER BY b.priority ASC, b.name ASC';
        const [rows] = await db.execute(query, params);
        return rows;
    }

    static async findBySlug(slug) {
        const [rows] = await db.execute('SELECT * FROM brands WHERE slug = ?', [slug]);
        return rows[0];
    }

    static async create({ name, name_ar = null, slug, image_url = null, image_url_ar = null, banner_url_ar = null, priority = 0 }) {
        const [result] = await db.execute(
            'INSERT INTO brands (name, name_ar, slug, image_url, image_url_ar, banner_url_ar, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, name_ar, slug, image_url, image_url_ar, banner_url_ar, priority]
        );
        return result.insertId;
    }

    static async findByName(name) {
        const [rows] = await db.execute('SELECT * FROM brands WHERE name = ?', [name]);
        return rows[0];
    }

    static async upsert({ name, name_ar = null, slug, image_url = null }) {
        const [result] = await db.execute(
            'INSERT INTO brands (name, name_ar, slug, image_url) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), name_ar = VALUES(name_ar), image_url = VALUES(image_url)',
            [name, name_ar, slug, image_url]
        );
        return result.insertId || result.affectedRows;
    }

    static async update(id, data) {
        const cleanData = {};
        Object.keys(data).forEach(key => {
            if (data[key] !== undefined) {
                cleanData[key] = data[key];
            }
        });

        if (Object.keys(cleanData).length === 0) return;

        const fields = Object.keys(cleanData).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(cleanData), id];
        await db.execute(`UPDATE brands SET ${fields} WHERE id = ?`, values);
    }

    static async delete(id) {
        await db.execute('DELETE FROM brands WHERE id = ?', [id]);
    }

    static async bulkDelete(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(`DELETE FROM brands WHERE id IN (${placeholders})`, ids);
    }
}

module.exports = Brand;

const db = require('../config/db');

class Category {
    static async findAll() {
        // Using GROUP_CONCAT for compatibility with MySQL 5.7+
        // and including brand_names column for direct DB visibility
        const [rows] = await db.execute(`
            SELECT c.*, 
                   (SELECT GROUP_CONCAT(brand_id) FROM category_brands cb WHERE cb.category_id = c.id) as brand_ids_str
            FROM categories c
            ORDER BY c.name ASC
        `);

        return rows.map(row => ({
            ...row,
            brand_ids: row.brand_ids_str ? row.brand_ids_str.split(',').map(Number) : []
        }));
    }

    static async findActiveByOffer({ is_limited_offer, is_weekly_deal, is_daily_offer }) {
        const conds = [];
        if (is_limited_offer) conds.push('(p.is_limited_offer = 1 AND p.is_weekly_deal = 0)');
        if (is_weekly_deal) conds.push('(p.is_weekly_deal = 1 AND p.is_limited_offer = 0)');
        if (is_daily_offer) conds.push('(p.is_daily_offer = 1)');
        if (conds.length === 0) return this.findAll();

        const offerWhere = conds.join(' OR ');
        // Match only the product's main category (category_id) so unrelated parents don't appear via sub-category mapping.
        // Walk up to the top-level main_category for each matching product.
        const [rows] = await db.execute(`
            WITH RECURSIVE cat_chain AS (
                SELECT c.id, c.parent_id, c.id AS origin_id
                FROM categories c
                JOIN products p ON p.category_id = c.id
                WHERE (p.status = 'active' OR p.status IS NULL) AND p.is_active = 1
                  AND (p.offer_end IS NULL OR p.offer_end > NOW())
                  AND (${offerWhere})
                UNION ALL
                SELECT pc.id, pc.parent_id, cc.origin_id
                FROM categories pc
                JOIN cat_chain cc ON cc.parent_id = pc.id
            )
            SELECT DISTINCT c.id, c.name, c.name_ar, c.slug, c.type, c.is_active, c.parent_id
            FROM cat_chain cc
            JOIN categories c ON c.id = cc.id
            WHERE c.is_active = 1
            ORDER BY c.name ASC
        `);
        return rows.map(row => ({ ...row, brand_ids: [] }));
    }

    static async findBySearch(search) {
        const term = (search || '').trim();
        if (!term) return this.findAll();

        const searchWords = term.split(/\s+/).filter(w => w.length > 0);
        if (searchWords.length === 0) return this.findAll();

        const params = [];
        const wordConditions = searchWords.map(originalWord => {
            const wordsToMatch = [originalWord];
            if (originalWord.length > 3 && originalWord.endsWith('s')) {
                let singular = originalWord.slice(0, -1);
                if (originalWord.endsWith('ies')) singular = originalWord.slice(0, -3) + 'y';
                wordsToMatch.push(singular);
            } else if (originalWord.length > 3 && !originalWord.endsWith('s')) {
                wordsToMatch.push(originalWord + 's');
            }

            const subConditions = [];
            for (const word of wordsToMatch) {
                for (let i = 0; i < 8; i++) {
                    params.push(`${word}%`, `% ${word}%`);
                }
                subConditions.push('(' +
                    'p.name LIKE ? OR p.name LIKE ? OR ' +
                    'p.name_ar LIKE ? OR p.name_ar LIKE ? OR ' +
                    'c0.name LIKE ? OR c0.name LIKE ? OR ' +
                    'p.product_group LIKE ? OR p.product_group LIKE ? OR ' +
                    'p.sub_category LIKE ? OR p.sub_category LIKE ? OR ' +
                    'b.name LIKE ? OR b.name LIKE ? OR ' +
                    'b.name_ar LIKE ? OR b.name_ar LIKE ? OR ' +
                    'p.model LIKE ? OR p.model LIKE ?' +
                    ')');
            }
            return '(' + subConditions.join(' OR ') + ')';
        });

        const whereSql = wordConditions.join(' AND ');

        const sql = `
            WITH RECURSIVE cat_chain AS (
                SELECT c0.id, c0.parent_id
                FROM categories c0
                JOIN products p ON p.category_id = c0.id
                LEFT JOIN brands b ON p.brand_id = b.id
                WHERE (p.status = 'active' OR p.status IS NULL) AND p.is_active = 1
                  AND (${whereSql})
                UNION
                SELECT pc.id, pc.parent_id
                FROM categories pc
                JOIN cat_chain cc ON cc.parent_id = pc.id
            )
            SELECT DISTINCT c.id, c.name, c.name_ar, c.slug, c.type, c.is_active, c.parent_id, c.image_url
            FROM cat_chain cc
            JOIN categories c ON c.id = cc.id
            WHERE c.is_active = 1
            ORDER BY c.name ASC
        `;

        const [rows] = await db.query(sql, params);
        return rows.map(row => ({ ...row, brand_ids: [] }));
    }

    static async findByBrand(brandSlug) {
        // Categories that directly hold this brand's products (may be main OR sub).
        const [leafRows] = await db.execute(`
            SELECT DISTINCT c.id, c.name, c.name_ar, c.slug, c.type, c.is_active, c.parent_id, c.image_url,
                   COUNT(p.id) as product_count
            FROM categories c
            JOIN products p ON p.category_id = c.id
            JOIN brands b ON p.brand_id = b.id
            WHERE b.slug = ? AND (p.status = 'active' OR p.status IS NULL) AND p.is_active = 1 AND c.is_active = 1
            GROUP BY c.id
            ORDER BY c.name ASC
        `, [brandSlug]);

        const byId = new Map(leafRows.map(r => [r.id, { ...r, product_count: Number(r.product_count) || 0 }]));

        // Subcategories may have products while their parent main category does not.
        // Pull in those parent mains so the brand page can show main + sub together.
        const missingParentIds = [...new Set(leafRows.filter(r => r.parent_id).map(r => r.parent_id))]
            .filter(pid => !byId.has(pid));
        if (missingParentIds.length > 0) {
            const placeholders = missingParentIds.map(() => '?').join(',');
            const [parentRows] = await db.execute(
                `SELECT id, name, name_ar, slug, type, is_active, parent_id, image_url
                 FROM categories WHERE id IN (${placeholders}) AND is_active = 1`,
                missingParentIds
            );
            for (const p of parentRows) {
                if (!byId.has(p.id)) byId.set(p.id, { ...p, product_count: 0 });
            }
        }

        // Roll up subcategory counts into their parent main for display.
        for (const row of byId.values()) {
            if (row.parent_id && byId.has(row.parent_id)) {
                byId.get(row.parent_id).product_count += row.product_count;
            }
        }

        return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    static async findBySlug(slug) {
        const [rows] = await db.execute(`
            SELECT c.*, 
                   (SELECT GROUP_CONCAT(brand_id) FROM category_brands cb WHERE cb.category_id = c.id) as brand_ids_str
            FROM categories c WHERE c.slug = ?
        `, [slug]);

        if (!rows[0]) return null;

        return {
            ...rows[0],
            brand_ids: rows[0].brand_ids_str ? rows[0].brand_ids_str.split(',').map(Number) : []
        };
    }

    static async create({ name, name_ar = null, slug, image_url = null, banner_url = null, image_url_ar = null, banner_url_ar = null, description = null, description_ar = null, is_active = 1, parent_id = null, type = 'main_category', brands = [], order_index = 0, show_on_home = 0, home_poster_url = null, home_poster_url_ar = null }) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // Fetch brand names to sync brand_names column
            let brandNames = [];
            if (brands && brands.length > 0) {
                const [rows] = await conn.query('SELECT name FROM brands WHERE id IN (?)', [brands]);
                brandNames = rows.map(r => r.name);
            }
            const brandNamesStr = brandNames.join(', ');

            const [result] = await conn.execute(
                'INSERT INTO categories (name, name_ar, slug, image_url, banner_url, image_url_ar, banner_url_ar, description, description_ar, is_active, parent_id, type, brand_names, order_index, show_on_home, home_poster_url, home_poster_url_ar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [name, name_ar, slug, image_url, banner_url, image_url_ar, banner_url_ar, description, description_ar, is_active, parent_id, type, brandNamesStr, order_index, show_on_home, home_poster_url, home_poster_url_ar]
            );
            const categoryId = result.insertId;

            if (brands && Array.isArray(brands) && brands.length > 0) {
                for (const brandId of brands) {
                    await conn.execute('INSERT INTO category_brands (category_id, brand_id) VALUES (?, ?)', [categoryId, brandId]);
                }
            }

            await conn.commit();
            return categoryId;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async update(id, data) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const cleanData = { ...data };
            // Specifically manage brands and brand_names manually
            delete cleanData.brands;
            delete cleanData.brand_ids;
            delete cleanData.brand_ids_str;
            delete cleanData.brand_names;

            // Handle brand association update and brand_names sync
            if (data.brands !== undefined && Array.isArray(data.brands)) {
                // Delete existing ones
                await conn.execute('DELETE FROM category_brands WHERE category_id = ?', [id]);

                let brandNames = [];
                if (data.brands.length > 0) {
                    for (const brandId of data.brands) {
                        await conn.execute('INSERT INTO category_brands (category_id, brand_id) VALUES (?, ?)', [id, brandId]);
                    }
                    // Fetch latest names
                    const [rows] = await conn.query('SELECT name FROM brands WHERE id IN (?)', [data.brands]);
                    brandNames = rows.map(r => r.name);
                }
                cleanData.brand_names = brandNames.join(', ');
            }

            if (Object.keys(cleanData).length > 0) {
                const fields = Object.keys(cleanData).map(key => `${key} = ?`).join(', ');
                const values = [...Object.values(cleanData), id];
                await conn.execute(`UPDATE categories SET ${fields} WHERE id = ?`, values);
            }

            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async delete(id) {
        await db.execute('DELETE FROM categories WHERE id = ?', [id]);
    }
}

module.exports = Category;

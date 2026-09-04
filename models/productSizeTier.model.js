const db = require('../config/db');

let schemaEnsured = false;

async function ensureSchema() {
    if (schemaEnsured) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS product_size_tiers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_id INT NOT NULL,
            dimension ENUM('width','depth','height') NOT NULL,
            min_cm INT NOT NULL,
            max_cm INT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            position INT NOT NULL DEFAULT 0,
            INDEX idx_product_dim (product_id, dimension),
            CONSTRAINT fk_size_tier_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);

    // Add the customizable columns on products if missing
    const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
           AND COLUMN_NAME IN ('is_customizable','custom_dimensions','base_price','base_dimensions')`
    );
    const have = new Set(cols.map(r => r.COLUMN_NAME));
    if (!have.has('is_customizable')) {
        await db.query(`ALTER TABLE products ADD COLUMN is_customizable TINYINT(1) NOT NULL DEFAULT 0`);
    }
    if (!have.has('custom_dimensions')) {
        await db.query(`ALTER TABLE products ADD COLUMN custom_dimensions TEXT NULL`);
    }
    if (!have.has('base_price')) {
        await db.query(`ALTER TABLE products ADD COLUMN base_price DECIMAL(10,2) NULL`);
    }
    if (!have.has('base_dimensions')) {
        await db.query(`ALTER TABLE products ADD COLUMN base_dimensions TEXT NULL`);
    }
    schemaEnsured = true;
}

const ALLOWED = new Set(['width', 'depth', 'height']);

function sanitizeTiers(rawTiers) {
    if (!Array.isArray(rawTiers)) return [];
    return rawTiers
        .map((t, idx) => {
            const dimension = String(t?.dimension || '').toLowerCase();
            if (!ALLOWED.has(dimension)) return null;
            const min_cm = parseInt(t?.min_cm, 10);
            const max_cm = parseInt(t?.max_cm, 10);
            const price = parseFloat(t?.price);
            if (!Number.isFinite(min_cm) || !Number.isFinite(max_cm) || !Number.isFinite(price)) return null;
            if (min_cm < 0 || max_cm < min_cm || price < 0) return null;
            const position = Number.isFinite(parseInt(t?.position, 10)) ? parseInt(t.position, 10) : idx;
            return { dimension, min_cm, max_cm, price, position };
        })
        .filter(Boolean);
}

async function getByProductId(productId) {
    await ensureSchema();
    const [rows] = await db.query(
        `SELECT dimension, min_cm, max_cm, price, position
         FROM product_size_tiers
         WHERE product_id = ?
         ORDER BY dimension ASC, position ASC, min_cm ASC`,
        [productId]
    );
    return rows;
}

async function replaceForProduct(productId, tiers) {
    await ensureSchema();
    const clean = sanitizeTiers(tiers);
    await db.query('DELETE FROM product_size_tiers WHERE product_id = ?', [productId]);
    if (clean.length === 0) return;
    const placeholders = clean.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = clean.flatMap(t => [productId, t.dimension, t.min_cm, t.max_cm, t.price, t.position]);
    await db.query(
        `INSERT INTO product_size_tiers (product_id, dimension, min_cm, max_cm, price, position)
         VALUES ${placeholders}`,
        params
    );
}

// Final price = basePrice + sum(matched tier surcharge per dimension).
// Returns null if a dimension that has tiers configured has no matching range.
function calculatePrice(tiers, values, basePrice = 0) {
    if (!Array.isArray(tiers)) tiers = [];
    const byDim = tiers.reduce((acc, t) => {
        (acc[t.dimension] = acc[t.dimension] || []).push(t);
        return acc;
    }, {});
    let total = Number(basePrice) || 0;
    for (const dim of Object.keys(byDim)) {
        const v = Number(values?.[dim]);
        if (!Number.isFinite(v)) return null;
        const match = byDim[dim].find(t => v >= Number(t.min_cm) && v <= Number(t.max_cm));
        if (!match) return null;
        total += Number(match.price);
    }
    return total;
}

module.exports = {
    ensureSchema,
    sanitizeTiers,
    getByProductId,
    replaceForProduct,
    calculatePrice,
};

const slugify = require('slugify');
const db = require('../config/db');

/**
 * Generates a unique slug for a given table and name
 * @param {string} name - The name to slugify
 * @param {string} table - The table to check uniqueness in (e.g. 'categories', 'products', 'brands')
 * @param {number} [excludeId] - ID to exclude from check (for updates)
 * @returns {Promise<string>}
 */
async function generateUniqueSlug(name, table, excludeId = null) {
    if (!name) return '';

    let baseSlug = slugify(name.toString(), {
        lower: true,
        strict: true,
        trim: true
    });

    // Fallback if name is non-latin and slugify returns empty
    if (!baseSlug) {
        baseSlug = 'category';
    }

    let uniqueSlug = baseSlug;
    let counter = 1;

    while (true) {
        let query = `SELECT id FROM ${table} WHERE slug = ?`;
        let params = [uniqueSlug];

        if (excludeId) {
            query += ' AND id != ?';
            params.push(excludeId);
        }

        const [rows] = await db.execute(query, params);

        if (rows.length === 0) {
            return uniqueSlug;
        }

        uniqueSlug = `${baseSlug}-${counter}`;
        counter++;
    }
}

module.exports = generateUniqueSlug;

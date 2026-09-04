require('dotenv').config();
const db = require('../config/db');

async function fixDuplicates() {
    try {
        console.log('--- Checking for duplicate slugs in products table ---');
        const [duplicates] = await db.query(`
            SELECT slug, COUNT(*) as count 
            FROM products 
            GROUP BY slug 
            HAVING count > 1
        `);

        for (const item of duplicates) {
            console.log(`Fixing duplicate slug: ${item.slug}`);
            const [rows] = await db.query('SELECT id FROM products WHERE slug = ? ORDER BY id ASC', [item.slug]);

            // Keep the first one, rename others
            for (let i = 1; i < rows.length; i++) {
                const newSlug = `${item.slug}-${i}`;
                await db.query('UPDATE products SET slug = ? WHERE id = ?', [newSlug, rows[i].id]);
                console.log(`  Updated product ID ${rows[i].id} to slug: ${newSlug}`);
            }
        }

        console.log('--- Dropping existing non-unique slug indexes ---');
        // We might have 'slug', 'slug_2', etc. Let's find them.
        const [indexes] = await db.query("SHOW INDEX FROM products WHERE Column_name = 'slug'");
        for (const idx of indexes) {
            if (idx.Key_name !== 'PRIMARY') {
                try {
                    await db.query(`ALTER TABLE products DROP INDEX ${idx.Key_name}`);
                    console.log(`  Dropped index: ${idx.Key_name}`);
                } catch (e) {
                    console.log(`  Could not drop index ${idx.Key_name}: ${e.message}`);
                }
            }
        }

        console.log('--- Adding UNIQUE index to slug column ---');
        await db.query('ALTER TABLE products ADD UNIQUE (slug)');
        console.log('✅ Success: slug is now unique!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error fixing duplicates:', error.message);
        process.exit(1);
    }
}

fixDuplicates();

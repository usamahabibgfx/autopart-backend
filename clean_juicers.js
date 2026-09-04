require('dotenv').config();
const db = require('./config/db');


async function cleanJuicers() {
    try {
        console.log("Searching for 'Juicers' category...");
        const [categories] = await db.query(
            "SELECT id, name, slug, type, parent_id FROM categories WHERE name LIKE '%juicers%' OR name LIKE '%juicer%'"
        );

        if (categories.length === 0) {
            console.log("No category found matching 'juicers'");
            return;
        }

        console.log("Found categories:", categories);

        for (const cat of categories) {
            console.log(`Processing category: ${cat.name} (ID: ${cat.id})`);

            // Unlink from products (category_id, sub_category_id, sub_sub_category_id)
            const [update1] = await db.query("UPDATE products SET category_id = NULL WHERE category_id = ?", [cat.id]);
            const [update2] = await db.query("UPDATE products SET sub_category_id = NULL WHERE sub_category_id = ?", [cat.id]);
            const [update3] = await db.query("UPDATE products SET sub_sub_category_id = NULL WHERE sub_sub_category_id = ?", [cat.id]);

            console.log(`Unlinked from products: ${update1.affectedRows} main, ${update2.affectedRows} sub, ${update3.affectedRows} sub-sub.`);

            // Delete category
            const [del] = await db.query("DELETE FROM categories WHERE id = ?", [cat.id]);
            console.log(`Deleted category from DB: ${del.affectedRows} rows affected.`);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit();
    }
}

cleanJuicers();

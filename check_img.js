require('dotenv').config();
const db = require('./config/db');

async function check() {
    try {
        const [rows] = await db.query(`
            SELECT p.id, p.name, 
            (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image,
            (SELECT image_url FROM product_images WHERE product_id = p.id LIMIT 1) as first_image
            FROM products p 
            WHERE p.name LIKE '%juicer%' LIMIT 10
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();

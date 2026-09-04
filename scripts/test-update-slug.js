require('dotenv').config();
const db = require('../config/db');

async function testUpdate() {
    try {
        console.log('Testing update...');
        // First get product 30
        const [rows] = await db.query('SELECT * FROM products WHERE id = 30');
        if (rows.length === 0) {
            console.log('Product 30 not found');
            process.exit(0);
        }
        const p = rows[0];
        console.log(`Current slug for 30: ${p.slug}`);

        // Try to update it to the SAME slug
        try {
            await db.query('UPDATE products SET slug = ? WHERE id = 30', [p.slug]);
            console.log('Update to same slug SUCCESS');
        } catch (err) {
            console.error('Update to same slug FAILED:', err.message);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
testUpdate();

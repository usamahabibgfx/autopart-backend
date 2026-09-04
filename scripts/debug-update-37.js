require('dotenv').config();
const Product = require('../models/product.model');
const db = require('../config/db');

async function debugUpdate() {
    try {
        console.log('--- BEFORE UPDATE ---');
        let [rows] = await db.query('SELECT * FROM products WHERE id = 37');
        console.log(JSON.stringify(rows[0]));

        console.log('--- PERFORMING UPDATE ---');
        // Simulate checking Weekly Deal, unchecking Featured. Keeping name 'test'.
        const data = {
            name: 'test',
            is_featured: false,
            is_weekly_deal: true,
            is_limited_offer: false,
            price: 500
        };
        await Product.update(37, data);

        console.log('--- AFTER UPDATE ---');
        [rows] = await db.query('SELECT * FROM products WHERE id = 37');
        const r = rows[0];
        console.log(`ID: ${r.id}, Name: ${r.name}, WD: ${r.is_weekly_deal}, LO: ${r.is_limited_offer}, F: ${r.is_featured}, Price: ${r.price}`);

        process.exit(0);
    } catch (e) {
        console.error('ERROR:', e);
        process.exit(1);
    }
}
debugUpdate();

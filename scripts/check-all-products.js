require('dotenv').config();
const db = require('../config/db');

async function checkAll() {
    try {
        const [rows] = await db.query('SELECT id, name, is_featured, is_weekly_deal, is_limited_offer, price, offer_price, discount_percentage FROM products');
        console.log('--- PRODUCTS IN DATABASE ---');
        rows.forEach(r => {
            console.log(`ID: ${r.id} | NAME: "${r.name}" | WD: ${r.is_weekly_deal} | LO: ${r.is_limited_offer} | F: ${r.is_featured} | PRICE: ${r.price} | OFFER: ${r.offer_price} | DISC: ${r.discount_percentage}%`);
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkAll();

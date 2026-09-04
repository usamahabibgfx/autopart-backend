require('dotenv').config();
const db = require('../config/db');

async function checkProduct() {
    try {
        const [rows] = await db.query('SELECT id, name, is_featured, is_weekly_deal, is_limited_offer, price FROM products');
        rows.forEach(r => {
            console.log('RAW_ROW:' + JSON.stringify(r));
        });
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkProduct();

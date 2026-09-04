require('dotenv').config();
const db = require('../config/db');
const fs = require('fs');

async function run() {
    try {
        const [rows] = await db.query('SHOW CREATE TABLE products');
        fs.writeFileSync('products_schema.txt', rows[0]['Create Table']);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();

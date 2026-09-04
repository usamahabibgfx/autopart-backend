require('dotenv').config();
const db = require('./config/db.js');

async function run() {
    try {
        console.log('Adding name_ar column to categories...');
        await db.query('ALTER TABLE categories ADD COLUMN name_ar VARCHAR(255) DEFAULT NULL;');
        console.log('Column added to categories.');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('Column name_ar already exists in categories.');
        } else {
            console.error(e);
        }
    }
    process.exit(0);
}
run();

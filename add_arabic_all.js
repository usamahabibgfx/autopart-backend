require('dotenv').config();
const db = require('./config/db.js');

async function run() {
    const queries = [
        "ALTER TABLE brands ADD COLUMN name_ar VARCHAR(255) DEFAULT NULL;",
        "ALTER TABLE products ADD COLUMN name_ar VARCHAR(255) DEFAULT NULL;",
        "ALTER TABLE products ADD COLUMN description_ar TEXT DEFAULT NULL;"
    ];

    for (const q of queries) {
        try {
            console.log(`Executing: ${q}`);
            await db.query(q);
            console.log('Success.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('Column already exists.');
            } else {
                console.error(`Error executing ${q}:`, e.message);
            }
        }
    }

    console.log('Database modification complete.');
    process.exit(0);
}
run();

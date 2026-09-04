require('dotenv').config();
const db = require('../config/db');

async function run() {
    try {
        const [rows] = await db.query(`
            SELECT 
                TABLE_NAME, 
                COLUMN_NAME, 
                CONSTRAINT_NAME,
                REFERENCED_TABLE_NAME
            FROM 
                information_schema.KEY_COLUMN_USAGE 
            WHERE 
                TABLE_SCHEMA = (SELECT DATABASE())
        `);
        console.log('--- Constraints ---');
        console.log(JSON.stringify(rows, null, 2));

        const [indexes] = await db.query(`
            SELECT 
                TABLE_NAME, 
                NON_UNIQUE, 
                INDEX_NAME, 
                COLUMN_NAME 
            FROM 
                information_schema.STATISTICS 
            WHERE 
                TABLE_SCHEMA = (SELECT DATABASE()) 
                AND NON_UNIQUE = 0
                AND INDEX_NAME != 'PRIMARY'
        `);
        console.log('--- Unique Indexes (Non-Primary) ---');
        console.log(JSON.stringify(indexes, null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();

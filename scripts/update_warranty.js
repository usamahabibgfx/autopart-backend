const mysql = require('mysql2/promise');
require('dotenv').config({ path: 'd:/BEST SIGNATURE/backend/.env' });

async function run() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    try {
        console.log('Updating warranty fields to NULL...');
        const [result] = await connection.execute('UPDATE products SET warranty = NULL, warranty_ar = NULL');
        console.log(`Success! Updated ${result.affectedRows} rows.`);
    } catch (error) {
        console.error('Error updating records:', error);
    } finally {
        await connection.end();
    }
}

run();

const mysql = require('mysql2/promise');

async function fixBrandUrls() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: '127.0.0.1',
            user: 'root',
            password: '',
            database: 'bestautopart'
        });

        console.log('Connected to database.');

        // Update 1: Replace leading slash versions
        const [res1] = await connection.query(
            "UPDATE brands SET image_url = REPLACE(image_url, '/assets/brands/', 'uploads/brands/') WHERE image_url LIKE '%/assets/brands/%'"
        );
        console.log(`Updated with leading slash: ${res1.affectedRows} rows`);

        // Update 2: Replace without leading slash
        const [res2] = await connection.query(
            "UPDATE brands SET image_url = REPLACE(image_url, 'assets/brands/', 'uploads/brands/') WHERE image_url LIKE '%assets/brands/%'"
        );
        console.log(`Updated without leading slash: ${res2.affectedRows} rows`);

        // Update 3: Final check for any remaining 'assets/brands'
        const [res3] = await connection.query(
            "SELECT id, name, image_url FROM brands WHERE image_url LIKE '%assets/brands%'"
        );
        if (res3.length > 0) {
            console.log('Remaining brands with assets paths:', res3);
        } else {
            console.log('No remaining brands with assets paths.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        if (connection) await connection.end();
    }
}

fixBrandUrls();

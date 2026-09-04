const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixArabicEncoding() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
    });

    console.log('Connected to database.');

    const tables = [
        { name: 'categories', columns: ['name_ar', 'description_ar'] },
        { name: 'products', columns: ['name_ar', 'description_ar', 'short_description_ar'] },
        { name: 'brands', columns: ['name_ar', 'description_ar'] },
        { name: 'hero_slides', columns: ['tagline_ar', 'title_ar', 'description_ar', 'btnText_ar'] },
        { name: 'hero_posters', columns: ['title_ar', 'description_ar', 'badge_ar', 'button_text_ar'] },
    ];

    try {
        for (const table of tables) {
            console.log(`Processing table: ${table.name}...`);

            const columnsToSelect = table.columns.join(', ');
            const [rows] = await connection.execute(`SELECT id, ${columnsToSelect} FROM ${table.name}`);

            for (const row of rows) {
                let needsUpdate = false;
                const updates = {};

                for (const col of table.columns) {
                    const originalValue = row[col];
                    if (originalValue && typeof originalValue === 'string') {
                        // Check if string contains characteristic mojibake patterns
                        // pattern: Ø (D8), Ù (D9) are very common in Arabic UTF-8 interpreted as Latin1
                        if (originalValue.includes('Ø') || originalValue.includes('Ù') || originalValue.includes('§')) {
                            try {
                                // Attempt to repair: Convert string to Buffer (interpreted as latin1) and then to UTF-8
                                const repairedValue = Buffer.from(originalValue, 'latin1').toString('utf8');

                                // If it looks like Arabic (contains Arabic Unicode range), we fix it
                                if (/[\u0600-\u06FF]/.test(repairedValue)) {
                                    updates[col] = repairedValue;
                                    needsUpdate = true;
                                }
                            } catch (err) {
                                // Skip if conversion fails
                            }
                        }
                    }
                }

                if (needsUpdate) {
                    const setClause = Object.keys(updates).map(col => `${col} = ?`).join(', ');
                    const values = Object.values(updates);
                    values.push(row.id);

                    await connection.execute(
                        `UPDATE ${table.name} SET ${setClause} WHERE id = ?`,
                        values
                    );
                    console.log(`  Updated record ID ${row.id} in ${table.name}`);
                }
            }
        }

        console.log('Arabic encoding fix completed successfully.');
    } catch (error) {
        console.error('Error during restoration:', error);
    } finally {
        await connection.end();
    }
}

fixArabicEncoding();

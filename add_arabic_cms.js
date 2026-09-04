const mysql = require('mysql2/promise');
const config = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'bestautopart'
};

async function checkAndAdd() {
    const connection = await mysql.createConnection(config);
    try {
        const tables = ['hero_slides', 'hero_posters'];

        for (const table of tables) {
            console.log(`Checking table: ${table}`);
            const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
            const columnNames = columns.map(c => c.Field);

            let columnsToAdd = [];
            if (table === 'hero_slides') {
                if (!columnNames.includes('tagline_ar')) columnsToAdd.push('ADD COLUMN tagline_ar VARCHAR(255) AFTER tagline');
                if (!columnNames.includes('title_ar')) columnsToAdd.push('ADD COLUMN title_ar VARCHAR(255) AFTER title');
                if (!columnNames.includes('description_ar')) columnsToAdd.push('ADD COLUMN description_ar TEXT AFTER description');
                if (!columnNames.includes('btnText_ar')) columnsToAdd.push('ADD COLUMN btnText_ar VARCHAR(100) AFTER btnText');
            } else if (table === 'hero_posters') {
                if (!columnNames.includes('title_ar')) columnsToAdd.push('ADD COLUMN title_ar VARCHAR(255) AFTER title');
                if (!columnNames.includes('description_ar')) columnsToAdd.push('ADD COLUMN description_ar TEXT AFTER description');
                if (!columnNames.includes('badge_ar')) columnsToAdd.push('ADD COLUMN badge_ar VARCHAR(100) AFTER badge');
                if (!columnNames.includes('button_text_ar')) columnsToAdd.push('ADD COLUMN button_text_ar VARCHAR(100) AFTER button_text');
            }

            if (columnsToAdd.length > 0) {
                const sql = `ALTER TABLE ${table} ${columnsToAdd.join(', ')}`;
                console.log(`Executing: ${sql}`);
                await connection.query(sql);
                console.log(`Updated ${table} successfully.`);
            } else {
                console.log(`${table} already has all Arabic columns.`);
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await connection.end();
    }
}

checkAndAdd();

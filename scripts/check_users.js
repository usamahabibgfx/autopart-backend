const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../config/db');

async function listUsers() {
    try {
        const [rows] = await db.execute('SELECT id, name, email, reward_points FROM users ORDER BY id DESC LIMIT 10');
        console.log('\n--- Latest Users in Database ---');
        if (rows.length === 0) {
            console.log('No users found.');
        } else {
            console.table(rows);
        }
        process.exit(0);
    } catch (error) {
        console.error('Error fetching users:', error);
        process.exit(1);
    }
}

listUsers();

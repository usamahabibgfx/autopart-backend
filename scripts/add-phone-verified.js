// One-time migration: add phone_verified column to users table.
// Run: node scripts/add-phone-verified.js
require('dotenv').config();
const db = require('../config/db');

(async () => {
    try {
        const [cols] = await db.execute("SHOW COLUMNS FROM users LIKE 'phone_verified'");
        if (cols.length === 0) {
            await db.execute("ALTER TABLE users ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER phone_number");
            console.log('Added users.phone_verified column.');
        } else {
            console.log('users.phone_verified already exists; skipping.');
        }
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
})();

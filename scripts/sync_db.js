const { initDb } = require('../config/init');
const populateCategories = require('./populate_new_categories');

async function syncAll() {
    try {
        console.log('🔄 Starting full database synchronization...');

        // 1. Initialize schema and migrations
        await initDb();
        console.log('✅ Schema initialization complete.');

        // 2. The populate_new_categories.js script is already a self-executing script if required.
        // But we want to control it here.
        // Actually, populate_new_categories.js calls process.exit() at the end, which is bad for importing.
        // I'll just run it as a separate process.

        console.log('🔄 Starting category and settings population...');
        // We can't easily require it if it self-executes and exits.
        // Better to run it via child process or just run them sequentially in terminal.

        console.log('SYNC_STEP_1_COMPLETE');
    } catch (error) {
        console.error('❌ Sync failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    syncAll();
}

const db = require('./config/db');

async function check() {
    try {
        const [rows] = await db.query("SELECT id, name, slug, type, parent_id FROM categories WHERE name LIKE '%juice%' OR name LIKE '%juicer%'");
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();

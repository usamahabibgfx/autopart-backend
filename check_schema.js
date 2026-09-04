const db = require('./config/db');

async function checkSchema() {
    try {
        const [productsDesc] = await db.query('DESCRIBE products');
        console.log('Products Table Structure:');
        console.table(productsDesc);

        const [categoriesDesc] = await db.query('DESCRIBE categories');
        console.log('\nCategories Table Structure:');
        console.table(categoriesDesc);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkSchema();

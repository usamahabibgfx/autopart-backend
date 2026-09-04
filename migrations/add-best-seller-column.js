const db = require('../config/db');

/**
 * Migration: Add is_best_seller column to products table
 * This column will be automatically updated based on sales data
 */

async function addBestSellerColumn() {
    const connection = await db.getConnection();
    try {
        console.log('Adding is_best_seller column to products table...');

        await connection.execute(`
            ALTER TABLE products 
            ADD COLUMN IF NOT EXISTS is_best_seller TINYINT(1) DEFAULT 0
        `);

        console.log('✓ Successfully added is_best_seller column');
        console.log('Column will be automatically updated by the updateBestSellers script');

    } catch (error) {
        console.error('Error adding is_best_seller column:', error.message);
        throw error;
    } finally {
        connection.release();
        process.exit(0);
    }
}

addBestSellerColumn();

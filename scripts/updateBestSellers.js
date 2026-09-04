const db = require('../config/db');

/**
 * Script to automatically update "Best Seller" badges
 * Calculates products with highest sales in the last 30 days
 * Run this script via cron job (e.g., daily at midnight)
 */

async function updateBestSellers() {
    const connection = await db.getConnection();
    try {
        console.log('🔄 Calculating best sellers based on last 30 days sales...');

        // Step 1: Reset all products to not best seller
        await connection.execute(`
            UPDATE products SET is_best_seller = 0
        `);
        console.log('✓ Reset all best seller flags');

        // Step 2: Calculate top selling products from last 30 days
        // Get products with highest total quantity sold
        const [topProducts] = await connection.execute(`
            SELECT 
                oi.product_id,
                p.name,
                SUM(oi.quantity) as total_sold,
                COUNT(DISTINCT o.id) as order_count
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND o.status NOT IN ('cancelled', 'refunded')
                AND p.is_active = 1
                AND p.status = 'active'
            GROUP BY oi.product_id
            HAVING total_sold > 0
            ORDER BY total_sold DESC
            LIMIT 10
        `);

        if (topProducts.length === 0) {
            console.log('ℹ️  No sales data found in the last 30 days');
            return;
        }

        console.log(`\n📊 Top ${topProducts.length} Best Sellers:`);
        console.log('─'.repeat(70));

        // Step 3: Mark top products as best sellers
        for (const product of topProducts) {
            await connection.execute(`
                UPDATE products 
                SET is_best_seller = 1 
                WHERE id = ?
            `, [product.product_id]);

            console.log(`✓ ${product.name}`);
            console.log(`  └─ Total Sold: ${product.total_sold} units | Orders: ${product.order_count}`);
        }

        console.log('─'.repeat(70));
        console.log(`\n✅ Successfully updated ${topProducts.length} best seller products`);
        console.log('💡 Tip: Schedule this script to run daily via cron job\n');

    } catch (error) {
        console.error('❌ Error updating best sellers:', error.message);
        throw error;
    } finally {
        connection.release();
        process.exit(0);
    }
}

// Run the update
updateBestSellers();

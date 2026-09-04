const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Configure dotenv to point to backend/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

const db = require('../config/db');

const exportProducts = async () => {
    try {
        console.log('Connecting to database...');
        // The query now includes image URL and slug for completeness
        const [rows] = await db.execute(`
            SELECT 
                p.id,
                p.name AS product_name, 
                p.slug,
                p.price, 
                p.offer_price,
                c.name AS category_name, 
                b.name AS brand_name,
                p.description,
                p.stock_quantity,
                pi.image_url
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_images pi ON p.id = pi.product_id
            GROUP BY p.id
            ORDER BY c.name, p.name
        `);

        let output = '';
        let currentCategory = '';

        output += `Total Products Found: ${rows.length}\n`;
        output += `Export Date: ${new Date().toISOString()}\n`;
        output += '-'.repeat(60) + '\n';

        rows.forEach(product => {
            if (product.category_name !== currentCategory) {
                currentCategory = product.category_name || 'Uncategorized';
                output += `\n\n=== CATEGORY: ${currentCategory} ===\n`;
                output += '='.repeat(currentCategory.length + 15) + '\n';
            }

            output += `Product: ${product.product_name}\n`;
            output += `ID:      ${product.id}\n`;
            output += `Slug:    ${product.slug || 'N/A'}\n`;
            output += `Brand:   ${product.brand_name || 'N/A'}\n`;
            output += `Price:   AED ${product.price} ${product.offer_price ? `(Offer: AED ${product.offer_price})` : ''}\n`;
            output += `Stock:   ${product.stock_quantity}\n`;
            output += `Image:   ${product.image_url || 'N/A'}\n`;
            output += `Details: ${product.description ? product.description.replace(/<[^>]*>/g, '').substring(0, 150).replace(/\n/g, ' ') + '...' : 'No description'}\n`;
            output += '-'.repeat(40) + '\n';
        });

        // Write to frontend directory
        const outputPath = path.join(__dirname, '../../frontend/products.txt');
        fs.writeFileSync(outputPath, output);
        console.log(`Successfully exported ${rows.length} products to ${outputPath}`);
        process.exit(0);
    } catch (error) {
        console.error('Error exporting products:', error);
        process.exit(1);
    }
};

exportProducts();

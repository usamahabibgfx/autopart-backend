require('dotenv').config();
const Product = require('../models/product.model');
const db = require('../config/db');

async function testBackendFeatures() {
    try {
        console.log('--- STEP 1: CREATE PRODUCT (IS_LIMITED_OFFER = TRUE) ---');
        const newProduct = {
            name: 'Backend Verification Product',
            name_ar: 'منتج تحقق خلفية',
            description: 'Created by backend test script to verify limited offer flag.',
            price: 777.00,
            stock_quantity: 10,
            category_id: 1, // Ensure valid ID, usually 1 exists
            brand_id: 1,    // Ensure valid ID, usually 1 exists
            is_active: true,
            is_limited_offer: true,
            is_weekly_deal: false,
            is_featured: false,
            image_url: 'https://via.placeholder.com/150'
        };

        const productId = await Product.create(newProduct);
        console.log(`Product created successfully. ID: ${productId}`);

        console.log('--- STEP 2: VERIFY DATABASE STATE (DIRECT SQL) ---');
        const [rows] = await db.query('SELECT id, name, is_limited_offer FROM products WHERE id = ?', [productId]);
        const dbProduct = rows[0];
        console.log('DB Record:', JSON.stringify(dbProduct));

        if (dbProduct.is_limited_offer === 1) {
            console.log('SUCCESS: Database flag is correctly set to 1.');
        } else {
            console.error('FAILURE: Database flag is NOT set correctly.');
        }

        console.log('--- STEP 3: VERIFY FILTER LOGIC (Product.findAll) ---');
        // Simulate what the frontend asks for: /api/v1/products?is_limited_offer=true
        const { products } = await Product.findAll({ is_limited_offer: true, limit: 10, offset: 0 });

        const found = products.find(p => p.id === productId);
        if (found) {
            console.log('SUCCESS: Product appears in restricted filter results.');
            console.log(`Found Product: ${found.name} (ID: ${found.id})`);
        } else {
            console.error('FAILURE: Product did NOT appear in filtered results.');
        }

        // Optional: Filter for Weekly Deals to ensure it Does NOT appear there
        const { products: weeklyProducts } = await Product.findAll({ is_weekly_deal: true, limit: 10, offset: 0 });
        const inWeekly = weeklyProducts.find(p => p.id === productId);
        if (!inWeekly) {
            console.log('SUCCESS: Product correctly excluded from Weekly Deals.');
        } else {
            console.error('FAILURE: Product INCORRECTLY appears in Weekly Deals.');
        }

        process.exit(0);
    } catch (e) {
        console.error('ERROR:', e);
        process.exit(1);
    }
}

testBackendFeatures();

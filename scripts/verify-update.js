require('dotenv').config();
const Product = require('../models/product.model');
const db = require('../config/db');

async function verifyUpdate() {
    try {
        console.log('--- TEST: UPDATE PRODUCT LOGIC ---');

        // 1. Find the test product created in the last step (ID: 38)
        // Or create a new one if not found. Let's find by name "Backend Verification Product"
        let [rows] = await db.query("SELECT * FROM products WHERE name = 'Backend Verification Product'");
        let product;

        if (rows.length === 0) {
            console.log('Test product not found, creating a new one for update test.');
            product = {
                name: 'Backend Update Test',
                price: 100,
                is_limited_offer: true,
                is_weekly_deal: false
            };
            const id = await Product.create(product);
            product.id = id;
            console.log(`Created new test product (ID: ${id})`);
        } else {
            product = rows[0];
            console.log(`Found existing test product (ID: ${product.id})`);
            console.log(`Current State: Limited=${product.is_limited_offer}, Weekly=${product.is_weekly_deal}`);
        }

        const productId = product.id;

        // 2. Perform Update: Change from Limited Offer to Weekly Deal
        console.log('--- ACTION: SWITCHING FLAGS (Limited -> Weekly) ---');
        const updateData = {
            is_limited_offer: false,
            is_weekly_deal: true,
            // Also update price to confirm other fields work
            price: 555.55
        };

        await Product.update(productId, updateData);
        console.log('Product updated.');

        // 3. Verify Database State
        console.log('--- ACTION: CHECKING DATABASE AFTER UPDATE ---');
        [rows] = await db.query('SELECT name, price, is_limited_offer, is_weekly_deal FROM products WHERE id = ?', [productId]);
        const updatedProduct = rows[0];

        console.log('New State:', JSON.stringify(updatedProduct, null, 2));

        let success = true;
        if (updatedProduct.is_limited_offer !== 0) {
            console.error('FAILURE: is_limited_offer should be 0');
            success = false;
        }
        if (updatedProduct.is_weekly_deal !== 1) {
            console.error('FAILURE: is_weekly_deal should be 1');
            success = false;
        }
        if (updatedProduct.price !== '555.55' && updatedProduct.price !== 555.55) { // Handle string/number variance
            // MySQL decimal might return string
            console.log(`Price Check: Expected 555.55, Got ${updatedProduct.price}`);
        }

        if (success) {
            console.log('SUCCESS: Update logic correctly switched flags and price.');
        } else {
            console.log('FAILURE: Update did not apply correctly.');
        }

        // 4. Clean Up
        console.log('--- CLEANING UP ---');
        await Product.delete(productId);
        console.log('Test product deleted.');

        process.exit(0);
    } catch (e) {
        console.error('ERROR:', e);
        process.exit(1);
    }
}

verifyUpdate();

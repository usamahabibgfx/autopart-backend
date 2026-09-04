const fs = require('fs');
const path = require('path');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Mock environment variables for the preview if not set
process.env.PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://bestsignatureautoparts.com';
process.env.MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || 'https://api.bestsignatureautoparts.com';

// Import the services
const { buildEmail } = require('./services/stockNotifications.service');
const { sendEmail, sendOrderStatusUpdateEmail, sendOrderConfirmationEmail, sendAbandonedCartEmail } = require('./utils/sendEmail');

const mockProduct = {
    productName: "Pitco 50006607 ELEMENT, 208/240V, 8.3KW",
    productSlug: "pitco-element-50006607",
    productImage: "products/pitco-element.webp",
    price: 2449.00,
    variantLabel: "208/240V, 8.3KW"
};

const mockOrder = {
    id: "3QWRVIUSQ",
    created_at: new Date(),
    total_amount: 13980.00, // Subtotal
    vat_amount: 698.00,
    discount_amount: 0.00,
    final_amount: 14678.00, // Total
    payment_method: "cod",
    billing_details: {
        firstName: "Mohamad",
        lastName: "Sam",
        streetAddress: "Dera, Dubai",
        city: "Dubai",
        phone: "+971509967967"
    },
    items: [
        {
            name: "Star Max 6036CBF, Countertop Gas Lava Rock Charbroiler 36\"",
            quantity: 2,
            price_at_purchase: 6990.00,
            image: "https://bestsignatureautoparts.com/wp-content/uploads/2024/10/charbroiler.png"
        }
    ]
};

async function runTest() {
    try {
        const receiver = process.env.RECEIVER_EMAIL;
        if (!receiver) {
            console.error('RECEIVER_EMAIL not found in .env');
            return;
        }

        console.log('--- Testing Stock Notification ---');
        const stockData = buildEmail(mockProduct);
        const stockSubject = `${stockData.subject} (${new Date().toLocaleTimeString()})`;
        await sendEmail(receiver, stockSubject, stockData.html);
        fs.writeFileSync(path.join(__dirname, 'email_preview.html'), stockData.html);
        console.log('✅ Stock Notification Sent');

        console.log('\n--- Testing Order Status Update ---');
        const orderSubject = `Your order #${mockOrder.id} delivered — Best Signature Auto Parts (${new Date().toLocaleTimeString()})`;
        await sendOrderStatusUpdateEmail(receiver, "Mohamad", mockOrder.id, "delivered", { ...mockOrder, subject: orderSubject });
        console.log('✅ Order Status Update Sent');

        console.log('\n--- Testing Order Confirmation (Post-Checkout) ---');
        await sendOrderConfirmationEmail(receiver, "Mohamad", mockOrder.id, mockOrder.final_amount, mockOrder.items, mockOrder);
        console.log('✅ Order Confirmation Sent');

        // Abandoned cart mock items
        const mockCartItems = [
            {
                name: "Ooni Koda 16 Gas Outdoor Pizza Oven",
                quantity: 1,
                price: 4029.00,
                offer_price: 3876.06,
                image: "https://bestsignatureautoparts.com/wp-content/uploads/2024/10/charbroiler.png",
                slug: "ooni-koda-16-gas"
            },
            {
                name: "Fama Industrie FA253, Food Slicer",
                quantity: 1,
                price: 6325.00,
                offer_price: null,
                image: "https://bestsignatureautoparts.com/wp-content/uploads/2024/10/kitchen-equipment-store.png",
                slug: "fama-fa253-food-slicer"
            }
        ];

        console.log('\n--- Testing Abandoned Cart Reminder #1 ---');
        await sendAbandonedCartEmail(receiver, "Mohamad", mockCartItems, 1);
        console.log('✅ Abandoned Cart Reminder #1 Sent');

        console.log('\n--- Testing Abandoned Cart Reminder #2 ---');
        await sendAbandonedCartEmail(receiver, "Mohamad", mockCartItems, 2);
        console.log('✅ Abandoned Cart Reminder #2 Sent');

        console.log('\n==========================================');
        console.log('All tests completed successfully!');
        console.log('Check your inbox at:', receiver);
        console.log('==========================================');
    } catch (error) {
        console.error('Error during test:', error);
    }
}

runTest();

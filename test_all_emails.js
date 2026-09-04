/**
 * Sends EVERY transactional email to RECEIVER_EMAIL so the design / style /
 * shared footer can be checked in a real inbox.
 *
 *   node test_all_emails.js
 *
 * Needs .env: SMTP_EMAIL, SMTP_PASSWORD, RECEIVER_EMAIL.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
    sendWelcomeEmail,
    sendPasswordResetEmail,
    sendOtpEmail,
    sendOrderConfirmationEmail,
    sendOrderStatusUpdateEmail,
    sendAbandonedCartEmail,
    sendQuotationEmail,
    sendOfferNotificationEmail,
    sendInvoiceEmail,
    verifySmtpConnection
} = require('./utils/sendEmail');

const NAME = 'Sam';
const t = () => new Date().toLocaleTimeString();

const mockOrder = {
    id: '3QWRVIUSQ',
    created_at: new Date(),
    total_amount: 13980.0,
    vat_amount: 698.0,
    discount_amount: 0.0,
    final_amount: 14678.0,
    payment_method: 'cod',
    payment_status: 'paid',
    billing_details: { firstName: 'Mohamad', lastName: 'Sam', streetAddress: 'Deira, Dubai', city: 'Dubai', phone: '+971509967967' },
    shipping_address: { firstName: 'Mohamad', lastName: 'Sam', streetAddress: 'Deira, Dubai', city: 'Dubai', phone: '+971509967967' },
    items: [
        { name: 'Star Max 6036CBF, Countertop Gas Lava Rock Charbroiler 36"', quantity: 2, price_at_purchase: 6990.0, image: 'https://bestsignatureautoparts.com/wp-content/uploads/2024/10/charbroiler.png' },
        { name: 'Ooni Koda 16 Gas Outdoor Pizza Oven', quantity: 1, price_at_purchase: 4029.0, is_free_gift: 1, bundle_parent_name: 'Star Max Charbroiler', image: 'https://bestsignatureautoparts.com/wp-content/uploads/2024/10/kitchen-equipment-store.png' }
    ]
};

const mockCart = [
    { name: 'Ooni Koda 16 Gas Outdoor Pizza Oven', quantity: 1, price: 4029.0, offer_price: 3876.06, image: 'https://bestsignatureautoparts.com/wp-content/uploads/2024/10/charbroiler.png', slug: 'ooni-koda-16-gas' },
    { name: 'Fama Industrie FA253, Food Slicer', quantity: 1, price: 6325.0, offer_price: null, image: 'https://bestsignatureautoparts.com/wp-content/uploads/2024/10/kitchen-equipment-store.png', slug: 'fama-fa253-food-slicer' }
];

const mockQuoteItems = [
    { name: 'Star Max Charbroiler 36"', quantity: 2, price: 6990.0 },
    { name: 'Fama FA253 Food Slicer', quantity: 1, price: 6325.0 }
];

const mockOfferProduct = {
    name: 'Ooni Koda 16 Gas Outdoor Pizza Oven',
    slug: 'ooni-koda-16-gas',
    price: 4029.0,
    offer_price: 3399.0,
    primaryImage: 'https://bestsignatureautoparts.com/wp-content/uploads/2024/10/charbroiler.png'
};

// Each step: [label, fn]. Runs sequentially; one failure doesn't stop the rest.
async function run() {
    const to = process.env.RECEIVER_EMAIL;
    if (!to) { console.error('❌ RECEIVER_EMAIL missing in .env'); process.exit(1); }

    console.log('Verifying SMTP…');
    await verifySmtpConnection();
    console.log(`\nSending all emails to: ${to}\n`);

    const steps = [
        ['Welcome', () => sendWelcomeEmail(to, NAME)],
        ['Password Reset', () => sendPasswordResetEmail(to, NAME, 'http://localhost:3000/reset-password?token=demo-token-123')],
        ['OTP — Signup', () => sendOtpEmail(to, NAME, '482915', { purpose: 'signup' })],
        ['OTP — Email change', () => sendOtpEmail(to, NAME, '739204', { purpose: 'email-change' })],
        ['Order Confirmation (customer)', () => sendOrderConfirmationEmail(to, NAME, mockOrder.id, mockOrder.final_amount, mockOrder.items, mockOrder)],
        ['Order Received (receiver / admin copy)', () => sendOrderConfirmationEmail(to, NAME, mockOrder.id, mockOrder.final_amount, mockOrder.items, { ...mockOrder, is_admin_copy: true })],
        ['Order Status — Delivered', () => sendOrderStatusUpdateEmail(to, NAME, mockOrder.id, 'delivered', { ...mockOrder, subject: `Your order #${mockOrder.id} delivered — Best Signature (${t()})` })],
        ['Abandoned Cart #1', () => sendAbandonedCartEmail(to, NAME, mockCart, 1)],
        ['Abandoned Cart #2', () => sendAbandonedCartEmail(to, NAME, mockCart, 2)],
        ['Quotation', () => sendQuotationEmail(to, NAME, 'QT-2026-0042', 14678.0, mockQuoteItems)],
        ['Offer Notification', () => sendOfferNotificationEmail(to, NAME, mockOfferProduct, 'Daily Offer')],
        ['Invoice (no PDF)', () => sendInvoiceEmail(to, NAME, 'INV-2026-0042', mockOrder.id, mockOrder.final_amount, mockOrder.items, 'Admin', null)]
    ];

    let ok = 0, fail = 0;
    for (const [label, fn] of steps) {
        try {
            process.stdout.write(`→ ${label} … `);
            await fn();
            console.log('✅');
            ok++;
        } catch (e) {
            console.log(`❌ ${e.message}`);
            fail++;
        }
    }

    console.log(`\n==============================`);
    console.log(`Done. Sent ${ok}/${steps.length}  (failed ${fail})`);
    console.log(`Check inbox: ${to}`);
    console.log(`==============================`);
    process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });

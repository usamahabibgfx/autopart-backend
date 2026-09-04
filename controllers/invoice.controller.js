const db = require('../config/db');
const Invoice = require('../models/invoice.model');
const Order = require('../models/order.model');
const { sendInvoiceEmail } = require('../utils/sendEmail');
const User = require('../models/user.model');

exports.checkInvoice = async (req, res, next) => {
    try {
        const invoice_number = req.query.number;
        if (!invoice_number) return res.status(400).json({ success: false, message: 'Invoice number required' });
        const exists = await Invoice.existsByNumber(invoice_number);
        res.json({ success: true, exists });
    } catch (err) {
        next(err);
    }
};

// Fetch order with user email/name joined from users table
async function getOrderWithUser(orderId) {
    const [rows] = await db.execute(`
        SELECT o.*,
               u.email  AS user_email,
               u.name   AS user_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
    `, [orderId]);
    if (!rows[0]) return null;

    const [items] = await db.execute(`
        SELECT oi.*, p.name,
               (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC LIMIT 1) AS image
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
    `, [orderId]);

    rows[0].items = items;
    return rows[0];
}

exports.createInvoice = async (req, res, next) => {
    try {
        const { order_id, invoice_number, given_by_name, pdf_base64 } = req.body;

        if (!order_id || !invoice_number) {
            return res.status(400).json({ success: false, message: 'order_id and invoice_number are required' });
        }

        // Check duplicate invoice number
        const exists = await Invoice.existsByNumber(invoice_number);
        if (exists) {
            return res.status(409).json({ success: false, message: 'Invoice number already exists' });
        }

        const order = await getOrderWithUser(order_id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Resolve customer email and name — billing_details JSON takes priority, then joined user row
        let billingDetails = {};
        try { if (order.billing_details) billingDetails = JSON.parse(order.billing_details); } catch (_) { }

        const customerEmail = billingDetails.email || order.user_email || null;
        const customerName = billingDetails.name
            || (billingDetails.firstName ? `${billingDetails.firstName} ${billingDetails.lastName || ''}`.trim() : null)
            || order.user_name
            || null;

        const n = v => (v === undefined ? null : v);
        const invoiceId = await Invoice.create({
            invoice_number,
            order_id,
            user_id: n(order.user_id),
            user_email: customerEmail,
            user_name: customerName,
            order_total: order.final_amount ?? 0,
            given_by_user_id: n(req.user.id),
            given_by_name: n(given_by_name || req.user.name) || null
        });

        // Decode the base64 PDF generated on the frontend (data:application/pdf;base64,...)
        let pdfBuffer = null;
        if (pdf_base64) {
            try {
                const base64Data = pdf_base64.replace(/^data:application\/pdf[^,]*,/, '');
                pdfBuffer = Buffer.from(base64Data, 'base64');
            } catch (e) {
                console.warn('[Invoice] Could not decode pdf_base64:', e.message);
            }
        }

        // Send invoice email with PDF attachment
        if (customerEmail) {
            const invLocale = await User.getPreferredLocale(order.user_id);
            sendInvoiceEmail(
                customerEmail,
                customerName || 'Valued Customer',
                invoice_number,
                order_id,
                order.final_amount,
                order.items || [],
                given_by_name || req.user.name || '',
                pdfBuffer,
                invLocale
            ).then(() => {
                console.log(`[Invoice] ✅ Email sent to ${customerEmail} for invoice #${invoice_number}`);
            }).catch(err => {
                console.error(`[Invoice] ❌ Email failed for invoice #${invoice_number}:`, err.message);
            });
        } else {
            console.warn(`[Invoice] ⚠️ No customer email found for order #${order_id} — email not sent`);
        }

        res.status(201).json({
            success: true,
            message: 'Invoice created and sent to customer',
            data: { id: invoiceId, invoice_number, order_id }
        });
    } catch (error) {
        next(error);
    }
};

exports.getInvoices = async (req, res, next) => {
    try {
        const invoices = await Invoice.findAll();
        res.json({ success: true, data: invoices });
    } catch (error) {
        next(error);
    }
};

exports.getInvoice = async (req, res, next) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }
        res.json({ success: true, data: invoice });
    } catch (error) {
        next(error);
    }
};

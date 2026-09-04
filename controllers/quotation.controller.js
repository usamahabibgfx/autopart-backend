const db = require('../config/db');
const { sendQuotationEmail } = require('../utils/sendEmail');

// Lazy migration: persist the applied coupon/points discount so admin views and
// re-downloads can show a discount line. Runs once; cheap no-op afterwards.
let quotationDiscountColumnReady = false;
const ensureQuotationDiscountColumn = async () => {
    if (quotationDiscountColumnReady) return;
    try {
        const [cols] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'discount_amount'`
        );
        if (cols.length === 0) {
            await db.query(`ALTER TABLE quotations ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal`);
        }
        quotationDiscountColumnReady = true;
    } catch (e) {
        console.error('[Quotation] Failed to ensure discount_amount column:', e.message);
    }
};

// Lazy migration: a flag so the quotation email is sent exactly once, whether by
// the PDF follow-up (POST /:id/send-email) or the creation fallback timer.
let quotationEmailColumnReady = false;
const ensureQuotationEmailColumn = async () => {
    if (quotationEmailColumnReady) return;
    try {
        const [cols] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'email_sent'`
        );
        if (cols.length === 0) {
            await db.query(`ALTER TABLE quotations ADD COLUMN email_sent TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id`);
        }
        quotationEmailColumnReady = true;
    } catch (e) {
        console.error('[Quotation] Failed to ensure email_sent column:', e.message);
    }
};

// Atomically flip email_sent 0 -> 1. Returns true only for the caller that wins
// the race, so the PDF email and the fallback email can never both go out.
const claimQuotationEmail = async (id) => {
    try {
        const [r] = await db.execute('UPDATE quotations SET email_sent = 1 WHERE id = ? AND email_sent = 0', [id]);
        return r.affectedRows > 0;
    } catch (e) {
        console.error('[Quotation] Failed to claim email flag:', e.message);
        return false;
    }
};

exports.createQuotation = async (req, res, next) => {
    try {
        const {
            customer_name, customer_email, customer_phone, vat_number, items, subtotal, tax_amount, total_amount,
            discount_amount = 0, coupon_discount = 0, points_discount = 0, coupon_code = null, points_used = 0
        } = req.body;

        await ensureQuotationDiscountColumn();
        await ensureQuotationEmailColumn();

        // Prefer user from auth middleware (optionalProtect), fallback to body, then null
        const user_id = req.user?.id || req.body.user_id || null;

        // Sequential ref derived from the row id (assigned after insert). A temp placeholder
        // satisfies the NOT NULL UNIQUE column; we set the real EQT-{id} right after.
        const tempRef = `EQT-TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Enrich each line with the product's short description so the quotation PDF can
        // show it under the title/brand. Cart items don't carry it, so look it up here.
        try {
            const ids = [...new Set((items || []).map(i => i.id).filter(Boolean))];
            if (ids.length > 0) {
                const [rows] = await db.query(
                    'SELECT id, model, specifications, specifications_ar FROM products WHERE id IN (?)',
                    [ids]
                );
                const byId = {};
                rows.forEach(r => { byId[r.id] = r; });
                (items || []).forEach(it => {
                    const p = byId[it.id];
                    if (p) {
                        // Show the product specifications (like the product detail page) in the quotation.
                        it.specifications = p.specifications || '';
                        it.specifications_ar = p.specifications_ar || '';
                        // Cart lines may not carry the model — fall back to the product's model.
                        if (!it.model && p.model) it.model = p.model;
                    }
                });
            }
        } catch (e) {
            console.error('[Quotation] short description enrich failed:', e.message);
        }

        const [result] = await db.execute(
            `INSERT INTO quotations (quotation_ref, customer_name, customer_email, customer_phone, vat_number, items, subtotal, discount_amount, tax_amount, total_amount, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tempRef, customer_name, customer_email, customer_phone, vat_number, JSON.stringify(items), subtotal, discount_amount, tax_amount, total_amount, user_id]
        );

        // Sequential ref from the new row id, e.g. EQT-00042.
        const newId = result.insertId;
        const quotation_ref = `EQT-${String(newId).padStart(5, '0')}`;
        await db.execute('UPDATE quotations SET quotation_ref = ? WHERE id = ?', [quotation_ref, newId]);

        const newQuotation = {
            id: newId,
            quotation_ref,
            customer_name,
            customer_email,
            customer_phone,
            vat_number,
            items,
            subtotal,
            discount_amount,
            coupon_discount,
            points_discount,
            coupon_code,
            points_used,
            tax_amount,
            total_amount,
            user_id,
            created_at: new Date()
        };

        res.status(201).json({
            success: true,
            data: newQuotation
        });

        // The frontend normally follows up with POST /:id/send-email carrying the
        // client-generated PDF, which sends the quote with the PDF attached. If that
        // call never arrives (PDF generation failed, tab closed, network drop), this
        // fallback sends the inline-only quote so the customer always gets their email.
        // claimQuotationEmail() guarantees the two paths never both send.
        const { locale } = req.body;
        setTimeout(async () => {
            if (!(await claimQuotationEmail(newId))) return; // PDF email already went out
            try {
                await sendQuotationEmail(
                    customer_email, customer_name, quotation_ref, total_amount, items,
                    locale,
                    { subtotal, discount_amount, coupon_discount, points_discount, coupon_code, points_used, tax_amount }
                );
                console.log(`[Quotation] Fallback email (no PDF) sent for ${quotation_ref}`);
            } catch (e) {
                console.error('[Quotation] Fallback email failed:', e.message);
            }
        }, 30000);
    } catch (error) {
        console.error('Error creating quotation:', error);
        next(error);
    }
};

exports.getMyQuotations = async (req, res, next) => {
    try {
        const [quotations] = await db.execute(
            'SELECT * FROM quotations WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );

        res.status(200).json({
            success: true,
            data: quotations
        });
    } catch (error) {
        console.error('Error fetching quotations:', error);
        next(error);
    }
};

exports.deleteQuotation = async (req, res, next) => {
    try {
        const [quotation] = await db.execute(
            'SELECT * FROM quotations WHERE id = ?',
            [req.params.id]
        );

        if (quotation.length === 0) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        // Check if user owns the quotation or is admin
        if (quotation[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: 'Not authorized to delete this quotation' });
        }

        await db.execute('DELETE FROM quotations WHERE id = ?', [req.params.id]);

        res.status(200).json({
            success: true,
            message: 'Quotation deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting quotation:', error);
        next(error);
    }
};

exports.getQuotations = async (req, res, next) => {
    try {
        const [quotations] = await db.execute(
            'SELECT * FROM quotations ORDER BY created_at DESC'
        );

        res.status(200).json({
            success: true,
            data: quotations
        });
    } catch (error) {
        console.error('Error fetching all quotations:', error);
        next(error);
    }
};

exports.sendEmailWithPdf = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { pdf_base64, locale } = req.body;

        const [rows] = await db.execute('SELECT * FROM quotations WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }
        const q = rows[0];
        const items = typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || []);

        await ensureQuotationEmailColumn();
        // Exactly-once guard: if the creation fallback already emailed this
        // quotation, don't send a duplicate.
        if (!(await claimQuotationEmail(id))) {
            return res.status(200).json({ success: true, message: 'Quotation email already sent' });
        }

        let pdfBuffer = null;
        if (pdf_base64) {
            try {
                const base64Data = pdf_base64.replace(/^data:application\/pdf[^,]*,/, '');
                pdfBuffer = Buffer.from(base64Data, 'base64');
            } catch (e) {
                console.warn('[Quotation] Could not decode pdf_base64:', e.message);
            }
        }

        const qLocale = String(locale || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
        try {
            await sendQuotationEmail(
                q.customer_email,
                q.customer_name,
                q.quotation_ref,
                q.total_amount,
                items,
                qLocale,
                {
                    subtotal: q.subtotal,
                    discount_amount: q.discount_amount,
                    tax_amount: q.tax_amount
                },
                pdfBuffer
            );
        } catch (e) {
            // Release the flag so the fallback can still get an email out.
            await db.execute('UPDATE quotations SET email_sent = 0 WHERE id = ?', [id]).catch(() => {});
            throw e;
        }

        res.status(200).json({ success: true, message: 'Quotation email sent' });
    } catch (error) {
        console.error('Error sending quotation email:', error);
        next(error);
    }
};

// Internal Quotation Software tool: send the SAME branded quotation email
// (reuses sendQuotationEmail) WITHOUT writing to the `quotations` table — the tool
// persists its own record in `quotations_software`. Optional shared-secret guard
// via QUOTATION_TOOL_KEY so it can't be abused to send arbitrary mail.
exports.sendSoftwareQuotationEmail = async (req, res, next) => {
    try {
        if (process.env.QUOTATION_TOOL_KEY && req.headers['x-tool-key'] !== process.env.QUOTATION_TOOL_KEY) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const { customer_email, customer_name, quotation_ref, total_amount, items = [], locale = 'en', totals = {}, pdf_base64 } = req.body;
        if (!customer_email) {
            return res.status(400).json({ success: false, message: 'customer_email is required' });
        }
        let pdfBuffer = null;
        if (pdf_base64) {
            try {
                pdfBuffer = Buffer.from(String(pdf_base64).replace(/^data:application\/pdf[^,]*,/, ''), 'base64');
            } catch (e) {
                console.warn('[Quotation] Could not decode software pdf_base64:', e.message);
            }
        }
        await sendQuotationEmail(customer_email, customer_name, quotation_ref, Number(total_amount) || 0, items, locale, totals, pdfBuffer);
        res.status(200).json({ success: true, message: 'Quotation email sent' });
    } catch (error) {
        console.error('[Quotation] Software email failed:', error.message);
        next(error);
    }
};

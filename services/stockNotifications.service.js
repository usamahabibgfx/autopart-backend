const db = require('../config/db');
const { sendEmail } = require('./email.service');
const { sendBackInStockEmail } = require('../utils/sendEmail');

const FROM_NAME = 'Best Signature Auto Parts';
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://bestsignatureautoparts.com';
const MEDIA_BASE_URL = (process.env.MEDIA_BASE_URL || 'https://api.bestsignatureautoparts.com').replace(/\/+$/, '');

/**
 * Absolutize an image path so email clients can fetch it.
 * Handles: full URLs, root-relative paths (/uploads/...), bare paths (uploads/...),
 * Windows backslashes (uploads\products\foo.webp), and URL-unsafe chars (spaces).
 */
const absolutizeImage = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.trim().replace(/\\/g, '/');
    if (!s) return '';
    s = s.replace(/^(\/)?public\//, '');
    if (/^data:/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s.replace(/ /g, '%20');
    if (s.startsWith('//')) return `https:${s}`.replace(/ /g, '%20');
    // Auto-prefix uploads/ for bare brands/ or products/ paths (matches frontend resolveUrl)
    if (!s.startsWith('/') && (/^(brands|products|slides|posters)\//.test(s))) {
        s = `uploads/${s}`;
    }
    if (!s.startsWith('/')) s = `/${s}`;
    return `${MEDIA_BASE_URL}${s}`.replace(/ /g, '%20');
};

let tableEnsured = false;
const ensureTable = async () => {
    if (tableEnsured) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS stock_notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_id INT NOT NULL,
            variant_label VARCHAR(255) NOT NULL DEFAULT '',
            email VARCHAR(255) NOT NULL,
            user_id INT NULL,
            notified_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_pve (product_id, variant_label, email),
            INDEX idx_pending (product_id, notified_at)
        )
    `);
    // Best-effort migration for installs that already have the older schema
    // without variant_label. Safe to run repeatedly — ignored if it already exists.
    try {
        await db.query(`ALTER TABLE stock_notifications ADD COLUMN variant_label VARCHAR(255) NOT NULL DEFAULT '' AFTER product_id`);
    } catch (e) { /* column already exists — ignore */ }
    tableEnsured = true;
};

const isValidEmail = (email) =>
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    email.length <= 255;

/**
 * Build a stable, human-readable label from a variant's chosen option values
 * and the product's options definition. e.g. "Red / Large".
 * Returns '' when no options to label.
 */
exports.buildVariantLabel = (variant, options) => {
    if (!variant || !Array.isArray(variant.options) || variant.options.length === 0) return '';
    if (!Array.isArray(options) || options.length === 0) return '';
    const parts = options
        .map(opt => {
            const chosen = variant.options.find(vo => Number(vo.option_id) === Number(opt.id));
            return chosen ? String(chosen.value || '').trim() : '';
        })
        .filter(Boolean);
    return parts.join(' / ').slice(0, 255);
};

/**
 * Add an email to the notify-when-available list. Idempotent — re-subscribing
 * resets notified_at so the user gets re-notified next restock.
 *
 * variantLabel: pass '' for whole-product subscriptions, or "Red / Large"
 * for a specific variant. Stored verbatim — dispatch matches by exact string.
 */
exports.subscribe = async ({ productId, email, userId = null, variantLabel = '' }) => {
    await ensureTable();
    if (!productId || !isValidEmail(email)) {
        const err = new Error('Invalid product or email');
        err.statusCode = 400;
        throw err;
    }
    const cleanEmail = email.trim().toLowerCase();
    const label = String(variantLabel || '').trim().slice(0, 255);
    await db.query(
        `INSERT INTO stock_notifications (product_id, email, user_id, variant_label)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE notified_at = NULL, user_id = COALESCE(VALUES(user_id), user_id)`,
        [productId, cleanEmail, userId, label]
    );
};

const buildEmail = ({ productName, productSlug, productImage, price, variantLabel }) => {
    const productUrl = `${SITE_URL}/product/${productSlug || ''}`;
    const headlineProduct = variantLabel ? `${productName} — ${variantLabel}` : productName;
    const subject = `Back in stock: ${headlineProduct}`;
    const safeImage = absolutizeImage(productImage) || `${SITE_URL}/assets/best-signature-logo.webp`;
    console.log(`[notify] email image — raw="${productImage}" → resolved="${safeImage}"`);
    const variantBadge = variantLabel
        ? `<p style="margin:10px 0 0;display:inline-block;padding:4px 10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${variantLabel}</p>`
        : '';
    const priceLine = price
        ? `<p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#111;">AED ${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`
        : '';
    const messageHeadline = variantLabel
        ? `${variantLabel} is back in stock!`
        : `Good news — it's available again!`;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
        @media only screen and (max-width: 600px) {
            .content { padding: 30px 20px !important; }
            .footer-col { width: 100% !important; padding: 10px 0 !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#4a5568;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f9;padding:20px 10px;">
        <tr>
            <td align="center">
                <!-- Pre-header -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-bottom:15px;">
                    <tr>
                        <td style="font-size:12px;color:#94a3b8;">
                            Back In Stock: ${headlineProduct}
                        </td>
                    </tr>
                </table>

                <!-- Main Card -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                    <!-- Logo Header -->
                    <tr>
                        <td align="center" style="padding:35px 0;border-bottom:1px solid #f1f5f9;">
                            <img src="https://bestsignatureautoparts.com/assets/best-signature-logo.webp" alt="Best Signature Auto Parts" style="height:50px;display:inline-block;margin:0 auto;">
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding:45px 50px;" class="content">
                            <!-- Title with Accent Bar -->
                            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:25px;">
                                <tr>
                                    <td style="width:5px;background-color:#19489D;border-radius:3px;">&nbsp;</td>
                                    <td style="padding-left:15px;">
                                        <h1 style="margin:0;font-size:20px;font-weight:600;color:#0f172a;line-height:1.4;">${headlineProduct} is back in stock</h1>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 25px;font-size:16px;line-height:1.6;color:#475569;">Hello,</p>

                            <!-- Product Box -->
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:30px;background-color:#ffffff;">
                                <tr>
                                    <td style="padding:25px;width:130px;" align="center">
                                        <a href="${productUrl}" style="text-decoration:none;display:block;">
                                            <img src="${safeImage}" alt="${productName}" style="max-width:110px;max-height:110px;object-fit:contain;display:block;">
                                        </a>
                                    </td>
                                    <td style="padding:25px;vertical-align:middle;">
                                        <a href="${productUrl}" style="font-size:15px;font-weight:600;color:#19489D;text-decoration:none;line-height:1.4;display:block;">
                                            ${headlineProduct}
                                            ${price ? `<p style="margin:10px 0 0;font-size:18px;font-weight:700;color:#0f172a;">AED ${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>` : ''}
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 35px;font-size:16px;line-height:1.6;color:#475569;">Please start shopping before it goes out of stock!</p>

                            <!-- CTA Button -->
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:45px;">
                                <tr>
                                    <td align="center">
                                        <a href="${productUrl}" style="display:inline-block;padding:18px 45px;background-color:#19489D;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;letter-spacing:0.5px;box-shadow:0 4px 12px rgba(22, 161, 219, 0.25);">Shop Now on Best Signaturestore.com</a>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 10px;font-size:16px;color:#475569;">Happy Shopping!</p>
                            <p style="margin:0;font-size:16px;color:#475569;">Regards,<br><strong>The Best Signature Team</strong></p>
                        </td>
                    </tr>
                </table>

                <!-- Footer Section -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:35px;">
                    <tr>
                        <!-- Any Questions -->
                        <td width="50%" class="footer-col" style="vertical-align:top;padding-right:15px;">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="vertical-align:top;"><img src="https://cdn-icons-png.flaticon.com/32/471/471664.png" width="22" height="22" alt="?"></td>
                                    <td style="padding-left:12px;">
                                        <p style="margin:0 0 5px;font-size:13px;font-weight:700;color:#475569;">Any questions?</p>
                                        <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">
                                            Visit our Help Center to <a href="${SITE_URL}/contact" style="color:#19489D;text-decoration:none;font-weight:600;">contact Customer Service</a>.<br>
                                            Available daily from 9:00 AM to 6:00 PM.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                        <!-- Follow Us -->
                        <td width="50%" class="footer-col" style="vertical-align:top;padding-left:15px;">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="vertical-align:top;"><img src="https://cdn-icons-png.flaticon.com/32/12034/12034988.png" width="22" height="22" alt="!"></td>
                                    <td style="padding-left:12px;">
                                        <p style="margin:0 0 5px;font-size:13px;font-weight:700;color:#475569;">Follow us!</p>
                                        <p style="margin:0 0 10px;font-size:11px;color:#64748b;">We share great offers and tips daily::</p>
                                        <table role="presentation" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="padding-right:12px;"><img src="https://cdn-icons-png.flaticon.com/32/733/733547.png" width="20" height="20"></td>
                                                <td style="padding-right:12px;"><img src="https://cdn-icons-png.flaticon.com/32/733/733579.png" width="20" height="20"></td>
                                                <td style="padding-right:12px;"><img src="https://cdn-icons-png.flaticon.com/32/2111/2111463.png" width="20" height="20"></td>
                                                <td><img src="https://cdn-icons-png.flaticon.com/32/1384/1384060.png" width="20" height="20"></td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="2" align="center" style="padding:45px 20px 20px;">
                            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                                You received this email because you asked to be notified when this product became available again.<br>
                                © ${new Date().getFullYear()} Best Signature New Auto Spare Parts Trading LLC. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    return { subject, html };
};

/**
 * Send back-in-stock emails to everyone subscribed to (productId, variantLabel).
 * Pass variantLabel='' for whole-product subscribers.
 * Marks each subscription notified so it won't fire again for the same restock.
 */
exports.dispatchForVariant = async ({ productId, variantLabel = '', productName, productSlug, productImage, price }) => {
    await ensureTable();
    if (!productId || !productName) return 0;

    const [pending] = await db.query(
        `SELECT id, email FROM stock_notifications
         WHERE product_id = ? AND variant_label = ? AND notified_at IS NULL`,
        [productId, String(variantLabel || '')]
    );
    if (pending.length === 0) return 0;

    // Use the design-system "Back in stock" email (logo + hero inlined as cid).
    const dsImage = absolutizeImage(productImage);

    let sent = 0;
    for (const row of pending) {
        try {
            await sendBackInStockEmail(row.email, {
                name: productName,
                slug: productSlug,
                image: dsImage,
                price,
                variantLabel
            });
            await db.query('UPDATE stock_notifications SET notified_at = NOW() WHERE id = ?', [row.id]);
            sent++;
        } catch (err) {
            console.error(`[stockNotifications] Failed to email ${row.email} for product ${productId} / "${variantLabel}":`, err.message);
        }
    }
    return sent;
};

exports.ensureTable = ensureTable;
exports.buildEmail = buildEmail;

/**
 * Abandoned Cart Reminder Service
 * 
 * Runs on a schedule to find users who have items in their cart but haven't
 * completed checkout, and sends reminder emails.
 * 
 * Reminder #1: Sent 1 hour after cart inactivity
 * Reminder #2: Sent 24 hours after cart inactivity
 */

const db = require('../config/db');
const { sendAbandonedCartEmail } = require('../utils/sendEmail');

// Ensure the tracking table exists
const ensureTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS cart_abandonment_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            reminder_number TINYINT NOT NULL DEFAULT 1,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_user_reminder (user_id, reminder_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
};

/**
 * Find carts that have been inactive (items not updated) and whose users
 * haven't placed a recent order. Send reminder emails.
 */
const processAbandonedCarts = async () => {
    try {
        await ensureTable();

        console.log('[ABANDONED CART] 🔍 Scanning for abandoned carts...');

        // ─── Reminder #1: Cart items older than 1 hour, no order in last 2 hours ───
        const [reminder1Users] = await db.query(`
            SELECT
                c.user_id,
                u.name AS user_name,
                u.email,
                u.preferred_locale
            FROM carts c
            JOIN cart_items ci ON ci.cart_id = c.id
            JOIN users u ON u.id = c.user_id
            WHERE ci.created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
              AND u.email IS NOT NULL
              AND u.email != ''
              AND c.user_id NOT IN (
                  SELECT user_id FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)
              )
              AND c.user_id NOT IN (
                  SELECT user_id FROM cart_abandonment_log WHERE reminder_number = 1 AND sent_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
              )
            GROUP BY c.user_id
        `);

        // ─── Reminder #2: Cart items older than 24 hours, already got reminder #1 ───
        const [reminder2Users] = await db.query(`
            SELECT
                c.user_id,
                u.name AS user_name,
                u.email,
                u.preferred_locale
            FROM carts c
            JOIN cart_items ci ON ci.cart_id = c.id
            JOIN users u ON u.id = c.user_id
            WHERE ci.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
              AND u.email IS NOT NULL
              AND u.email != ''
              AND c.user_id NOT IN (
                  SELECT user_id FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 48 HOUR)
              )
              AND c.user_id IN (
                  SELECT user_id FROM cart_abandonment_log WHERE reminder_number = 1
              )
              AND c.user_id NOT IN (
                  SELECT user_id FROM cart_abandonment_log WHERE reminder_number = 2 AND sent_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
              )
            GROUP BY c.user_id
        `);

        let totalSent = 0;

        // Send Reminder #1
        for (const user of reminder1Users) {
            try {
                const cartItems = await getCartItemsForEmail(user.user_id);
                if (cartItems.length === 0) continue;

                await sendAbandonedCartEmail(user.email, user.user_name, cartItems, 1, user.preferred_locale || 'en');

                await db.query(
                    `INSERT INTO cart_abandonment_log (user_id, reminder_number) VALUES (?, 1)
                     ON DUPLICATE KEY UPDATE sent_at = NOW()`,
                    [user.user_id]
                );
                totalSent++;
            } catch (err) {
                console.error(`[ABANDONED CART] ❌ Failed for user ${user.user_id}:`, err.message);
            }
        }

        // Send Reminder #2
        for (const user of reminder2Users) {
            try {
                const cartItems = await getCartItemsForEmail(user.user_id);
                if (cartItems.length === 0) continue;

                await sendAbandonedCartEmail(user.email, user.user_name, cartItems, 2, user.preferred_locale || 'en');

                await db.query(
                    `INSERT INTO cart_abandonment_log (user_id, reminder_number) VALUES (?, 2)
                     ON DUPLICATE KEY UPDATE sent_at = NOW()`,
                    [user.user_id]
                );
                totalSent++;
            } catch (err) {
                console.error(`[ABANDONED CART] ❌ Failed for user ${user.user_id}:`, err.message);
            }
        }

        console.log(`[ABANDONED CART] ✅ Scan complete. Sent ${totalSent} reminder(s).`);
        return totalSent;
    } catch (error) {
        console.error('[ABANDONED CART] ❌ Error processing abandoned carts:', error.message);
        return 0;
    }
};

/**
 * Get formatted cart items for email rendering
 */
const getCartItemsForEmail = async (userId) => {
    const [items] = await db.query(`
        SELECT
            ci.quantity,
            ci.variant_id,
            ci.is_free_gift,
            ci.custom_dimensions,
            ci.product_id,
            p.name, p.name_ar, p.price, p.offer_price, p.slug,
            p.is_customizable, p.custom_dimensions AS product_custom_dims, p.base_dimensions,
            (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as image,
            pv.price AS variant_price,
            pv.offer_price AS variant_offer_price,
            pv.image_url AS variant_image,
            pv.use_primary_image AS variant_use_primary
        FROM cart_items ci
        JOIN carts c ON c.id = ci.cart_id
        JOIN products p ON p.id = ci.product_id
        LEFT JOIN product_variants pv ON pv.id = ci.variant_id
        WHERE c.user_id = ?
    `, [userId]);

    const MEDIA = process.env.MEDIA_BASE_URL || 'https://api.bestsignatureautoparts.com';

    // Resolve a stored image to an absolute URL. Mirrors Cart.getCartItems' resolveImg so the
    // abandoned-cart email and the order/cart emails render the same product image identically.
    // Handles values that already include /uploads (no double-prefix) and bare relative paths.
    const resolveImg = (u) => {
        if (!u || typeof u !== 'string') return 'https://bestsignatureautoparts.com/assets/best-signature-logo.webp';
        if (u.startsWith('http') || u.startsWith('data:')) return u;
        if (u.startsWith('/assets/')) return u;
        return `${MEDIA}${u.startsWith('/') ? '' : '/'}${u}`;
    };

    // Tier pricing for customizable products (same calc as Cart.getCartItems) so the
    // reminder email shows the real configured price, not the 0 base price.
    const customIds = [...new Set(items.filter(i => Number(i.is_customizable) === 1).map(i => i.product_id))];
    const tiersByProduct = {};
    if (customIds.length > 0) {
        try {
            const [tierRows] = await db.query(
                `SELECT product_id, dimension, min_cm, max_cm, price FROM product_size_tiers WHERE product_id IN (?)`,
                [customIds]
            );
            for (const t of tierRows) {
                (tiersByProduct[t.product_id] = tiersByProduct[t.product_id] || []).push(t);
            }
        } catch (e) { /* table missing → fall back to base price */ }
    }
    const safeParse = (raw) => {
        if (!raw) return null;
        try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    };
    const computeCustomPrice = (item) => {
        if (Number(item.is_customizable) !== 1) return null;
        const cfgDims = safeParse(item.product_custom_dims);
        if (!Array.isArray(cfgDims) || cfgDims.length === 0) return null;
        const tiers = tiersByProduct[item.product_id] || [];
        if (tiers.length === 0) return null;
        const chosen = safeParse(item.custom_dimensions) || {};
        const baseDims = safeParse(item.base_dimensions) || {};
        let total = 0;
        for (const dim of cfgDims) {
            const v = (chosen[dim] != null && String(chosen[dim]).trim() !== '') ? Number(chosen[dim]) : Number(baseDims[dim]);
            if (!Number.isFinite(v)) return null;
            const tier = tiers.find(t => t.dimension === dim && v >= Number(t.min_cm) && v <= Number(t.max_cm));
            if (!tier) return null;
            total += Number(tier.price);
        }
        return total;
    };

    return items.map(item => {
        // A line has a variant only when it actually references one (matches cart.model.js).
        const hasVariant = item.variant_id != null;
        const usePrimary = hasVariant && Number(item.variant_use_primary) === 1;
        const rawImg = (hasVariant && !usePrimary && item.variant_image) ? item.variant_image : item.image;
        const fullImage = resolveImg(rawImg);

        // Variant price wins ONLY when it's a real positive value; many variants
        // inherit the base price (variant price stored as NULL or 0) — fall back to
        // the product price so the email never shows AED 0.00.
        const basePrice = Number(item.price) || 0;
        const variantPrice = Number(item.variant_price) || 0;
        const price = hasVariant && variantPrice > 0 ? variantPrice : basePrice;

        const baseOffer = item.offer_price != null ? Number(item.offer_price) : null;
        const variantOffer = item.variant_offer_price != null ? Number(item.variant_offer_price) : null;
        const offer_price = hasVariant && variantPrice > 0 ? variantOffer : baseOffer;

        // Customizable products use the size-tier price; they don't carry a separate offer.
        const isFree = Number(item.is_free_gift) === 1;
        const customPrice = isFree ? null : computeCustomPrice(item);

        return {
            name: item.name,
            name_ar: item.name_ar,
            quantity: item.quantity,
            // Free-gift = 0; customizable = tier price; else resolved variant/base price.
            price: isFree ? 0 : (customPrice != null ? customPrice : price),
            offer_price: isFree ? 0 : (customPrice != null ? null : offer_price),
            image: fullImage,
            slug: item.slug
        };
    });
};

/**
 * Start the abandoned cart reminder cron job
 * Runs every 30 minutes
 */
const startAbandonedCartJob = () => {
    console.log('[ABANDONED CART] 🚀 Cron job started (runs every 30 minutes)');

    // Run once on startup (delayed by 30 seconds to let server fully boot)
    setTimeout(() => {
        processAbandonedCarts();
    }, 30000);

    // Then run every 30 minutes
    setInterval(() => {
        processAbandonedCarts();
    }, 30 * 60 * 1000);
};

module.exports = {
    startAbandonedCartJob,
    processAbandonedCarts,
    getCartItemsForEmail
};

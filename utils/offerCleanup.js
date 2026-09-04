const db = require('../config/db');

const clearExpiredOffers = async () => {
    try {
        const [result] = await db.execute(`
            UPDATE products
            SET
                is_daily_offer  = 0,
                is_weekly_deal  = 0,
                is_limited_offer = 0,
                offer_price     = NULL,
                discount_percentage = 0
            WHERE
                offer_end IS NOT NULL
                AND offer_end <= NOW()
                AND (is_daily_offer = 1 OR is_weekly_deal = 1 OR is_limited_offer = 1)
        `);
        if (result.affectedRows > 0) {
            console.log(`[offerCleanup] Cleared expired offer flags from ${result.affectedRows} product(s)`);
        }
    } catch (err) {
        console.error('[offerCleanup] Failed to clear expired offers:', err.message);
    }
};

const startOfferCleanupJob = () => {
    clearExpiredOffers();
    setInterval(clearExpiredOffers, 60 * 60 * 1000); // re-run every hour
};

module.exports = { startOfferCleanupJob, clearExpiredOffers };

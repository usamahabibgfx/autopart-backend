/**
 * Monthly Reward-Points E-Statement Service
 *
 * On the 1st of each month, emails every user a reconciling statement of the
 * PREVIOUS calendar month: opening balance + earned − redeemed = closing balance.
 *
 * Data sources (reward_points_history.transaction_type ENUM:
 * earned|redeemed|expired|reversed|refunded):
 *   - Earned   = points added to the balance in the month
 *                = SUM('earned' + 'refunded')   (refunds return previously-spent points)
 *   - Redeemed = points removed from the balance in the month
 *                = SUM('redeemed' + 'reversed' + 'expired')
 *                  ('reversed' = earn claw-back when an order is cancelled)
 *   - Closing  = balance at the END of the statement month, derived by rewinding
 *                the live users.reward_points back over all activity since month-end.
 *   - Opening  = Closing − (Earned − Redeemed), i.e. the balance the month started with.
 *
 * Because Earned − Redeemed equals the month's true net balance change, the four
 * figures always reconcile against the live balance.
 *
 * Sends are de-duplicated via points_statement_log (one row per user per period).
 */

const db = require('../config/db');
const { sendMonthlyStatementEmail } = require('../utils/sendEmail');

// Points expire this many months after being earned. 0/unset = no expiry → the
// "Expiring Next Month" figure is always 0. Set via env to enable the policy.
const POINTS_EXPIRY_MONTHS = Number(process.env.POINTS_EXPIRY_MONTHS) || 0;

const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const ensureTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS points_statement_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            period CHAR(7) NOT NULL,           -- 'YYYY-MM' of the statement month
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_user_period (user_id, period)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
};

// All scheduling and month boundaries are anchored to UAE local time so the
// statement always reflects a clean UAE calendar month and fires at 10:00 Dubai.
// (UAE is a fixed UTC+4 with no DST, so this is unambiguous.)
const UAE_TZ = 'Asia/Dubai';
const pad2 = (n) => String(n).padStart(2, '0');

// Current UAE wall-clock parts: { year, month (1-based), day, hour (0-23) }.
const uaeNow = (ref = new Date()) => {
    const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: UAE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(ref).reduce((a, x) => (a[x.type] = x.value, a), {});
    return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour };
};

// Returns { startSql, endSql, period, monthIndex, year } for the UAE calendar
// month immediately before `ref`. startSql/endSql are naive 'YYYY-MM-DD HH:MM:SS'
// strings in UAE wall-clock; end is exclusive (= first of the current month).
const previousMonthRange = (ref = new Date()) => {
    const { year, month } = uaeNow(ref);     // current UAE year & 1-based month
    let py = year, pm = month - 1;           // previous month (1-based)
    if (pm === 0) { pm = 12; py = year - 1; }
    const period = `${py}-${pad2(pm)}`;
    const startSql = `${py}-${pad2(pm)}-01 00:00:00`;
    const endSql = `${year}-${pad2(month)}-01 00:00:00`;
    return { startSql, endSql, period, monthIndex: pm - 1, year: py };
};

/**
 * Build the per-user stats for the given statement month.
 * Returns a Map keyed by user_id.
 */
const computeStats = async (range) => {
    const { startSql, endSql } = range;

    // startSql/endSql are UAE wall-clock strings. reward_points_history.created_at
    // is a TIMESTAMP (stored UTC, compared in the session time zone), so we pin
    // THIS connection's session to UAE (+04:00). That makes the boundary
    // comparisons correct regardless of the server's default time zone, and is
    // released right after so no other query is affected.
    const conn = await db.getConnection();
    // Capture the connection's current zone so we can restore it before releasing
    // back to the pool (mysql2 does not reset session vars on release).
    const [[{ tz: prevTz }]] = await conn.query("SELECT @@session.time_zone AS tz");
    try {
        await conn.query("SET time_zone = '+04:00'");

        // In-month ledger movement per user, expressed as the two statement columns:
        //   earned   = points that ADDED to the balance     → 'earned' + 'refunded'
        //   redeemed = points that LEFT the balance          → 'redeemed' + 'reversed' + 'expired'
        // Defined this way (earned − redeemed = the month's net balance change), so
        // the statement always reconciles: opening + earned − redeemed = closing.
        // In the common case (no cancellations) refunded/reversed/expired are 0, so
        // these are just plain earned and redeemed.
        const [monthRows] = await conn.query(`
            SELECT user_id,
                   COALESCE(SUM(CASE WHEN transaction_type IN ('earned','refunded')            THEN points ELSE 0 END), 0) AS earned,
                   COALESCE(SUM(CASE WHEN transaction_type IN ('redeemed','reversed','expired') THEN points ELSE 0 END), 0) AS redeemed
            FROM reward_points_history
            WHERE created_at >= ? AND created_at < ?
            GROUP BY user_id
        `, [startSql, endSql]);

        // Net balance change AFTER the statement month (endSql → now). Lets us rewind
        // the live users.reward_points back to the month-END closing balance, so the
        // statement reflects the month it covers — not activity since.
        const [afterRows] = await conn.query(`
            SELECT user_id,
                   COALESCE(SUM(CASE WHEN transaction_type IN ('earned','refunded') THEN points ELSE -points END), 0) AS net_after
            FROM reward_points_history
            WHERE created_at >= ?
            GROUP BY user_id
        `, [endSql]);

        const stats = new Map();
        const ensure = (id) => {
            if (!stats.has(id)) stats.set(id, { earned: 0, redeemed: 0, netAfter: 0 });
            return stats.get(id);
        };
        for (const r of monthRows) { const s = ensure(r.user_id); s.earned = Number(r.earned); s.redeemed = Number(r.redeemed); }
        for (const r of afterRows) { ensure(r.user_id).netAfter = Number(r.net_after); }
        return stats;
    } finally {
        // Restore the original zone so the pooled connection is reusable as-is.
        try { await conn.query("SET time_zone = ?", [prevTz]); } catch (_) { /* ignore */ }
        conn.release();
    }
};

/**
 * Process and send statements for the previous month. Idempotent: users who
 * already received this period's statement are skipped.
 */
const processMonthlyStatements = async (ref = new Date()) => {
    try {
        await ensureTable();
        const range = previousMonthRange(ref);
        const monthLabel = `${EN_MONTHS[range.monthIndex]} ${range.year}`;
        const monthLabelAr = `${AR_MONTHS[range.monthIndex]} ${range.year}`;

        console.log(`[POINTS STATEMENT] 📊 Building statements for ${range.period}...`);

        const statsMap = await computeStats(range);

        // Every user with an email gets a statement (balance is always meaningful,
        // even if the month had no activity — matches the screenshot's 0.00 rows).
        const [users] = await db.query(`
            SELECT u.id, u.name, u.email, u.reward_points, u.preferred_locale
            FROM users u
            WHERE u.email IS NOT NULL AND u.email != ''
              AND u.id NOT IN (SELECT user_id FROM points_statement_log WHERE period = ?)
        `, [range.period]);

        let sent = 0;
        for (const u of users) {
            try {
                const s = statsMap.get(u.id) || { earned: 0, redeemed: 0, netAfter: 0 };
                // Rewind the live balance to the statement month's close, then
                // back out the month's net movement to get the opening balance.
                const balanceNow = Number(u.reward_points) || 0;
                const closing = balanceNow - s.netAfter;
                const opening = closing - (s.earned - s.redeemed);
                await sendMonthlyStatementEmail(
                    u.email,
                    u.name || '',
                    {
                        opening,
                        earned: s.earned,
                        redeemed: s.redeemed,
                        balance: closing,
                        monthLabel,
                        monthLabelAr,
                    },
                    u.preferred_locale || 'en'
                );
                await db.query(
                    `INSERT IGNORE INTO points_statement_log (user_id, period) VALUES (?, ?)`,
                    [u.id, range.period]
                );
                sent++;
            } catch (err) {
                console.error(`[POINTS STATEMENT] ❌ Failed for user ${u.id}:`, err.message);
            }
        }

        console.log(`[POINTS STATEMENT] ✅ ${range.period}: sent ${sent} statement(s).`);
        return sent;
    } catch (error) {
        console.error('[POINTS STATEMENT] ❌ Error:', error.message);
        return 0;
    }
};

/**
 * Start the monthly statement job. Checks hourly and sends the PREVIOUS month's
 * statement within a UAE-time window: from 10:00 on the 1st, then all of the 2nd
 * and 3rd as a grace period. The per-user log makes every run idempotent, so:
 *   - the repeated ticks send each user at most once per period, and
 *   - if the server was down for the whole 1st, the 2nd/3rd ticks still catch up.
 * On the 2nd/3rd `previousMonthRange` still resolves to the same prior month, so
 * the grace window targets the same period — no risk of sending the wrong month.
 */
const startPointsStatementJob = () => {
    console.log('[POINTS STATEMENT] 🚀 Job started (fires monthly: 1st 10:00 Asia/Dubai, with a 2nd–3rd grace window)');

    const tick = () => {
        const { day, hour } = uaeNow();
        // 1st: only from 10:00 onward. 2nd & 3rd: any hour (pure catch-up).
        const inWindow = (day === 1 && hour >= 10) || day === 2 || day === 3;
        if (inWindow) {
            processMonthlyStatements();
        }
    };

    // Initial check shortly after boot (covers a server that starts on the 1st).
    setTimeout(tick, 60 * 1000);
    // Re-check every hour so we land within the 10:00 Dubai window.
    setInterval(tick, 60 * 60 * 1000);
};

module.exports = {
    startPointsStatementJob,
    processMonthlyStatements,
    computeStats,
    previousMonthRange,
};

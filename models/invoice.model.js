const db = require('../config/db');

const Invoice = {
    async create({ invoice_number, order_id, user_id, user_email, user_name, order_total, given_by_user_id, given_by_name }) {
        const n = v => (v === undefined || v === '' ? null : v);
        const [result] = await db.execute(
            `INSERT INTO invoices
             (invoice_number, order_id, user_id, user_email, user_name, order_total, given_by_user_id, given_by_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                n(invoice_number),
                n(order_id),
                n(user_id),
                n(user_email),
                n(user_name),
                n(order_total) ?? 0,
                n(given_by_user_id),
                n(given_by_name)
            ]
        );
        return result.insertId;
    },

    async findAll() {
        const [rows] = await db.execute(`
            SELECT i.*,
                   o.final_amount, o.status AS order_status, o.payment_status,
                   u.name AS customer_name_from_users
            FROM invoices i
            LEFT JOIN orders o ON i.order_id = o.id
            LEFT JOIN users u ON i.user_id = u.id
            ORDER BY i.created_at DESC
        `);
        return rows;
    },

    async findById(id) {
        const [rows] = await db.execute(
            `SELECT i.*, o.final_amount, o.status AS order_status
             FROM invoices i
             LEFT JOIN orders o ON i.order_id = o.id
             WHERE i.id = ?`,
            [id]
        );
        return rows[0] || null;
    },

    async findByOrderId(order_id) {
        const [rows] = await db.execute(
            'SELECT * FROM invoices WHERE order_id = ?',
            [order_id]
        );
        return rows[0] || null;
    },

    async existsByNumber(invoice_number) {
        const [rows] = await db.execute(
            'SELECT id FROM invoices WHERE invoice_number = ?',
            [invoice_number]
        );
        return rows.length > 0;
    }
};

module.exports = Invoice;

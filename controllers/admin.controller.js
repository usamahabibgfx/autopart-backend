const db = require('../config/db');

// @desc    Get dashboard stats
// @route   GET /api/v1/admin/stats
// @access  Private/Admin
exports.getDashboardStats = async (req, res, next) => {
    try {
        const { timeRange, from, to } = req.query;
        let dateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)"; // default
        let oDateCondition = "o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";
        let prevDateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)";

        switch (timeRange) {
            case 'today':
                dateCondition = "DATE(created_at) = CURDATE()";
                oDateCondition = "DATE(o.created_at) = CURDATE()";
                prevDateCondition = "DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)";
                break;
            case 'custom': {
                // Validate strict YYYY-MM-DD to keep the SQL safe (parameterized queries
                // aren't used for these condition strings — see existing pattern above).
                const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
                if (isDate(from) && isDate(to) && from <= to) {
                    dateCondition = `DATE(created_at) BETWEEN '${from}' AND '${to}'`;
                    oDateCondition = `DATE(o.created_at) BETWEEN '${from}' AND '${to}'`;
                    // Prev period = equal-length window immediately before `from`.
                    prevDateCondition = `DATE(created_at) BETWEEN DATE_SUB('${from}', INTERVAL DATEDIFF('${to}', '${from}') + 1 DAY) AND DATE_SUB('${from}', INTERVAL 1 DAY)`;
                }
                // Invalid custom range falls through to the 7d default — no break needed for safety.
                break;
            }
            case '14d':
                dateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)";
                oDateCondition = "o.created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)";
                prevDateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 14 DAY)";
                break;
            case '30d':
                dateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)";
                oDateCondition = "o.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)";
                prevDateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)";
                break;
            case '3m':
                dateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)";
                oDateCondition = "o.created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)";
                prevDateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) AND created_at < DATE_SUB(CURDATE(), INTERVAL 3 MONTH)";
                break;
            case '6m':
                dateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)";
                oDateCondition = "o.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)";
                prevDateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND created_at < DATE_SUB(CURDATE(), INTERVAL 6 MONTH)";
                break;
            case '1y':
                dateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)";
                oDateCondition = "o.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)";
                prevDateCondition = "created_at >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR) AND created_at < DATE_SUB(CURDATE(), INTERVAL 1 YEAR)";
                break;
            case 'all':
                dateCondition = "1=1";
                oDateCondition = "1=1";
                prevDateCondition = "1=0";
                break;
        }

        const [[{ count: userCount }]] = await db.query(`SELECT COUNT(*) as count FROM users`);
        const [[{ count: totalProducts }]] = await db.query('SELECT COUNT(*) as count FROM products');
        const [[{ count: activeProducts }]] = await db.query("SELECT COUNT(*) as count FROM products WHERE status = 'active' AND is_active = 1");
        const [[{ count: totalOrders, total_sales: totalSales }]] = await db.query(`SELECT COUNT(*) as count, SUM(total_amount) as total_sales FROM orders WHERE status != 'cancelled' AND ${dateCondition}`);
        const [[{ count: prevTotalOrders, total_sales: prevTotalSales }]] = await db.query(`SELECT COUNT(*) as count, SUM(total_amount) as total_sales FROM orders WHERE status != 'cancelled' AND ${prevDateCondition}`);

        // Status breakdown for the active period — used by dashboard stat cards.
        const [[{ count: pendingOrders }]] = await db.query(`SELECT COUNT(*) as count FROM orders WHERE status = 'pending' AND ${dateCondition}`);
        const [[{ count: processingOrders }]] = await db.query(`SELECT COUNT(*) as count FROM orders WHERE status = 'processing' AND ${dateCondition}`);
        const [[{ count: deliveredOrders }]] = await db.query(`SELECT COUNT(*) as count FROM orders WHERE status = 'delivered' AND ${dateCondition}`);
        const [[{ count: cancelledOrders }]] = await db.query(`SELECT COUNT(*) as count FROM orders WHERE status = 'cancelled' AND ${dateCondition}`);

        const currentSales = totalSales || 0;
        const previousSales = prevTotalSales || 0;
        const salesGrowth = previousSales > 0 ? Math.round(((currentSales - previousSales) / previousSales) * 100) : (currentSales > 0 ? 100 : 0);

        const currentOrders = totalOrders || 0;
        const previousOrders = prevTotalOrders || 0;
        const ordersGrowth = previousOrders > 0 ? Math.round(((currentOrders - previousOrders) / previousOrders) * 100) : (currentOrders > 0 ? 100 : 0);

        const [recentOrders] = await db.query(`
            SELECT o.*, u.name as user_name 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC 
            LIMIT 5
        `);

        // Sales over time
        const [salesHistory] = await db.query(`
            SELECT DATE(created_at) as date, SUM(total_amount) as amount
            FROM orders
            WHERE ${dateCondition}
              AND status != 'cancelled'
            GROUP BY DATE(created_at)
            ORDER BY DATE(created_at) ASC
        `);

        // Sales by category
        const [categorySales] = await db.query(`
            SELECT 
                COALESCE(c.name, 'Uncategorized') as name, 
                SUM(oi.quantity * oi.price_at_purchase) as revenue
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status != 'cancelled' AND ${oDateCondition}
            GROUP BY COALESCE(c.name, 'Uncategorized')
            ORDER BY revenue DESC
        `);

        // Low stock alerts
        const [lowStockAlerts] = await db.query(`
            SELECT id, name, stock_quantity 
            FROM products 
            WHERE stock_quantity <= 5 AND track_inventory = 1 AND is_active = 1
            LIMIT 5
        `);

        // Top products
        const [topProducts] = await db.query(`
            SELECT p.id, p.name, SUM(oi.quantity) as sold_count
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status != 'cancelled' AND ${oDateCondition}
            GROUP BY p.id, p.name
            ORDER BY sold_count DESC
            LIMIT 5
        `);

        // Recent reviews
        const [recentReviews] = await db.query(`
            SELECT r.*, u.name as user_name, p.name as product_name
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            JOIN products p ON r.product_id = p.id
            ORDER BY r.created_at DESC
            LIMIT 5
        `);

        // DB latency
        const dbPingStart = Date.now();
        await db.query('SELECT 1');
        const dbLatencyMs = Date.now() - dbPingStart;

        // SEO Stats calculations
        const [[{ count: missingImages }]] = await db.query('SELECT COUNT(*) as count FROM products p LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1 WHERE pi.id IS NULL');
        const [[{ count: missingDescription }]] = await db.query("SELECT COUNT(*) as count FROM products WHERE description IS NULL OR description = ''");
        const [[{ count: shortTitles }]] = await db.query('SELECT COUNT(*) as count FROM products WHERE CHAR_LENGTH(name) < 30');
        const [[{ count: longTitles }]] = await db.query('SELECT COUNT(*) as count FROM products WHERE CHAR_LENGTH(name) > 60');
        const [[{ count: missingBrand }]] = await db.query('SELECT COUNT(*) as count FROM products WHERE brand_id IS NULL');

        const totalProductsCount = totalProducts || 0;
        const totalPossibleIssues = totalProductsCount * 5;
        const actualIssues = (missingImages || 0) + (missingDescription || 0) + (shortTitles || 0) + (longTitles || 0) + (missingBrand || 0);
        const seoScore = totalProductsCount > 0 ? Math.round(((totalPossibleIssues - actualIssues) / totalPossibleIssues) * 100) : 100;

        const [seoIssues] = await db.query(`
            SELECT p.id, p.name,
                CASE WHEN pi.id IS NULL THEN 1 ELSE 0 END as missing_image,
                CASE WHEN p.description IS NULL OR p.description = '' THEN 1 ELSE 0 END as missing_desc
            FROM products p
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
            WHERE pi.id IS NULL OR p.description IS NULL OR p.description = ''
            LIMIT 200
        `);

        // Users Growth
        const [[userGrowthStats]] = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM users WHERE ${dateCondition}) as current_period,
                (SELECT COUNT(*) FROM users WHERE ${prevDateCondition}) as prev_period
        `);

        const userGrowthPercentage = userGrowthStats.prev_period > 0
            ? Math.round(((userGrowthStats.current_period - userGrowthStats.prev_period) / userGrowthStats.prev_period) * 100)
            : (userGrowthStats.current_period > 0 ? 100 : 0);

        res.json({
            success: true,
            data: {
                totalUsers: userCount,
                userGrowth: userGrowthPercentage,
                totalProducts: totalProductsCount,
                activeProducts: activeProducts || 0,
                totalOrders: totalOrders || 0,
                pendingOrders: pendingOrders || 0,
                processingOrders: processingOrders || 0,
                deliveredOrders: deliveredOrders || 0,
                cancelledOrders: cancelledOrders || 0,
                totalSales: currentSales,
                salesGrowth,
                ordersGrowth,
                recentOrders,
                salesHistory,
                categorySales,
                lowStockAlerts,
                topProducts,
                recentReviews,
                seoStats: {
                    score: seoScore,
                    issues: {
                        missingImages,
                        missingDescription,
                        shortTitles,
                        longTitles,
                        missingBrand
                    }
                },
                seoIssues,
                dbLatencyMs
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all users
// @route   GET /api/v1/admin/users
// @access  Private/Admin|Staff(users)
exports.getAllUsers = async (req, res, next) => {
    try {
        const [users] = await db.query(`
            SELECT u.id, u.name, u.email, u.reward_points, u.created_at, u.role_id, u.staff_permissions, COALESCE(u.status, 'active') as status, COALESCE(r.name, 'user') as role
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
        `);
        res.json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
};

// @desc    Create a new user
// @route   POST /api/v1/admin/users
// @access  Private/Admin|Staff(users)
exports.createUser = async (req, res, next) => {
    try {
        const { name, email, password, role_id, staff_permissions } = req.body;

        if (!name || !email || !password || !role_id) {
            return res.status(400).json({ success: false, message: 'Name, email, password, and role are required' });
        }

        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already in use' });
        }

        const User = require('../models/user.model');
        const userId = await User.createByAdmin({ name, email, password, role_id });

        if (staff_permissions !== undefined) {
            await db.query('UPDATE users SET staff_permissions = ? WHERE id = ?', [
                JSON.stringify(staff_permissions),
                userId
            ]);
        }

        res.status(201).json({ success: true, message: 'User created successfully', data: { id: userId } });
    } catch (error) {
        next(error);
    }
};

// @desc    Update user details (name, email, role, staff_permissions)
// @route   PUT /api/v1/admin/users/:id
// @access  Private/Admin|Staff(users)
exports.updateUser = async (req, res, next) => {
    try {
        const { name, email, role_id, staff_permissions } = req.body;

        const fields = [];
        const values = [];

        if (name) { fields.push('name = ?'); values.push(name); }
        if (email) { fields.push('email = ?'); values.push(email); }
        if (role_id) { fields.push('role_id = ?'); values.push(role_id); }
        if (staff_permissions !== undefined) {
            fields.push('staff_permissions = ?');
            values.push(staff_permissions ? JSON.stringify(staff_permissions) : null);
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(req.params.id);
        await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete user
// @route   DELETE /api/v1/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res, next) => {
    try {
        await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        next(error);
    }
};

// @desc    Adjust user reward points (add or remove)
// @route   POST /api/v1/admin/users/:id/points
// @access  Private/Admin
exports.adjustUserPoints = async (req, res, next) => {
    try {
        const { points, action } = req.body;
        const amount = parseInt(points, 10);

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Points must be a positive number' });
        }
        if (action !== 'add' && action !== 'remove') {
            return res.status(400).json({ success: false, message: 'Action must be "add" or "remove"' });
        }

        const [rows] = await db.query('SELECT reward_points FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const current = Number(rows[0].reward_points) || 0;
        const newBalance = action === 'add' ? current + amount : Math.max(0, current - amount);

        await db.query('UPDATE users SET reward_points = ? WHERE id = ?', [newBalance, req.params.id]);

        // Log the adjustment so it shows in the user's rewards statement.
        // 'remove' uses the real delta (current − newBalance) so a clamp at 0 is reflected. Non-fatal.
        try {
            const delta = action === 'add' ? amount : (current - newBalance);
            if (delta > 0) {
                await db.query(
                    "INSERT INTO reward_points_history (user_id, points, transaction_type, description) VALUES (?, ?, ?, ?)",
                    [req.params.id, delta, action === 'add' ? 'earned' : 'redeemed', action === 'add' ? 'Adjusted by admin (added)' : 'Adjusted by admin (removed)']
                );
            }
        } catch (e) { console.error('[Rewards] admin-adjust history insert failed:', e.message); }

        res.json({
            success: true,
            message: action === 'add' ? `Added ${amount} points` : `Removed ${amount} points`,
            data: { reward_points: newBalance }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Toggle user status (active/suspended)
// @route   PATCH /api/v1/admin/users/:id/status
// @access  Private/Admin
exports.toggleUserStatus = async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT status FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentStatus = rows[0].status || 'active';
        const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

        await db.query('UPDATE users SET status = ? WHERE id = ?', [newStatus, req.params.id]);
        res.json({ success: true, message: `User ${newStatus === 'suspended' ? 'suspended' : 'activated'} successfully`, data: { status: newStatus } });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all orders
// @route   GET /api/v1/admin/orders
// @access  Private/Admin
exports.getAllOrders = async (req, res, next) => {
    try {
        const [orders] = await db.query(`
            SELECT o.*, u.name as user_name, u.email as user_email
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC
        `);
        res.json({ success: true, data: orders });
    } catch (error) {
        next(error);
    }
};
// @desc    Update homepage CMS content (generic)
// @route   PUT /api/v1/admin/cms/homepage
exports.updateHomepageCMS = async (req, res, next) => {
    try {
        const { section, data } = req.body;
        await db.query(`
            INSERT INTO homepage_cms (section_name, content_data) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE content_data = VALUES(content_data)
        `, [section, JSON.stringify(data)]);
        res.json({ success: true, message: `${section} updated successfully` });
    } catch (error) {
        next(error);
    }
};

// One-time, idempotent migration: add mobile hero-image columns to an existing
// hero_slides table (older installs created it without them). Guarded so it runs
// at most once per process and no-ops when the columns already exist.
let heroMobileColsEnsured = false;
const ensureHeroMobileColumns = async () => {
    if (heroMobileColsEnsured) return;
    for (const col of ['image_mobile', 'image_mobile_ar']) {
        try { await db.query(`ALTER TABLE hero_slides ADD COLUMN ${col} TEXT`); }
        catch (e) { /* column already exists — ignore */ }
    }
    heroMobileColsEnsured = true;
};

// @desc    Get all hero slides
// @route   GET /api/v1/admin/cms/hero-slides
exports.getHeroSlides = async (req, res, next) => {
    try {
        await ensureHeroMobileColumns();
        const [slides] = await db.query('SELECT * FROM hero_slides ORDER BY order_index ASC');
        res.json({ success: true, data: slides });
    } catch (error) {
        next(error);
    }
};

// @desc    Add a new hero slide
// @route   POST /api/v1/admin/cms/hero-slides
exports.addHeroSlide = async (req, res, next) => {
    try {
        await ensureHeroMobileColumns();
        const { tagline, tagline_ar, title, title_ar, description, description_ar, image, image_ar, image_mobile, image_mobile_ar, accent, btnText, btnText_ar, link, order_index } = req.body;

        const [result] = await db.query(`
            INSERT INTO hero_slides (tagline, tagline_ar, title, title_ar, description, description_ar, image, image_ar, image_mobile, image_mobile_ar, accent, btnText, btnText_ar, link, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [tagline, tagline_ar, title, title_ar, description, description_ar, image, image_ar || null, image_mobile || null, image_mobile_ar || null, accent || '#ff3b30', btnText || 'Shop Now', btnText_ar, link || '/shopnow', order_index || 0]);

        res.status(201).json({ success: true, message: 'Slide added successfully', data: { id: result.insertId } });
    } catch (error) {
        next(error);
    }
};

// @desc    Update a specific hero slide
// @route   PUT /api/v1/admin/cms/hero-slides/:id
exports.updateHeroSlide = async (req, res, next) => {
    try {
        await ensureHeroMobileColumns();
        const { tagline, tagline_ar, title, title_ar, description, description_ar, image, image_ar, image_mobile, image_mobile_ar, accent, btnText, btnText_ar, link, order_index, is_active } = req.body;

        await db.query(`
            UPDATE hero_slides
            SET tagline = ?, tagline_ar = ?, title = ?, title_ar = ?, description = ?, description_ar = ?, image = ?, image_ar = ?, image_mobile = ?, image_mobile_ar = ?, accent = ?, btnText = ?, btnText_ar = ?, link = ?, order_index = ?, is_active = ?
            WHERE id = ?
        `, [tagline, tagline_ar, title, title_ar, description, description_ar, image, image_ar || null, image_mobile || null, image_mobile_ar || null, accent, btnText, btnText_ar, link, order_index, is_active, req.params.id]);

        res.json({ success: true, message: 'Slide updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete a hero slide
// @route   DELETE /api/v1/admin/cms/hero-slides/:id
exports.deleteHeroSlide = async (req, res, next) => {
    try {
        await db.query('DELETE FROM hero_slides WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Slide deleted successfully' });
    } catch (error) {
        next(error);
    }
};
// @desc    Export all products to CSV
// @route   GET /api/v1/admin/export/products
// @access  Private/Admin
exports.exportProducts = async (req, res, next) => {
    try {
        const [products] = await db.query(`
            SELECT p.id, p.name, p.slug, p.price, p.discount_percentage, p.offer_price, 
                   p.stock_quantity, 
                   c.name as main_category, 
                   sc.name as sub_category, 
                   ssc.name as sub_sub_category,
                   b.name as brand, p.status, p.created_at
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN categories sc ON p.sub_category_id = sc.id
            LEFT JOIN categories ssc ON p.sub_sub_category_id = ssc.id
            LEFT JOIN brands b ON p.brand_id = b.id
            ORDER BY p.id ASC
        `);

        if (!products || products.length === 0) {
            return res.status(200).json({ success: false, message: 'No product data available to export' });
        }

        const { parse } = require('json2csv');
        const csv = parse(products);

        res.header('Content-Type', 'text/csv');
        res.attachment(`best_signature_products_${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);
    } catch (error) {
        console.error('Export Products Error:', error);
        next(error);
    }
};

// @desc    Export all orders to CSV
// @route   GET /api/v1/admin/export/orders
// @access  Private/Admin
exports.exportOrders = async (req, res, next) => {
    try {
        const [orders] = await db.query(`
            SELECT o.id, u.name as customer_name, u.email as customer_email, 
                   o.total_amount, o.vat_amount, o.discount_amount, o.final_amount,
                   o.status, o.payment_status, o.payment_method, o.created_at
            FROM orders o
            JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC
        `);

        if (!orders || orders.length === 0) {
            return res.status(200).json({ success: false, message: 'No order history available to export' });
        }

        const { parse } = require('json2csv');
        const csv = parse(orders);

        res.header('Content-Type', 'text/csv');
        res.attachment(`best_signature_orders_${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);
    } catch (error) {
        console.error('Export Orders Error:', error);
        next(error);
    }
};

// @desc    Get all roles
// @route   GET /api/v1/admin/roles
// @access  Private/Admin
exports.getRoles = async (req, res, next) => {
    try {
        const [roles] = await db.query('SELECT * FROM roles');
        res.json({ success: true, data: roles });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all hero posters
// @route   GET /api/v1/admin/cms/hero-posters
exports.getHeroPosters = async (req, res, next) => {
    try {
        // Auto-create table if missing (Lazy Migration)
        await db.query(`
            CREATE TABLE IF NOT EXISTS hero_posters (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                title_ar VARCHAR(255),
                description TEXT,
                description_ar TEXT,
                badge VARCHAR(100),
                badge_ar VARCHAR(100),
                image TEXT NOT NULL,
                link VARCHAR(255),
                button_text VARCHAR(100) DEFAULT 'SHOP NOW',
                button_text_ar VARCHAR(100),
                order_index INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        const [posters] = await db.query('SELECT * FROM hero_posters ORDER BY order_index ASC');
        res.json({ success: true, data: posters });
    } catch (error) {
        next(error);
    }
};

// @desc    Add a new hero poster
// @route   POST /api/v1/admin/cms/hero-posters
exports.addHeroPoster = async (req, res, next) => {
    try {
        const { title, title_ar, description, description_ar, badge, badge_ar, image, link, button_text, button_text_ar, order_index } = req.body;

        // Ensure table exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS hero_posters (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                title_ar VARCHAR(255),
                description TEXT,
                description_ar TEXT,
                badge VARCHAR(100),
                badge_ar VARCHAR(100),
                image TEXT NOT NULL,
                link VARCHAR(255),
                button_text VARCHAR(100) DEFAULT 'SHOP NOW',
                button_text_ar VARCHAR(100),
                order_index INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        const [result] = await db.query(`
            INSERT INTO hero_posters (title, title_ar, description, description_ar, badge, badge_ar, image, link, button_text, button_text_ar, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [title, title_ar, description, description_ar, badge, badge_ar, image, link, button_text || 'SHOP NOW', button_text_ar, order_index || 0]);

        res.status(201).json({ success: true, message: 'Poster added successfully', data: { id: result.insertId } });
    } catch (error) {
        next(error);
    }
};

// @desc    Update a specific hero poster
// @route   PUT /api/v1/admin/cms/hero-posters/:id
exports.updateHeroPoster = async (req, res, next) => {
    try {
        const { title, title_ar, description, description_ar, badge, badge_ar, image, link, button_text, button_text_ar, order_index, is_active } = req.body;

        await db.query(`
            UPDATE hero_posters 
            SET title = ?, title_ar = ?, description = ?, description_ar = ?, badge = ?, badge_ar = ?, image = ?, link = ?, button_text = ?, button_text_ar = ?, order_index = ?, is_active = ?
            WHERE id = ?
        `, [title, title_ar, description, description_ar, badge, badge_ar, image, link, button_text, button_text_ar, order_index, is_active, req.params.id]);

        res.json({ success: true, message: 'Poster updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete a hero poster
// @route   DELETE /api/v1/admin/cms/hero-posters/:id
exports.deleteHeroPoster = async (req, res, next) => {
    try {
        await db.query('DELETE FROM hero_posters WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Poster deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// ============================================================================
// PROMOTIONS (Banners + Popups)
// Single feature; display_type switches between top banner and modal popup.
// ============================================================================

const ensurePromotionsTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS promotions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            display_type ENUM('banner_top','popup_modal') NOT NULL DEFAULT 'banner_top',
            title VARCHAR(255),
            title_ar VARCHAR(255),
            description TEXT,
            description_ar TEXT,
            image_url TEXT,
            image_url_ar TEXT,
            coupon_code VARCHAR(60),
            cta_text VARCHAR(80),
            cta_text_ar VARCHAR(80),
            cta_link VARCHAR(255),
            bg_color VARCHAR(20) DEFAULT '#ff3b30',
            text_color VARCHAR(20) DEFAULT '#ffffff',
            target_mode ENUM('all','include','exclude') NOT NULL DEFAULT 'all',
            target_pages TEXT,
            popup_trigger ENUM('on_load','delay_seconds','scroll_percent','exit_intent') DEFAULT 'delay_seconds',
            popup_trigger_value INT DEFAULT 5,
            popup_frequency ENUM('every_visit','once_per_session','once_per_days') DEFAULT 'once_per_session',
            popup_frequency_value INT DEFAULT 7,
            start_date DATETIME NULL,
            end_date DATETIME NULL,
            priority INT DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
};

const PROMO_FIELDS = [
    'display_type', 'title', 'title_ar', 'description', 'description_ar', 'image_url', 'image_url_ar',
    'coupon_code', 'cta_text', 'cta_text_ar', 'cta_link', 'bg_color', 'text_color',
    'target_mode', 'target_pages', 'popup_trigger', 'popup_trigger_value',
    'popup_frequency', 'popup_frequency_value', 'start_date', 'end_date',
    'priority', 'is_active'
];

const sanitizePromoBody = (body) => {
    const out = {};
    for (const f of PROMO_FIELDS) {
        if (body[f] !== undefined) out[f] = body[f];
    }
    if (Array.isArray(out.target_pages)) {
        out.target_pages = JSON.stringify(out.target_pages);
    }
    if (out.is_active !== undefined) out.is_active = out.is_active ? 1 : 0;
    if (out.start_date === '') out.start_date = null;
    if (out.end_date === '') out.end_date = null;
    return out;
};

// @route GET /api/v1/admin/cms/promotions
exports.getPromotions = async (req, res, next) => {
    try {
        await ensurePromotionsTable();
        const [rows] = await db.query('SELECT * FROM promotions ORDER BY priority DESC, id DESC');
        res.json({ success: true, data: rows });
    } catch (e) { next(e); }
};

// @route POST /api/v1/admin/cms/promotions
exports.addPromotion = async (req, res, next) => {
    try {
        await ensurePromotionsTable();
        const data = sanitizePromoBody(req.body);
        const cols = Object.keys(data);
        if (cols.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields provided' });
        }
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map(c => data[c]);
        const [result] = await db.query(
            `INSERT INTO promotions (${cols.join(', ')}) VALUES (${placeholders})`,
            values
        );
        res.status(201).json({ success: true, message: 'Promotion created', data: { id: result.insertId } });
    } catch (e) { next(e); }
};

// @route PUT /api/v1/admin/cms/promotions/:id
exports.updatePromotion = async (req, res, next) => {
    try {
        await ensurePromotionsTable();
        const data = sanitizePromoBody(req.body);
        const cols = Object.keys(data);
        if (cols.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields provided' });
        }
        const setClause = cols.map(c => `${c} = ?`).join(', ');
        const values = cols.map(c => data[c]);
        values.push(req.params.id);
        await db.query(`UPDATE promotions SET ${setClause} WHERE id = ?`, values);
        res.json({ success: true, message: 'Promotion updated' });
    } catch (e) { next(e); }
};

// @route DELETE /api/v1/admin/cms/promotions/:id
exports.deletePromotion = async (req, res, next) => {
    try {
        await db.query('DELETE FROM promotions WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Promotion deleted' });
    } catch (e) { next(e); }
};

// @route GET /api/v1/cms/promotions/active?page=<key>
// Public — returns active promotions matching the page key, schedule, and is_active.
exports.getActivePromotions = async (req, res, next) => {
    try {
        await ensurePromotionsTable();
        const pageKey = (req.query.page || '').toString().trim();
        const now = new Date();
        const [rows] = await db.query(`
            SELECT * FROM promotions
            WHERE is_active = 1
              AND (start_date IS NULL OR start_date <= ?)
              AND (end_date IS NULL OR end_date >= ?)
            ORDER BY priority DESC, id DESC
        `, [now, now]);

        const matches = rows.filter(p => {
            if (p.target_mode === 'all' || !p.target_mode) return true;
            let pages = [];
            try {
                pages = p.target_pages ? JSON.parse(p.target_pages) : [];
            } catch (e) { pages = []; }
            const inList = Array.isArray(pages) && pages.includes(pageKey);
            return p.target_mode === 'include' ? inList : !inList;
        });

        // One banner + one popup max — highest priority wins.
        const banner = matches.find(p => p.display_type === 'banner_top') || null;
        const popup = matches.find(p => p.display_type === 'popup_modal') || null;

        res.json({ success: true, data: { banner, popup } });
    } catch (e) { next(e); }
};

// @desc    Send offer notification email to all users for a product
// @route   POST /api/v1/admin/products/:id/notify-offer
// @access  Private/Admin
exports.notifyOfferByEmail = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Fetch product
        const [productRows] = await db.execute(
            `SELECT p.*, (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
             FROM products p WHERE p.id = ?`,
            [id]
        );
        if (!productRows.length) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        const product = productRows[0];

        // Determine offer label
        let offerLabel = 'Special Offer';
        if (product.is_limited_offer) offerLabel = 'Limited Offer';
        else if (product.is_daily_offer) offerLabel = 'Daily Offer';
        else if (product.is_weekly_deal) offerLabel = 'Weekly Deal';
        else if (product.is_featured) offerLabel = 'Featured';
        else if (product.is_best_seller) offerLabel = 'Best Seller';

        // Fetch all users with email — deduplicate by email to avoid sending twice
        const [allUsers] = await db.execute('SELECT id, name, email, preferred_locale FROM users WHERE email IS NOT NULL AND email != ""');
        const seenEmails = new Set();
        const users = allUsers.filter(u => {
            const key = u.email.toLowerCase().trim();
            if (seenEmails.has(key)) return false;
            seenEmails.add(key);
            return true;
        });

        if (!users.length) {
            return res.json({ success: true, sent: 0, message: 'No users to notify' });
        }

        const { sendOfferNotificationEmail } = require('../utils/sendEmail');

        const productData = {
            name: product.name,
            name_ar: product.name_ar,
            slug: product.slug,
            price: product.price,
            offer_price: product.offer_price,
            primaryImage: product.primary_image
        };

        let sent = 0;
        let failed = 0;
        for (const user of users) {
            try {
                await sendOfferNotificationEmail(user.email, user.name || 'Valued Customer', productData, offerLabel, user.preferred_locale || 'en');
                sent++;
            } catch (err) {
                failed++;
                console.error(`[NOTIFY] Failed to send to ${user.email}:`, err.message);
            }
        }

        console.log(`[NOTIFY] Offer email blast: ${sent} sent, ${failed} failed — product #${id} (${offerLabel})`);
        res.json({
            success: true,
            sent,
            failed,
            total: users.length,
            message: sent > 0 ? `Sent to ${sent} users` : (failed > 0 ? `All ${failed} emails failed` : 'No users to notify')
        });
    } catch (e) { next(e); }
};

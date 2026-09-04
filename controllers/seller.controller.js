const db = require('../config/db');
const Product = require('../models/product.model');

// --- Dashboard ---
exports.getSellerDashboardStats = async (req, res) => {
    try {
        const sellerId = req.user.id;

        // 1. Total Products
        const [products] = await db.query('SELECT COUNT(*) as count FROM products WHERE seller_id = ?', [sellerId]);
        const totalProducts = products[0].count;

        // 2. Active Products
        const [activeProductsResult] = await db.query('SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = "active"', [sellerId]);
        const activeProducts = activeProductsResult[0].count;

        // 3. Orders containing seller's products
        const [ordersResult] = await db.query(`
            SELECT DISTINCT o.id, o.status, o.created_at, u.name as customer_name
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            JOIN users u ON o.user_id = u.id
            WHERE p.seller_id = ?
            ORDER BY o.created_at DESC
        `, [sellerId]);

        const totalOrders = ordersResult.length;
        const recentOrders = ordersResult.slice(0, 5);

        // Calculate Revenue for this seller
        // We need to sum up (oi.quantity * oi.price_at_purchase) but ONLY for products belonging to this seller
        const [revenueResult] = await db.query(`
            SELECT SUM(oi.quantity * oi.price_at_purchase) as total_revenue
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE p.seller_id = ? AND o.status != 'cancelled'
        `, [sellerId]);

        const totalRevenue = revenueResult[0].total_revenue || 0;

        // Calculate Revenue per recent order for THIS seller
        for (let order of recentOrders) {
            const [orderRev] = await db.query(`
                SELECT SUM(oi.quantity * oi.price_at_purchase) as seller_amount
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ? AND p.seller_id = ?
            `, [order.id, sellerId]);
            order.seller_amount = orderRev[0].seller_amount || 0;
        }

        // Top selling products for this seller
        const [topProducts] = await db.query(`
            SELECT p.id, p.name, SUM(oi.quantity) as sold_count
            FROM products p
            JOIN order_items oi ON p.id = oi.product_id
            JOIN orders o ON oi.order_id = o.id
            WHERE p.seller_id = ? AND o.status != 'cancelled'
            GROUP BY p.id, p.name
            ORDER BY sold_count DESC
            LIMIT 5
        `, [sellerId]);

        const [lowStockAlerts] = await db.query(`
            SELECT id, name, stock_quantity 
            FROM products 
            WHERE seller_id = ? AND stock_quantity < 10 AND status = "active" AND is_active = 1 AND track_inventory = 1
            ORDER BY stock_quantity ASC
            LIMIT 5
        `, [sellerId]);

        res.json({
            success: true,
            data: {
                totalProducts,
                activeProducts,
                totalOrders,
                totalRevenue,
                recentOrders,
                topProducts,
                lowStockAlerts
            }
        });

    } catch (error) {
        console.error('Error fetching seller stats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics' });
    }
};

// --- Products Management ---

exports.getSellerProducts = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || 'all';

        let query = 'SELECT p.*, c.name as category_name, b.name as brand_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN brands b ON p.brand_id = b.id WHERE p.seller_id = ?';
        let countQuery = 'SELECT COUNT(*) as total FROM products p WHERE p.seller_id = ?';
        let queryParams = [sellerId];
        let countParams = [sellerId];

        if (search) {
            query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            countQuery += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`);
        }

        if (status !== 'all') {
            query += ' AND p.status = ?';
            countQuery += ' AND p.status = ?';
            queryParams.push(status);
            countParams.push(status);
        }

        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        queryParams.push(limit, offset);

        const [products] = await db.query(query, queryParams);
        const [countResult] = await db.query(countQuery, countParams);
        const total = countResult[0].total;

        // Fetch images for products
        for (let product of products) {
            const [images] = await db.query('SELECT image_url FROM product_images WHERE product_id = ?', [product.id]);
            product.images = images.map(img => img.image_url);
            const [mainImage] = await db.query('SELECT image_url FROM product_images WHERE product_id = ? AND is_primary = true LIMIT 1', [product.id]);
            product.main_image = mainImage.length ? mainImage[0].image_url : (images.length ? images[0].image_url : null);
        }

        res.json({
            success: true,
            data: products,
            pagination: {
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error in getSellerProducts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getSellerProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Verify ownership
        if (product.seller_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to view this product' });
        }

        res.json({ success: true, data: product });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.createSellerProduct = async (req, res) => {
    try {
        // Enforce seller ID to be the logged-in user
        req.body.seller_id = req.user.id;

        const productId = await Product.create(req.body);
        res.status(201).json({ success: true, message: 'Product created successfully', data: { id: productId } });
    } catch (error) {
        console.error('Error creating seller product:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.updateSellerProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Verify ownership
        if (product.seller_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this product' });
        }

        // Prevent changing ownership
        if (req.body.seller_id && req.body.seller_id !== req.user.id) {
            delete req.body.seller_id;
        }

        await Product.update(req.params.id, req.body);
        res.json({ success: true, message: 'Product updated successfully' });
    } catch (error) {
        console.error('Error updating seller product:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteSellerProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Verify ownership
        if (product.seller_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this product' });
        }

        await Product.delete(req.params.id);
        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Error deleting seller product:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// --- Order Management ---

exports.getSellerOrders = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Query orders that contain at least one product from this seller
        const query = `
            SELECT DISTINCT o.*, u.name as customer_name, u.email as customer_email
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            JOIN users u ON o.user_id = u.id
            WHERE p.seller_id = ?
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const countQuery = `
            SELECT COUNT(DISTINCT o.id) as total
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            WHERE p.seller_id = ?
        `;

        const [orders] = await db.query(query, [sellerId, limit, offset]);
        const [countResult] = await db.query(countQuery, [sellerId]);
        const total = countResult[0].total;

        // Calculate seller's specific revenue for each order
        for (let order of orders) {
            const [orderRev] = await db.query(`
                SELECT SUM(oi.quantity * oi.price_at_purchase) as seller_amount, COUNT(oi.id) as seller_items_count
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ? AND p.seller_id = ?
            `, [order.id, sellerId]);

            order.seller_amount = orderRev[0].seller_amount || 0;
            order.seller_items_count = orderRev[0].seller_items_count || 0;
        }

        res.json({
            success: true,
            data: orders,
            pagination: {
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching seller orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getSellerOrder = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const orderId = req.params.id;

        // Verify order contains seller's products and get general order info
        const [orderResult] = await db.query(`
            SELECT DISTINCT o.*, u.name as customer_name, u.email as customer_email, u.phone_number as customer_phone
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            JOIN users u ON o.user_id = u.id
            WHERE p.seller_id = ? AND o.id = ?
        `, [sellerId, orderId]);

        if (orderResult.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found or no products in this order belong to you' });
        }

        const order = orderResult[0];

        // Fetch ONLY the items in this order that belong to the seller
        const [items] = await db.query(`
            SELECT oi.*, p.name, p.image_url as main_image, p.sku
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ? AND p.seller_id = ?
        `, [orderId, sellerId]);

        // If main_image is null, try to get from product_images table
        for (let item of items) {
            if (!item.main_image) {
                const [img] = await db.query('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY is_primary DESC LIMIT 1', [item.product_id]);
                if (img.length > 0) item.main_image = img[0].image_url;
            }
        }

        order.items = items;

        // Calculate seller's total for THIS order
        order.seller_total = items.reduce((sum, item) => sum + (item.quantity * item.price_at_purchase), 0);

        // Fetch shipping tracking info if it exists
        const [tracking] = await db.query('SELECT * FROM order_tracking WHERE order_id = ? ORDER BY created_at DESC', [orderId]);
        order.tracking = tracking;

        res.json({ success: true, data: order });
    } catch (error) {
        console.error('Error fetching seller order:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

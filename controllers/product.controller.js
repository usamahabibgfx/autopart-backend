const Product = require('../models/product.model');
const Category = require('../models/category.model');
const Brand = require('../models/brand.model');
const db = require('../config/db'); // Fix: Import db
const generateUniqueSlug = require('../utils/generateSlug');
const ExcelJS = require('exceljs');
const fs = require('fs');
const stringSimilarity = require('string-similarity');

const POPULAR_KEYWORDS = [
    'coffee', 'engine part', 'juicer', 'blender', 'oven', 'refrigerator', 'chiller', 'mixer',
    'ice', 'ice maker', 'equipment', 'dispenser', 'maker', 'grinder', 'freezer', 'warmer',
    'display chiller', 'kitchen', 'supermarket', 'laundry', 'stainless steel', 'sink', 'popcorn',
    'fryer', 'grill', 'toaster', 'waffle', 'kettle', 'meat', 'slicer', 'dishwasher', 'range'
];


exports.bulkImport = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload an excel file' });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const worksheet = workbook.worksheets[0];

        // Convert ExcelJS rows to array of objects using header row
        const headers = [];
        const rows = [];
        worksheet.eachRow((row, rowNumber) => {
            const values = row.values; // ExcelJS row.values is 1-indexed (index 0 is empty)
            if (rowNumber === 1) {
                // First row = headers
                for (let i = 1; i < values.length; i++) {
                    headers.push(String(values[i] || '').trim());
                }
            } else {
                const obj = {};
                for (let i = 0; i < headers.length; i++) {
                    obj[headers[i]] = values[i + 1] !== undefined ? values[i + 1] : null;
                }
                rows.push(obj);
            }
        });

        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        // Cache for category/brand IDs
        const categoryMap = {}; // Main Category Map
        const subCategoryMap = {}; // Sub Category Map (keyed by parentId:name)
        const subSubCategoryMap = {}; // Sub-Sub Category Map (keyed by parentId:name)
        const brandMap = {};

        // 1. Pre-resolve all categories and brands sequentially to avoid race conditions
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            // Resolve Main Category
            let mainId = null;
            const mainName = (row.category || row.Category || row.main_category)?.toString().trim();
            if (mainName) {
                if (!categoryMap[mainName]) {
                    let cat = await Category.findBySlug(await generateUniqueSlug(mainName, 'categories')); // Check if exists
                    if (!cat) {
                        const slug = await generateUniqueSlug(mainName, 'categories');
                        mainId = await Category.create({ name: mainName, slug: slug, type: 'main_category' });
                    } else {
                        mainId = cat.id;
                    }
                    categoryMap[mainName] = mainId;
                } else {
                    mainId = categoryMap[mainName];
                }
            }

            // Resolve Sub Category
            let subId = null;
            const subName = (row.sub_category || row['sub category'] || row.product_group || row.Group)?.toString().trim();
            if (subName && mainId) {
                const mapKey = `${mainId}:${subName}`;
                if (!subCategoryMap[mapKey]) {
                    // Search for existing sub category under this parent
                    let [existing] = await db.query('SELECT id FROM categories WHERE name = ? AND parent_id = ? AND type = "sub_category"', [subName, mainId]);
                    if (existing.length === 0) {
                        const slug = await generateUniqueSlug(subName, 'categories');
                        subId = await Category.create({ name: subName, slug: slug, type: 'sub_category', parent_id: mainId });
                    } else {
                        subId = existing[0].id;
                    }
                    subCategoryMap[mapKey] = subId;
                } else {
                    subId = subCategoryMap[mapKey];
                }
            }

            // Resolve Sub-Sub Category
            let subSubId = null;
            const subSubName = (row.sub_sub_category || row['sub sub category'] || row.final_sub_category)?.toString().trim();
            if (subSubName && subId) {
                const mapKey = `${subId}:${subSubName}`;
                if (!subSubCategoryMap[mapKey]) {
                    let [existing] = await db.query('SELECT id FROM categories WHERE name = ? AND parent_id = ? AND type = "sub_sub_category"', [subSubName, subId]);
                    if (existing.length === 0) {
                        const slug = await generateUniqueSlug(subSubName, 'categories');
                        subSubId = await Category.create({ name: subSubName, slug: slug, type: 'sub_sub_category', parent_id: subId });
                    } else {
                        subSubId = existing[0].id;
                    }
                    subSubCategoryMap[mapKey] = subSubId;
                } else {
                    subSubId = subSubCategoryMap[mapKey];
                }
            }

            if (row.brand) {
                const brandName = row.brand.trim();
                if (!brandMap[brandName]) {
                    let brand = await Brand.findBySlug(await generateUniqueSlug(brandName, 'brands')); // Potential fix: check by generated slug
                    if (!brand) {
                        const slug = await generateUniqueSlug(brandName, 'brands');
                        const newId = await Brand.create({ name: brandName, slug: slug });
                        brandMap[brandName] = newId;
                    } else {
                        brandMap[brandName] = brand.id;
                    }
                }
            }
        }

        // 2. Process products in chunks concurrently
        const CHUNK_SIZE = 10;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);

            await Promise.all(chunk.map(async (row, index) => {
                const rowIndex = i + index;
                try {
                    // Basic validation
                    if (!row.name || !row.price) {
                        throw new Error(`Row ${rowIndex + 2}: Missing mandatory fields (name or price)`);
                    }

                    const mainName = (row.category || row.Category || row.main_category)?.toString().trim();
                    const subName = (row.sub_category || row['sub category'] || row.product_group || row.Group)?.toString().trim();
                    const subSubName = (row.sub_sub_category || row['sub sub category'] || row.final_sub_category)?.toString().trim();

                    const categoryId = mainName ? categoryMap[mainName] : null;
                    const subCategoryId = (categoryId && subName) ? subCategoryMap[`${categoryId}:${subName}`] : null;
                    const subSubCategoryId = (subCategoryId && subSubName) ? subSubCategoryMap[`${subCategoryId}:${subSubName}`] : null;

                    const brandId = row.brand ? brandMap[row.brand.trim()] : null;

                    // Process images if comma separated
                    let images = [];
                    if (row.images) {
                        if (typeof row.images === 'string') {
                            images = row.images.split(',').map(img => img.trim());
                        } else {
                            images = [String(row.images)];
                        }
                    }

                    // Prepare product data
                    const productData = {
                        name: row.name,
                        name_ar: row.name_ar,
                        description: row.description,
                        description_ar: row.description_ar,
                        short_description: row.short_description || row['short description'],
                        short_description_ar: row.short_description_ar || row['short description ar'],
                        specifications: row.specifications,
                        price: row.price,
                        discount_percentage: row.discount_percentage || 0,
                        stock_quantity: row.stock_quantity || 0,
                        category_id: categoryId,
                        sub_category_id: subCategoryId,
                        sub_sub_category_id: subSubCategoryId,
                        brand_id: brandId,
                        is_featured: row.is_featured === 1 || row.is_featured === true || String(row.is_featured).toLowerCase() === 'yes',
                        is_weekly_deal: row.is_weekly_deal === 1 || row.is_weekly_deal === true || String(row.is_weekly_deal).toLowerCase() === 'yes',
                        is_limited_offer: row.is_limited_offer === 1 || row.is_limited_offer === true || String(row.is_limited_offer).toLowerCase() === 'yes',
                        is_daily_offer: row.is_daily_offer === 1 || row.is_daily_offer === true || String(row.is_daily_offer).toLowerCase() === 'yes',
                        offer_start: row.offer_start || null,
                        offer_end: row.offer_end || null,
                        status: row.status || 'active',
                        product_group: subName || null,
                        sub_category: subSubName || null,
                        model: row.model,
                        youtube_video_link: row.youtube_video_link ? (String(row.youtube_video_link).startsWith('{') ? row.youtube_video_link : JSON.stringify({ links: [row.youtube_video_link], featuredIndex: 0 })) : null,
                        resources: row.resources ? (String(row.resources).startsWith('[') ? row.resources : JSON.stringify(String(row.resources).split(',').map(r => {
                            const parts = r.split(':');
                            return { name: parts.length > 1 ? parts[0].trim() : 'Download', url: (parts.length > 1 ? parts[1] : parts[0]).trim() };
                        }))) : null,
                        images: images
                    };

                    await Product.create(productData);
                    results.success++;
                } catch (error) {
                    results.failed++;
                    results.errors.push(`Row ${rowIndex + 2}: ${error.message}`);
                    console.error(`Import Error Row ${rowIndex + 2}:`, error);
                }
            }));
        }

        // Cleanup
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
    }
};

exports.getProductStats = async (req, res) => {
    try {
        const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM products');
        const [[{ active }]] = await db.query("SELECT COUNT(*) as active FROM products WHERE (status = 'active' OR status IS NULL) AND is_active = 1");
        const [[{ oos }]] = await db.query("SELECT COUNT(*) as oos FROM products WHERE stock_quantity <= 0 AND track_inventory = 1");
        const [[{ categories }]] = await db.query("SELECT COUNT(*) as categories FROM categories WHERE (type = 'main_category' OR parent_id IS NULL)");
        res.json({ success: true, data: { total, active, outOfStock: oos, categories } });
    } catch (error) {
        console.error('GET PRODUCT STATS ERROR:', error);
        res.status(500).json({ success: false, message: 'Failed to get stats' });
    }
};

exports.getProducts = async (req, res, next) => {
    try {
        console.log('GET PRODUCTS QUERY:', JSON.stringify(req.query));
        const { category, brand, seller, minPrice, maxPrice, search, sort, page = 1, limit = 12, is_weekly_deal, is_limited_offer, is_featured, is_daily_offer, status, stockStatus } = req.query;
        const offset = (page - 1) * limit;

        const { products, total } = await Product.findAll({
            category, brand, seller, minPrice, maxPrice, search, sort, limit, offset, is_weekly_deal, is_limited_offer, is_featured, is_daily_offer, status, stockStatus
        });

        let didYouMean = null;
        if (products.length === 0 && search && search.trim().length > 3) {
            try {
                const [cats] = await db.query('SELECT name FROM categories WHERE is_active = 1');
                const [brs] = await db.query('SELECT name FROM brands');
                const dict = new Set(POPULAR_KEYWORDS);
                cats.forEach(c => c.name && c.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).forEach(w => w.length > 3 && dict.add(w)));
                brs.forEach(b => b.name && b.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).forEach(w => w.length > 3 && dict.add(w)));

                const matches = stringSimilarity.findBestMatch(search.trim().toLowerCase(), Array.from(dict));
                if (matches.bestMatch.rating >= 0.5) {
                    didYouMean = matches.bestMatch.target;
                }
            } catch (err) {
                const matches = stringSimilarity.findBestMatch(search.trim().toLowerCase(), POPULAR_KEYWORDS);
                if (matches.bestMatch.rating >= 0.5) didYouMean = matches.bestMatch.target;
            }
        }

        res.json({
            success: true,
            count: products.length,
            total,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            },
            data: products,
            didYouMean: didYouMean
        });

    } catch (error) {
        console.error('GET PRODUCTS ERROR:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error fetching products',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
};

exports.getProduct = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.json({ success: true, data: product });
    } catch (error) {
        next(error);
    }
};

exports.createProduct = async (req, res, next) => {
    try {
        console.log('CREATE PRODUCT BODY:', JSON.stringify(req.body));
        const id = await Product.create(req.body);
        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: { id, ...req.body }
        });
    } catch (error) {
        next(error);
    }
};

exports.updateProduct = async (req, res, next) => {
    try {
        const stockService = require('../services/stockNotifications.service');

        // Snapshot product + variants BEFORE the update so we can detect
        // 0 -> >0 stock transitions per variant (or product-level when no variants).
        let prevProduct = null;
        const prevVariantStockByLabel = {};
        let prevProductOOS = false;
        try {
            prevProduct = await Product.findById(req.params.id);
            if (prevProduct) {
                const tracking = Number(prevProduct.track_inventory) === 1;
                const prevQty = Number(prevProduct.stock_quantity || 0);
                prevProductOOS = tracking && prevQty <= 0;

                if (Number(prevProduct.has_variants) === 1 && Array.isArray(prevProduct.variants)) {
                    for (const v of prevProduct.variants) {
                        const label = stockService.buildVariantLabel(v, prevProduct.options);
                        prevVariantStockByLabel[label] = Number(v.stock_quantity || 0);
                    }
                }
            }
        } catch (e) {
            console.error('[notify] Could not read previous product state:', e.message);
        }

        await Product.update(req.params.id, req.body);

        // Re-read product + variants and dispatch for any transitions.
        // Fire-and-forget so the admin response is never blocked on email I/O.
        (async () => {
            try {
                const fresh = await Product.findById(req.params.id);
                if (!fresh) return;

                // findById doesn't compute primary_image directly — derive it from
                // the loaded images array (prefer is_primary=1, else first image).
                const primaryImage = (() => {
                    if (fresh.primary_image) return fresh.primary_image;
                    if (Array.isArray(fresh.images) && fresh.images.length > 0) {
                        const flagged = fresh.images.find(i => Number(i.is_primary) === 1);
                        return (flagged || fresh.images[0])?.image_url || '';
                    }
                    return '';
                })();

                // Variant-level transitions
                if (Number(fresh.has_variants) === 1 && Array.isArray(fresh.variants)) {
                    for (const v of fresh.variants) {
                        const label = stockService.buildVariantLabel(v, fresh.options);
                        if (!label) continue;
                        const prev = prevVariantStockByLabel[label] ?? 0;
                        const now = Number(v.stock_quantity || 0);
                        if (prev <= 0 && now > 0) {
                            const sent = await stockService.dispatchForVariant({
                                productId: fresh.id,
                                variantLabel: label,
                                productName: fresh.name,
                                productSlug: fresh.slug,
                                productImage: (!Number(v.use_primary_image) && v.image_url) ? v.image_url : primaryImage,
                                price: v.offer_price && Number(v.offer_price) > 0 ? v.offer_price : v.price
                            });
                            if (sent > 0) console.log(`[notify] Sent ${sent} restock emails for product ${fresh.id} / "${label}"`);
                        }
                    }
                }

                // Whole-product transition (covers non-variant products and people
                // who subscribed to the product without picking a variant).
                if (prevProductOOS) {
                    const newQty = Number(fresh.stock_quantity || 0);
                    const tracking = Number(fresh.track_inventory) === 1;
                    if (!tracking || newQty > 0) {
                        const sent = await stockService.dispatchForVariant({
                            productId: fresh.id,
                            variantLabel: '',
                            productName: fresh.name,
                            productSlug: fresh.slug,
                            productImage: primaryImage,
                            price: fresh.offer_price && Number(fresh.offer_price) > 0 ? fresh.offer_price : fresh.price
                        });
                        if (sent > 0) console.log(`[notify] Sent ${sent} restock emails for product ${fresh.id} (whole product)`);
                    }
                }
            } catch (err) {
                console.error('[notify] Dispatch failed:', err.message);
            }
        })();

        res.json({ success: true, message: 'Product updated' });
    } catch (error) {
        next(error);
    }
};

// @desc    Subscribe an email to a product's back-in-stock notification
// @route   POST /api/v1/products/:id/notify-me
// @access  Public
exports.subscribeStockNotification = async (req, res, next) => {
    try {
        const productId = parseInt(req.params.id);
        if (!productId) {
            return res.status(400).json({ success: false, message: 'Invalid product id' });
        }
        const email = (req.body?.email || '').toString();
        const variantLabel = (req.body?.variantLabel || '').toString();
        const userId = req.user?.id || null;

        const stockService = require('../services/stockNotifications.service');
        await stockService.subscribe({ productId, email, userId, variantLabel });

        res.json({
            success: true,
            message: "You're on the list — we'll email you the moment it's back in stock."
        });
    } catch (error) {
        if (error?.statusCode === 400) {
            return res.status(400).json({ success: false, message: error.message });
        }
        next(error);
    }
};

exports.deleteProduct = async (req, res, next) => {
    try {
        await Product.delete(req.params.id);
        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        next(error);
    }
};

exports.bulkUpdateProducts = async (req, res, next) => {
    try {
        const { ids, data } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'Invalid IDs' });
        }
        await Product.bulkUpdate(ids, data);
        res.json({ success: true, message: `Successfully updated ${ids.length} products` });
    } catch (error) {
        next(error);
    }
};

exports.deleteProducts = async (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'Invalid IDs' });
        }
        await Product.bulkDelete(ids);
        res.json({ success: true, message: `Successfully deleted ${ids.length} products` });
    } catch (error) {
        next(error);
    }
};

// Ensures the trending_products table exists. Lazy migration like cms.controller.
let trendingTableEnsured = false;
const ensureTrendingProductsTable = async () => {
    if (trendingTableEnsured) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS trending_products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_id INT NOT NULL,
            position INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product (product_id),
            INDEX idx_position (position),
            CONSTRAINT fk_trending_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);
    trendingTableEnsured = true;
};

const fetchTrendingProductsData = async (limit = 8) => {
    await ensureTrendingProductsTable();
    const safeLimit = Math.max(1, Math.min(parseInt(limit) || 8, 20));
    const [rows] = await db.query(`
        SELECT p.id, p.name, p.name_ar, p.slug, p.price, p.offer_price, p.discount_percentage,
               p.stock_quantity, p.track_inventory,
               (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image,
               c.id as category_id, c.name as category_name, c.name_ar as category_name_ar, c.slug as category_slug,
               sc.id as sub_category_id, sc.name as sub_category_name, sc.name_ar as sub_category_name_ar, sc.slug as sub_category_slug,
               b.id as brand_id, b.name as brand_name, b.name_ar as brand_name_ar, b.slug as brand_slug, b.image_url as brand_image,
               tp.position
        FROM trending_products tp
        JOIN products p ON p.id = tp.product_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories sc ON p.sub_category_id = sc.id
        LEFT JOIN brands b ON p.brand_id = b.id
        WHERE p.is_active = 1 AND (p.status = 'active' OR p.status IS NULL)
        ORDER BY tp.position ASC, tp.id ASC
        LIMIT ${safeLimit}
    `);
    return rows;
};

// Build the empty-query left side: derives products-suggestions / sub-categories /
// brands from the admin-curated trending list, so clicking the search bar shows
// content related to what the admin promoted.
const deriveRelatedFromTrending = (trending) => {
    const products = trending.slice(0, 5).map(p => ({
        id: p.id,
        name: p.name,
        name_ar: p.name_ar,
        slug: p.slug,
        model: p.model || null,
        price: p.price,
        offer_price: p.offer_price,
        primary_image: p.primary_image,
        category_name: p.category_name
    }));

    const seenCats = new Set();
    const categories = [];
    for (const p of trending) {
        // Prefer sub-category; fall back to main category
        const id = p.sub_category_id || p.category_id;
        const name = p.sub_category_name || p.category_name;
        const name_ar = p.sub_category_id ? p.sub_category_name_ar : p.category_name_ar;
        const slug = p.sub_category_slug || p.category_slug;
        if (id && name && !seenCats.has(id)) {
            seenCats.add(id);
            categories.push({ id, name, name_ar, slug });
            if (categories.length >= 5) break;
        }
    }

    const seenBrands = new Set();
    const brands = [];
    for (const p of trending) {
        if (p.brand_id && p.brand_name && !seenBrands.has(p.brand_id)) {
            seenBrands.add(p.brand_id);
            brands.push({
                id: p.brand_id,
                name: p.brand_name,
                name_ar: p.brand_name_ar,
                slug: p.brand_slug,
                image_url: p.brand_image
            });
            if (brands.length >= 5) break;
        }
    }

    return { products, categories, brands };
};

/**
 * @desc    Public search-dropdown endpoint. Returns dynamic suggestions for products,
 *          categories, brands when `q` is provided, plus admin-curated trending products
 *          (always returned regardless of `q`).
 * @route   GET /api/v1/products/search-dropdown?q=<term>
 * @access  Public
 */
exports.getSearchDropdown = async (req, res, next) => {
    try {
        const q = (req.query.q || '').trim();
        const trending = await fetchTrendingProductsData(8);

        if (q.length < 2) {
            // Empty/short query: derive the left side from the admin's trending picks
            // so the dropdown is still useful on first click.
            const related = deriveRelatedFromTrending(trending);
            return res.json({
                success: true,
                data: { ...related, trending }
            });
        }

        // Dynamic product search (top 5)
        const { products: prodRows } = await Product.findAll({
            search: q,
            limit: 5,
            status: 'active',
            stockStatus: 'in_stock'
        });
        const products = prodRows.map(p => ({
            id: p.id,
            name: p.name,
            name_ar: p.name_ar,
            slug: p.slug,
            model: p.model,
            price: p.price,
            offer_price: p.offer_price,
            primary_image: p.primary_image,
            category_name: p.category_name,
            stock_quantity: p.stock_quantity,
            track_inventory: p.track_inventory
        }));

        // Singular fallback (matches existing getSuggestions behavior)
        let qSingular = q;
        if (q.length > 3 && q.endsWith('s')) {
            qSingular = q.endsWith('ies') ? q.slice(0, -3) + 'y' : q.slice(0, -1);
        }

        const likePatterns = [
            `${q}%`, `% ${q}%`, `${qSingular}%`, `% ${qSingular}%`,
            `${q}%`, `% ${q}%`, `${qSingular}%`, `% ${qSingular}%`
        ];

        const [categories] = await db.query(
            'SELECT id, name, name_ar, slug FROM categories WHERE is_active = 1 AND ((name LIKE ? OR name LIKE ? OR name LIKE ? OR name LIKE ?) OR (slug LIKE ? OR slug LIKE ? OR slug LIKE ? OR slug LIKE ?)) LIMIT 5',
            likePatterns
        );

        // Brands: match either by the brand's own name OR by any of its products
        // matching the query (so "coffee" surfaces brands that sell coffee gear
        // even when the brand name itself doesn't contain "coffee").
        const productMatchPatterns = [`${q}%`, `% ${q}%`, `${qSingular}%`, `% ${qSingular}%`];
        const [brands] = await db.query(
            `SELECT DISTINCT b.id, b.name, b.name_ar, b.slug, b.image_url
             FROM brands b
             WHERE (b.name LIKE ? OR b.name LIKE ? OR b.name LIKE ? OR b.name LIKE ?
                    OR b.slug LIKE ? OR b.slug LIKE ? OR b.slug LIKE ? OR b.slug LIKE ?)
                OR b.id IN (
                    SELECT p.brand_id FROM products p
                    LEFT JOIN categories c ON c.id = p.category_id
                    WHERE p.is_active = 1
                      AND p.brand_id IS NOT NULL
                      AND (p.status = 'active' OR p.status IS NULL)
                      AND (
                            p.name LIKE ? OR p.name LIKE ? OR p.name LIKE ? OR p.name LIKE ?
                         OR c.name LIKE ? OR c.name LIKE ? OR c.name LIKE ? OR c.name LIKE ?
                         OR p.product_group LIKE ? OR p.product_group LIKE ? OR p.product_group LIKE ? OR p.product_group LIKE ?
                      )
                )
             LIMIT 5`,
            [
                ...likePatterns,
                ...productMatchPatterns,
                ...productMatchPatterns,
                ...productMatchPatterns
            ]
        );

        res.json({
            success: true,
            data: { products, categories, brands, trending }
        });
    } catch (error) {
        console.error('GET SEARCH DROPDOWN ERROR:', error);
        res.status(500).json({ success: false, message: 'Error fetching search dropdown' });
    }
};

/**
 * @desc    Admin: list current trending products in order
 * @route   GET /api/v1/admin/trending-products
 * @access  Private/Admin
 */
exports.adminGetTrendingProducts = async (req, res, next) => {
    try {
        const data = await fetchTrendingProductsData(50);
        res.json({ success: true, data });
    } catch (error) {
        console.error('ADMIN GET TRENDING ERROR:', error);
        next(error);
    }
};

/**
 * @desc    Admin: replace the trending-products list
 *          Body: { items: [{ product_id, position }, ...] }
 * @route   PUT /api/v1/admin/trending-products
 * @access  Private/Admin
 */
exports.adminSetTrendingProducts = async (req, res, next) => {
    try {
        await ensureTrendingProductsTable();
        const items = Array.isArray(req.body?.items) ? req.body.items : [];

        const cleaned = items
            .map((it, idx) => ({
                product_id: parseInt(it.product_id, 10),
                position: Number.isFinite(parseInt(it.position, 10)) ? parseInt(it.position, 10) : idx
            }))
            .filter(it => Number.isFinite(it.product_id) && it.product_id > 0);

        // De-duplicate by product_id, keeping the first occurrence's position
        const seen = new Set();
        const unique = [];
        for (const it of cleaned) {
            if (seen.has(it.product_id)) continue;
            seen.add(it.product_id);
            unique.push(it);
        }

        await db.query('DELETE FROM trending_products');
        if (unique.length > 0) {
            const placeholders = unique.map(() => '(?, ?)').join(', ');
            const params = unique.flatMap(it => [it.product_id, it.position]);
            await db.query(
                `INSERT INTO trending_products (product_id, position) VALUES ${placeholders}`,
                params
            );
        }

        const data = await fetchTrendingProductsData(50);
        res.json({ success: true, data });
    } catch (error) {
        console.error('ADMIN SET TRENDING ERROR:', error);
        next(error);
    }
};

exports.getSuggestions = async (req, res, next) => {
    try {
        const { search } = req.query;
        if (!search || search.trim().length < 2) {
            return res.json({ success: true, data: [] });
        }

        // Fetch matching products with limited fields for performance
        const { products } = await Product.findAll({
            search: search.trim(),
            limit: 8,
            status: 'active',
            stockStatus: 'in_stock'
        });

        const suggestions = products.map(p => ({
            id: p.id,
            name: p.name,
            model: p.model,
            slug: p.slug,
            price: p.price,
            offer_price: p.offer_price,
            primary_image: p.primary_image,
            category_name: p.category_name,
            type: 'product'
        }));

        let searchRaw = search.trim();
        let searchSingular = searchRaw;
        if (searchRaw.length > 3 && searchRaw.endsWith('s')) {
            searchSingular = searchRaw.slice(0, -1);
            if (searchRaw.endsWith('ies')) searchSingular = searchRaw.slice(0, -3) + 'y';
        }

        // Fetch matching categories
        const [categories] = await db.query(
            'SELECT id, name, slug FROM categories WHERE (name LIKE ? OR name LIKE ? OR name LIKE ? OR name LIKE ?) OR (slug LIKE ? OR slug LIKE ? OR slug LIKE ? OR slug LIKE ?) LIMIT 3',
            [
                `${searchRaw}%`, `% ${searchRaw}%`, `${searchSingular}%`, `% ${searchSingular}%`,
                `${searchRaw}%`, `% ${searchRaw}%`, `${searchSingular}%`, `% ${searchSingular}%`
            ]
        );

        categories.forEach(c => {
            suggestions.push({
                id: c.id,
                name: c.name,
                slug: c.slug,
                type: 'category'
            });
        });

        // Fetch matching brands
        const [brands] = await db.query(
            'SELECT id, name, slug, image_url FROM brands WHERE (name LIKE ? OR name LIKE ? OR name LIKE ? OR name LIKE ?) OR (slug LIKE ? OR slug LIKE ? OR slug LIKE ? OR slug LIKE ?) LIMIT 3',
            [
                `${searchRaw}%`, `% ${searchRaw}%`, `${searchSingular}%`, `% ${searchSingular}%`,
                `${searchRaw}%`, `% ${searchRaw}%`, `${searchSingular}%`, `% ${searchSingular}%`
            ]
        );

        brands.forEach(b => {
            suggestions.push({
                id: b.id,
                name: b.name,
                slug: b.slug,
                primary_image: b.image_url,
                type: 'brand'
            });
        });

        let didYouMean = null;
        if (suggestions.length === 0 && searchRaw.length > 3) {
            try {
                const [cats] = await db.query('SELECT name FROM categories WHERE is_active = 1');
                const [brs] = await db.query('SELECT name FROM brands');
                const dict = new Set(POPULAR_KEYWORDS);
                cats.forEach(c => c.name && c.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).forEach(w => w.length > 3 && dict.add(w)));
                brs.forEach(b => b.name && b.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).forEach(w => w.length > 3 && dict.add(w)));

                const matches = stringSimilarity.findBestMatch(searchRaw.toLowerCase(), Array.from(dict));
                if (matches.bestMatch.rating >= 0.5) {
                    didYouMean = matches.bestMatch.target;
                }
            } catch (err) {
                const matches = stringSimilarity.findBestMatch(searchRaw.toLowerCase(), POPULAR_KEYWORDS);
                if (matches.bestMatch.rating >= 0.5) didYouMean = matches.bestMatch.target;
            }
        }

        res.json({
            success: true,
            data: suggestions,
            didYouMean: didYouMean
        });

    } catch (error) {
        console.error('GET SUGGESTIONS ERROR:', error);
        res.status(500).json({ success: false, message: 'Error fetching suggestions' });
    }
};


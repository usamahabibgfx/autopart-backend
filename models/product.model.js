const db = require('../config/db');
const slugify = require('slugify');
const ProductVariant = require('./productVariant.model');
const ProductSizeTier = require('./productSizeTier.model');

let freeGiftColEnsured = false;
async function ensureFreeGiftColumn() {
    if (freeGiftColEnsured) return;
    const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
           AND COLUMN_NAME = 'free_gift_product_ids'`
    );
    if (cols.length === 0) {
        await db.query(`ALTER TABLE products ADD COLUMN free_gift_product_ids TEXT NULL`);
    }
    freeGiftColEnsured = true;
}

let compareConfigColEnsured = false;
async function ensureCompareConfigColumn() {
    if (compareConfigColEnsured) return;
    const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
           AND COLUMN_NAME = 'compare_config'`
    );
    if (cols.length === 0) {
        await db.query(`ALTER TABLE products ADD COLUMN compare_config TEXT NULL`);
    }
    compareConfigColEnsured = true;
}

let specificationsArColEnsured = false;
async function ensureSpecificationsArColumn() {
    if (specificationsArColEnsured) return;
    const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
           AND COLUMN_NAME = 'specifications_ar'`
    );
    if (cols.length === 0) {
        await db.query(`ALTER TABLE products ADD COLUMN specifications_ar TEXT NULL`);
    }
    specificationsArColEnsured = true;
}

class Product {
    static async findAll({ category, brand, seller, minPrice, maxPrice, search, sort, limit, offset, is_weekly_deal, is_limited_offer, is_featured, is_daily_offer, is_best_seller, status, stockStatus }) {
        let query = `
            SELECT p.*,
            c.name as category_name, c.name_ar as category_name_ar, c.slug as category_slug,
            sc.name as sub_category_name, sc.name_ar as sub_category_name_ar, sc.slug as sub_category_slug,
            ssc.name as sub_sub_category_name, ssc.name_ar as sub_sub_category_name_ar, ssc.slug as sub_sub_category_slug,
            b.name as brand_name, b.name_ar as brand_name_ar, b.slug as brand_slug, b.image_url as brand_image,
            s.name as seller_name, s.company_name as seller_company, s.id as seller_id,
            (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image,
            COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = p.id), 0) as average_rating,
            (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as total_reviews,
            COALESCE((SELECT SUM(quantity) FROM order_items WHERE product_id = p.id), 0) as sold_count,
            (SELECT MIN(pv_min.price) FROM product_variants pv_min WHERE pv_min.product_id = p.id AND pv_min.is_active = 1 AND pv_min.price > 0) as min_variant_price
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN categories sc ON p.sub_category_id = sc.id
            LEFT JOIN categories ssc ON p.sub_sub_category_id = ssc.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN users s ON p.seller_id = s.id
        `;

        const whereClauses = [];
        const params = [];

        // Handle Status (Active/Draft)
        if (status === 'all') {
            // Admin: no mandatory is_active filter
        } else if (status) {
            whereClauses.push('p.status = ?');
            params.push(status);
            whereClauses.push('p.is_active = 1');
        } else {
            // Public: only active/null status AND is_active = 1
            whereClauses.push("(p.status = 'active' OR p.status IS NULL)");
            whereClauses.push('p.is_active = 1');
        }

        if (stockStatus === 'in_stock') {
            whereClauses.push('(p.stock_quantity > 0 OR p.track_inventory = 0)');
        } else if (stockStatus === 'out_of_stock') {
            whereClauses.push('(p.stock_quantity <= 0 AND p.track_inventory = 1)');
        }

        const isTrue = (val) => val === 'true' || val === 1 || val === '1' || val === true;

        if (is_weekly_deal !== undefined && isTrue(is_weekly_deal)) {
            whereClauses.push('p.is_weekly_deal = 1');
            whereClauses.push('p.is_limited_offer = 0');
            // A null offer_end means "no expiry" (active), matching the admin tag logic.
            whereClauses.push('(p.offer_end IS NULL OR p.offer_end > NOW())');
        }
        if (is_limited_offer !== undefined && isTrue(is_limited_offer)) {
            whereClauses.push('p.is_limited_offer = 1');
            whereClauses.push('p.is_weekly_deal = 0');
            whereClauses.push('(p.offer_end IS NULL OR p.offer_end > NOW())');
        }
        if (is_featured !== undefined && isTrue(is_featured)) {
            whereClauses.push('p.is_featured = 1');
        }
        if (is_daily_offer !== undefined && isTrue(is_daily_offer)) {
            whereClauses.push('p.is_daily_offer = 1');
            whereClauses.push('(p.offer_end IS NULL OR p.offer_end > NOW())');
        }
        if (is_best_seller !== undefined && isTrue(is_best_seller)) {
            whereClauses.push('p.is_best_seller = 1');
        }

        if (category) {
            if (category === 'uncategorised') {
                whereClauses.push('(p.category_id IS NULL OR p.category_id = 0)');
            } else {
                // Collect the matched category ID and all its descendants
                const [catRows] = await db.execute(
                    'SELECT id FROM categories WHERE slug = ? OR id = ? LIMIT 1',
                    [category, category]
                );
            if (catRows.length > 0) {
                const rootId = catRows[0].id;
                const [allCatRows] = await db.execute(
                    'SELECT id FROM categories WHERE id = ? OR parent_id = ? OR parent_id IN (SELECT id FROM categories WHERE parent_id = ?)',
                    [rootId, rootId, rootId]
                );
                const catIds = allCatRows.map(r => r.id);
                const placeholders = catIds.map(() => '?').join(',');
                whereClauses.push(`(p.category_id IN (${placeholders}) OR p.sub_category_id IN (${placeholders}) OR p.sub_sub_category_id IN (${placeholders}))`);
                params.push(...catIds, ...catIds, ...catIds);
            } else {
                const categoryPattern = category.replace(/-/g, '%');
                whereClauses.push('(c.slug = ? OR sc.slug = ? OR ssc.slug = ? OR p.product_group LIKE ? OR p.sub_category LIKE ?)');
                params.push(category, category, category, categoryPattern, categoryPattern);
            }
            }
        }
        if (brand) {
            const brandList = String(brand).split(',').map(s => s.trim()).filter(Boolean);
            if (brandList.length > 0) {
                const placeholders = brandList.map(() => '?').join(',');
                whereClauses.push(`(b.slug IN (${placeholders}) OR b.id IN (${placeholders}))`);
                params.push(...brandList, ...brandList);
            }
        }
        if (seller) {
            if (seller === 'admin') {
                whereClauses.push('p.seller_id IS NULL');
            } else {
                whereClauses.push('p.seller_id = ?');
                params.push(seller);
            }
        }
        if (minPrice) {
            whereClauses.push('p.price >= ?');
            params.push(minPrice);
        }
        if (maxPrice) {
            whereClauses.push('p.price <= ?');
            params.push(maxPrice);
        }
        if (search) {
            const searchWords = search.trim().split(/\s+/).filter(word => word.length > 0);
            if (searchWords.length > 0) {
                const wordConditions = searchWords.map(originalWord => {
                    // Match at start of string OR after a space
                    const wordsToMatch = [originalWord];

                    if (originalWord.length > 3 && originalWord.endsWith('s')) {
                        let singular = originalWord.slice(0, -1);
                        if (originalWord.endsWith('ies')) singular = originalWord.slice(0, -3) + 'y';
                        wordsToMatch.push(singular);
                    } else if (originalWord.length > 3 && !originalWord.endsWith('s')) {
                        wordsToMatch.push(originalWord + 's');
                    }

                    const subConditions = [];
                    for (const word of wordsToMatch) {
                        const wordParams = [];
                        for (let i = 0; i < 8; i++) {
                            wordParams.push(`%${word}%`, `% ${word}%`);
                        }
                        // Also check if any linked part matches this word (by model or name)
                        wordParams.push(`%${word}%`, `%${word}%`);
                        params.push(...wordParams);
                        subConditions.push('(' +
                            'p.name LIKE ? OR p.name LIKE ? OR ' +
                            'p.name_ar LIKE ? OR p.name_ar LIKE ? OR ' +
                            'c.name LIKE ? OR c.name LIKE ? OR ' +
                            'p.product_group LIKE ? OR p.product_group LIKE ? OR ' +
                            'p.sub_category LIKE ? OR p.sub_category LIKE ? OR ' +
                            'b.name LIKE ? OR b.name LIKE ? OR ' +
                            'b.name_ar LIKE ? OR b.name_ar LIKE ? OR ' +
                            'p.model LIKE ? OR p.model LIKE ? OR ' +
                            'EXISTS (SELECT 1 FROM products p_part WHERE p.linked_parts LIKE CONCAT(\'%\', p_part.id, \'%\') AND (p_part.model LIKE ? OR p_part.name LIKE ?))' +
                            ')');
                    }
                    return '(' + subConditions.join(' OR ') + ')';
                });
                whereClauses.push('(' + wordConditions.join(' AND ') + ')');
            }
        }

        try {
            if (whereClauses.length > 0) {
                query += ' WHERE ' + whereClauses.join(' AND ');
            }

            if (sort) {
                const allowedSorts = {
                    'price_asc': 'p.price ASC',
                    'price_desc': 'p.price DESC',
                    'newest': 'p.created_at DESC',
                    'name_asc': 'p.name ASC'
                };
                query += ` ORDER BY ${allowedSorts[sort] || 'p.created_at DESC'}`;
            } else {
                query += ' ORDER BY p.created_at DESC';
            }

            // Create a copy of params for the count query before adding limit/offset
            const countParams = [...params];

            // Inline LIMIT/OFFSET as safe integers to avoid "Incorrect arguments to mysqld_stmt_execute" on Aiven MySQL 8.x
            const safeLimit = parseInt(limit) || 12;
            const safeOffset = parseInt(offset) || 0;
            query += ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;

            // Use .query instead of .execute for fetching data (it is sometimes more robust with placeholders in complex queries)
            const [rows] = await db.query(query, params);

            // Fetch images for these products
            if (rows.length > 0) {
                const productIds = rows.map(p => p.id);
                const [images] = await db.query(
                    `SELECT * FROM product_images WHERE product_id IN (${productIds.join(',')})`
                );

                rows.forEach(p => {
                    p.images = images.filter(img => img.product_id === p.id);
                });

                // For products with variants enabled, override the displayed price /
                // offer_price / image / stock with the default variant's values
                // (or first variant if no default flagged). This makes promotion cards
                // and listings reflect what the customer actually sees on the detail
                // page, instead of the now-disabled top-level pricing.
                const variantProductIds = rows.filter(p => Number(p.has_variants) === 1).map(p => p.id);
                if (variantProductIds.length > 0) {
                    const [variantRows] = await db.query(
                        `SELECT product_id, price, offer_price, stock_quantity, image_url, image_urls, use_primary_image, is_default, id
                         FROM product_variants
                         WHERE product_id IN (${variantProductIds.join(',')})
                         ORDER BY is_default DESC, id ASC`
                    );
                    // First row per product wins (default first, then lowest id).
                    const chosenByProduct = {};
                    for (const v of variantRows) {
                        if (!chosenByProduct[v.product_id]) chosenByProduct[v.product_id] = v;
                    }

                    // Build a label like "Red / Large" for each chosen variant by
                    // fetching its option-value rows in one batch. Used by the
                    // notify-me flow on listings so the card can subscribe the
                    // user to the specific variant they're seeing.
                    const chosenVariantIds = Object.values(chosenByProduct).map(v => v.id);
                    const labelByVariantId = {};
                    if (chosenVariantIds.length > 0) {
                        const [valRows] = await db.query(
                            `SELECT pvo.variant_id, pvo.value, po.position
                             FROM product_variant_options pvo
                             JOIN product_options po ON po.id = pvo.option_id
                             WHERE pvo.variant_id IN (${chosenVariantIds.join(',')})
                             ORDER BY po.position ASC, po.id ASC`
                        );
                        for (const vr of valRows) {
                            if (!labelByVariantId[vr.variant_id]) labelByVariantId[vr.variant_id] = [];
                            labelByVariantId[vr.variant_id].push(String(vr.value || '').trim());
                        }
                    }

                    // Fetch swatch options ({color, image, value}) from the "Color" option
                    // so listings/cards can render color dots and swap the card image on click.
                    const swatchByProduct = {};
                    const swatchOptionsByProduct = {};
                    try {
                        const [optRows] = await db.query(
                            `SELECT id, product_id, name, name_ar, values_json
                             FROM product_options
                             WHERE product_id IN (${variantProductIds.join(',')})
                               AND (LOWER(name) IN ('color','colour') OR name_ar IN ('اللون','لون'))`
                        );
                        const colorOptionByProduct = {};
                        for (const r of optRows) {
                            colorOptionByProduct[r.product_id] = r;
                            if (!r.values_json) continue;
                            let parsed = null;
                            try { parsed = JSON.parse(r.values_json); } catch (e) { parsed = null; }
                            if (!Array.isArray(parsed)) continue;
                            const colors = parsed
                                .map(v => (v && v.swatch_color) ? String(v.swatch_color).trim() : null)
                                .filter(Boolean);
                            if (colors.length > 0) swatchByProduct[r.product_id] = colors;
                        }

                        // Map each color value -> a representative variant image (per product)
                        const colorOptionIds = Object.values(colorOptionByProduct).map(r => r.id);
                        if (colorOptionIds.length > 0) {
                            const [imgRows] = await db.query(
                                `SELECT pvo.option_id, pvo.value, pv.product_id, pv.image_url, pv.image_urls, pv.use_primary_image, pv.price, pv.offer_price
                                 FROM product_variant_options pvo
                                 JOIN product_variants pv ON pv.id = pvo.variant_id
                                 WHERE pvo.option_id IN (${colorOptionIds.join(',')})
                                   AND pv.is_active = 1
                                 ORDER BY pv.is_default DESC, pv.id ASC`
                            );
                            const bestByPidValue = {};
                            for (const ir of imgRows) {
                                const key = `${ir.product_id}::${(ir.value || '').trim()}`;
                                const hasCustom = !Number(ir.use_primary_image) && ir.image_url;
                                if (!bestByPidValue[key] || (hasCustom && !bestByPidValue[key].hasCustom)) {
                                    // Full image list for this color variant (fall back to the single image).
                                    let imgs = [];
                                    if (hasCustom && ir.image_urls) { try { imgs = JSON.parse(ir.image_urls); } catch (e) { imgs = []; } }
                                    if (!Array.isArray(imgs) || imgs.length === 0) imgs = hasCustom ? [ir.image_url] : [];
                                    // Capture the representative variant's price so cards can update
                                    // the displayed price when this color swatch is selected.
                                    bestByPidValue[key] = {
                                        image: hasCustom ? ir.image_url : null,
                                        images: imgs,
                                        hasCustom,
                                        price: (ir.price !== null && ir.price !== undefined) ? Number(ir.price) : null,
                                        offer_price: (ir.offer_price !== null && ir.offer_price !== undefined && Number(ir.offer_price) > 0) ? Number(ir.offer_price) : null
                                    };
                                }
                            }
                            for (const r of optRows) {
                                if (!r.values_json) continue;
                                let parsed = null;
                                try { parsed = JSON.parse(r.values_json); } catch (e) { parsed = null; }
                                if (!Array.isArray(parsed)) continue;
                                const list = parsed
                                    .filter(v => v && v.swatch_color)
                                    .map(v => {
                                        const key = `${r.product_id}::${String(v.value || '').trim()}`;
                                        return {
                                            color: String(v.swatch_color).trim(),
                                            value: String(v.value || '').trim(),
                                            image: bestByPidValue[key]?.image || null,
                                            images: bestByPidValue[key]?.images || [],
                                            price: bestByPidValue[key]?.price ?? null,
                                            offer_price: bestByPidValue[key]?.offer_price ?? null
                                        };
                                    });
                                if (list.length > 0) swatchOptionsByProduct[r.product_id] = list;
                            }
                        }
                    } catch (e) { /* non-fatal */ }

                    rows.forEach(p => {
                        if (swatchByProduct[p.id]) p.swatch_colors = swatchByProduct[p.id];
                        if (swatchOptionsByProduct[p.id]) p.swatch_options = swatchOptionsByProduct[p.id];
                        const v = chosenByProduct[p.id];
                        if (!v) return;
                        // Expose the default variant's id so a card "add to cart" adds that
                        // variant (with its image/price) instead of a variantless line.
                        p.default_variant_id = v.id;
                        const parts = (labelByVariantId[v.id] || []).filter(Boolean);
                        if (parts.length > 0) p.variant_label = parts.join(' / ').slice(0, 255);
                        if (v.price !== null && v.price !== undefined) p.price = v.price;
                        if (v.offer_price !== null && v.offer_price !== undefined) p.offer_price = v.offer_price;
                        if (v.stock_quantity !== null && v.stock_quantity !== undefined) p.stock_quantity = v.stock_quantity;
                        // Recalculate discount_percentage from the variant. If the variant has a
                        // valid offer_price below its price, derive a fresh %; otherwise zero it
                        // out so the stale top-level discount badge doesn't leak through.
                        const vPrice = Number(v.price) || 0;
                        const vOffer = Number(v.offer_price) || 0;
                        if (vPrice > 0 && vOffer > 0 && vOffer < vPrice) {
                            p.discount_percentage = Math.round(((vPrice - vOffer) / vPrice) * 100);
                        } else {
                            p.discount_percentage = 0;
                        }
                        // Image: prefer the variant's own image; fall back to the product's primary image
                        // when the variant is flagged use_primary_image or has no image.
                        if (!Number(v.use_primary_image) && v.image_url) {
                            p.primary_image = v.image_url;
                        }
                        // Expose the chosen (default) variant's full image gallery so cards
                        // can carousel through all of that variant's images, not just one.
                        if (!Number(v.use_primary_image)) {
                            let vImgs = [];
                            if (v.image_urls) { try { vImgs = JSON.parse(v.image_urls); } catch (e) { vImgs = []; } }
                            if (Array.isArray(vImgs) && vImgs.length > 0) p.variant_gallery = vImgs;
                            else if (v.image_url) p.variant_gallery = [v.image_url];
                        }
                    });
                }

                // ---- Customizable products: compute the base price from size tiers ----
                // For each customizable product, the displayed price = sum of the matched
                // tier price for each base dimension. Override p.price (and clear offer_price)
                // so cards/listings show the correct customized base price.
                await ProductSizeTier.ensureSchema();
                const customProductIds = rows.filter(p => Number(p.is_customizable) === 1).map(p => p.id);
                if (customProductIds.length > 0) {
                    const [tierRows] = await db.query(
                        `SELECT product_id, dimension, min_cm, max_cm, price
                         FROM product_size_tiers
                         WHERE product_id IN (${customProductIds.join(',')})`
                    );
                    const tiersByProduct = {};
                    for (const t of tierRows) {
                        (tiersByProduct[t.product_id] = tiersByProduct[t.product_id] || []).push(t);
                    }

                    rows.forEach(p => {
                        if (Number(p.is_customizable) !== 1) return;
                        // Parse base_dimensions JSON
                        let baseDims = {};
                        try {
                            if (p.base_dimensions) baseDims = typeof p.base_dimensions === 'string' ? JSON.parse(p.base_dimensions) : p.base_dimensions;
                        } catch (e) { baseDims = {}; }
                        let customDims = [];
                        try {
                            if (p.custom_dimensions) customDims = typeof p.custom_dimensions === 'string' ? JSON.parse(p.custom_dimensions) : p.custom_dimensions;
                        } catch (e) { customDims = []; }
                        if (!Array.isArray(customDims) || customDims.length === 0) return;

                        const tiers = tiersByProduct[p.id] || [];
                        let total = 0;
                        let ok = true;
                        for (const dim of customDims) {
                            const baseV = Number(baseDims[dim]);
                            if (!Number.isFinite(baseV)) { ok = false; break; }
                            const dimTiers = tiers.filter(t => t.dimension === dim);
                            if (dimTiers.length === 0) { ok = false; break; }
                            const tier = dimTiers.find(t => baseV >= Number(t.min_cm) && baseV <= Number(t.max_cm));
                            if (!tier) { ok = false; break; }
                            total += Number(tier.price);
                        }
                        if (ok) {
                            p.price = total;
                            // Customizable products don't currently support a separate offer;
                            // clear offer fields so cards don't show stale strike-through prices.
                            p.offer_price = null;
                            p.discount_percentage = 0;
                        }
                    });
                }
            }

            // Count query
            let countQuery = `
                SELECT COUNT(*) as total FROM products p 
                LEFT JOIN categories c ON p.category_id = c.id 
                LEFT JOIN categories sc ON p.sub_category_id = sc.id
                LEFT JOIN categories ssc ON p.sub_sub_category_id = ssc.id
                LEFT JOIN brands b ON p.brand_id = b.id
            `;
            if (whereClauses.length > 0) {
                countQuery += ' WHERE ' + whereClauses.join(' AND ');
            }
            const [countRows] = await db.query(countQuery, countParams);
            const total = countRows[0].total;

            return { products: rows, total };
        } catch (error) {
            console.error('DATABASE ERROR IN Product.findAll:', error);
            console.error('QUERY:', query);
            console.error('PARAMS:', JSON.stringify(params));
            throw error;
        }
    }

    // Customizable products keep their price in product_size_tiers, not products.price
    // (which is 0/placeholder). For any customizable rows in `rows`, set price = sum of the
    // matched tier price for each customizable dimension (using the product's base size).
    // Mirrors the inline logic in findAll so related rails, compare slots, FBT, gifts and the
    // product page all show the real configured price instead of 0.
    static async applyCustomizableBasePrice(rows) {
        if (!Array.isArray(rows) || rows.length === 0) return rows;
        const customIds = rows.filter(p => p && Number(p.is_customizable) === 1).map(p => p.id);
        if (customIds.length === 0) return rows;
        const tiersByProduct = {};
        try {
            const [tierRows] = await db.query(
                `SELECT product_id, dimension, min_cm, max_cm, price FROM product_size_tiers WHERE product_id IN (?)`,
                [customIds]
            );
            for (const t of tierRows) (tiersByProduct[t.product_id] = tiersByProduct[t.product_id] || []).push(t);
        } catch (e) { return rows; }
        const parse = (raw) => { if (!raw) return null; try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; } };
        rows.forEach(p => {
            if (!p || Number(p.is_customizable) !== 1) return;
            const cfg = parse(p.custom_dimensions);
            const base = parse(p.base_dimensions) || {};
            const tiers = tiersByProduct[p.id] || [];
            if (!Array.isArray(cfg) || cfg.length === 0 || tiers.length === 0) return;
            let total = 0, ok = true;
            for (const dim of cfg) {
                const v = Number(base[dim]);
                if (!Number.isFinite(v)) { ok = false; break; }
                const tier = tiers.find(t => t.dimension === dim && v >= Number(t.min_cm) && v <= Number(t.max_cm));
                if (!tier) { ok = false; break; }
                total += Number(tier.price);
            }
            if (ok) { p.price = total; p.offer_price = null; p.discount_percentage = 0; }
        });
        return rows;
    }

    static async findById(id) {
        await ensureFreeGiftColumn();
        await ensureCompareConfigColumn();
        await ensureSpecificationsArColumn();
        const [rows] = await db.execute(`
            SELECT p.*,
            c.name as category_name, c.name_ar as category_name_ar, c.slug as category_slug,
            sc.name as sub_category_name, sc.name_ar as sub_category_name_ar, sc.slug as sub_category_slug,
            ssc.name as sub_sub_category_name, ssc.name_ar as sub_sub_category_name_ar, ssc.slug as sub_sub_category_slug,
            b.name as brand_name, b.name_ar as brand_name_ar, b.slug as brand_slug, b.image_url as brand_image, b.description as brand_description, b.description_ar as brand_description_ar,
            s.name as seller_name, s.company_name as seller_company, s.id as seller_id,
            COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = p.id), 0) as average_rating,
            (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as total_reviews,
            COALESCE((SELECT SUM(quantity) FROM order_items WHERE product_id = p.id), 0) as sold_count
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN categories sc ON p.sub_category_id = sc.id
            LEFT JOIN categories ssc ON p.sub_sub_category_id = ssc.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN users s ON p.seller_id = s.id
            WHERE p.id = ? OR p.slug = ?
        `, [id, id]);

        if (rows.length > 0) {
            const product = rows[0];
            // Customizable products: set product.price to the computed base price (tiers) so any
            // consumer reading it directly gets the real price, not the 0 placeholder. The detail
            // page still recomputes live from size_tiers as the buyer changes dimensions.
            await Product.applyCustomizableBasePrice([product]);
            const [images] = await db.execute('SELECT * FROM product_images WHERE product_id = ?', [product.id]);
            product.images = images;

            // Enrich frequently_bought_together IDs with product data
            let fbtIds = [];
            if (product.frequently_bought_together) {
                try {
                    fbtIds = JSON.parse(product.frequently_bought_together);
                } catch (e) { fbtIds = []; }
            }
            if (Array.isArray(fbtIds) && fbtIds.length > 0) {
                const placeholders = fbtIds.map(() => '?').join(',');
                const [fbtRows] = await db.query(
                    `SELECT p.id, p.name, p.name_ar, p.slug, p.price, p.offer_price, p.discount_percentage,
                     p.is_customizable, p.custom_dimensions, p.base_dimensions,
                     (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
                     FROM products p WHERE p.id IN (${placeholders}) AND p.is_active = 1`,
                    fbtIds
                );
                await Product.applyCustomizableBasePrice(fbtRows);
                product.frequently_bought_together_products = fbtRows;
            } else {
                product.frequently_bought_together_products = [];
            }

            // Parse admin-curated compare_config + enrich its slot product ids with names/images/prices.
            let compareConfig = null;
            if (product.compare_config) {
                try {
                    compareConfig = typeof product.compare_config === 'string'
                        ? JSON.parse(product.compare_config)
                        : product.compare_config;
                } catch (e) { compareConfig = null; }
            }
            product.compare_config = compareConfig;
            if (compareConfig && Array.isArray(compareConfig.slots) && compareConfig.slots.length > 0) {
                const slotIds = compareConfig.slots.filter(Boolean);
                if (slotIds.length > 0) {
                    const placeholders = slotIds.map(() => '?').join(',');
                    const [slotRows] = await db.query(
                        `SELECT p.id, p.name, p.name_ar, p.slug, p.price, p.offer_price, p.discount_percentage,
                         p.is_customizable, p.custom_dimensions, p.base_dimensions,
                         (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
                         FROM products p WHERE p.id IN (${placeholders}) AND p.is_active = 1`,
                        slotIds
                    );
                    await Product.applyCustomizableBasePrice(slotRows);
                    // Preserve admin-defined slot ordering.
                    product.compare_slot_products = slotIds.map(id => slotRows.find(r => r.id === id) || null);
                } else {
                    product.compare_slot_products = [];
                }
            } else {
                product.compare_slot_products = [];
            }

            // Enrich free_gift_product_ids with product data
            let giftIds = [];
            if (product.free_gift_product_ids) {
                try {
                    giftIds = JSON.parse(product.free_gift_product_ids);
                } catch (e) { giftIds = []; }
            }
            if (Array.isArray(giftIds) && giftIds.length > 0) {
                const placeholders = giftIds.map(() => '?').join(',');
                const [giftRows] = await db.query(
                    `SELECT p.id, p.name, p.name_ar, p.slug, p.price, p.offer_price, p.discount_percentage,
                     p.is_customizable, p.custom_dimensions, p.base_dimensions,
                     (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
                     FROM products p WHERE p.id IN (${placeholders}) AND p.is_active = 1`,
                    giftIds
                );
                await Product.applyCustomizableBasePrice(giftRows);
                product.free_gift_products = giftRows;
            } else {
                product.free_gift_products = [];
            }

            // Enrich you_may_also_need IDs with product data
            let ymanIds = [];
            if (product.you_may_also_need) {
                try {
                    ymanIds = JSON.parse(product.you_may_also_need);
                } catch (e) { ymanIds = []; }
            }
            if (Array.isArray(ymanIds) && ymanIds.length > 0) {
                const placeholders = ymanIds.map(() => '?').join(',');
                const [ymanRows] = await db.query(
                    `SELECT p.id, p.name, p.name_ar, p.slug, p.price, p.offer_price, p.discount_percentage,
                     p.is_customizable, p.custom_dimensions, p.base_dimensions,
                     (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
                     FROM products p WHERE p.id IN (${placeholders}) AND p.is_active = 1`,
                    ymanIds
                );
                await Product.applyCustomizableBasePrice(ymanRows);
                product.you_may_also_need_products = ymanRows;
            } else {
                product.you_may_also_need_products = [];
            }

            // Enrich linked_parts IDs with product data
            let linkedPartsIds = [];
            if (product.linked_parts) {
                try {
                    linkedPartsIds = JSON.parse(product.linked_parts);
                } catch (e) { linkedPartsIds = []; }
            }
            if (Array.isArray(linkedPartsIds) && linkedPartsIds.length > 0) {
                const placeholders = linkedPartsIds.map(() => '?').join(',');
                const [partsRows] = await db.query(
                    `SELECT p.id, p.name, p.name_ar, p.slug, p.price, p.offer_price, p.discount_percentage,
                     p.stock_quantity,
                     p.is_customizable, p.custom_dimensions, p.base_dimensions,
                     (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
                     FROM products p WHERE p.id IN (${placeholders}) AND p.is_active = 1`,
                    linkedPartsIds
                );
                await Product.applyCustomizableBasePrice(partsRows);
                product.linked_parts_products = partsRows;
            } else {
                product.linked_parts_products = [];
            }

            // Attach options + variants if any
            if (Number(product.has_variants) === 1) {
                const { options, variants } = await ProductVariant.getByProductId(product.id);
                product.options = options;
                product.variants = variants;
            } else {
                product.options = [];
                product.variants = [];
            }

            // Size tiers (custom-dimension pricing). custom_dimensions stored as JSON string.
            if (Number(product.is_customizable) === 1) {
                try {
                    product.size_tiers = await ProductSizeTier.getByProductId(product.id);
                } catch (e) {
                    console.error('Failed to load size tiers for product', product.id, e.message);
                    product.size_tiers = [];
                }
                try {
                    product.custom_dimensions = product.custom_dimensions
                        ? JSON.parse(product.custom_dimensions)
                        : [];
                } catch (e) {
                    product.custom_dimensions = [];
                }
                try {
                    product.base_dimensions = product.base_dimensions
                        ? JSON.parse(product.base_dimensions)
                        : {};
                } catch (e) {
                    product.base_dimensions = {};
                }
            } else {
                product.size_tiers = [];
                product.custom_dimensions = [];
                product.base_dimensions = {};
            }

            return product;
        }

        return null;
    }

    static async generateUniqueSlug(name, excludeId = null) {
        let baseSlug = slugify(name || 'product', { lower: true, remove: /[*+~.()'"!:@]/g });
        let slug = baseSlug;
        let counter = 1;

        while (true) {
            let query = 'SELECT id FROM products WHERE slug = ?';
            let params = [slug];

            if (excludeId) {
                query += ' AND id != ?';
                params.push(excludeId);
            }

            const [rows] = await db.execute(query, params);

            if (rows.length === 0) {
                return slug;
            }

            slug = `${baseSlug}-${counter}`;
            counter++;
        }
    }

    static async create(data) {
        try {
            // Ensure customizable schema exists before INSERT (lazy migration)
            await ProductSizeTier.ensureSchema();
            await ensureFreeGiftColumn();
            await ensureCompareConfigColumn();
            await ensureSpecificationsArColumn();
            const name = String(data.name || '');
            const model = data.model ? String(data.model) : null;
            const youtube_video_link = data.youtube_video_link ? String(data.youtube_video_link) : null;
            const resources = data.resources ? String(data.resources) : null;
            const slug = await this.generateUniqueSlug(name);
            const name_ar = data.name_ar ? String(data.name_ar) : null;
            const description = data.description ? String(data.description) : null;
            const description_ar = data.description_ar ? String(data.description_ar) : null;
            const short_description = data.short_description ? String(data.short_description) : null;
            const short_description_ar = data.short_description_ar ? String(data.short_description_ar) : null;
            const specifications = data.specifications ? String(data.specifications) : null;
            const specifications_ar = data.specifications_ar ? String(data.specifications_ar) : null;
            const price = parseFloat(data.price) || 0;
            const discount_percentage = parseFloat(data.discount_percentage) || 0;
            const offer_price = data.offer_price ? parseFloat(data.offer_price) : (discount_percentage > 0 ? price - (price * discount_percentage / 100) : null);
            const stock_quantity = parseInt(data.stock_quantity) || 0;
            const category_id = (data.category_id && !isNaN(parseInt(data.category_id))) ? parseInt(data.category_id) : null;
            const sub_category_id = (data.sub_category_id && !isNaN(parseInt(data.sub_category_id))) ? parseInt(data.sub_category_id) : null;
            const sub_sub_category_id = (data.sub_sub_category_id && !isNaN(parseInt(data.sub_sub_category_id))) ? parseInt(data.sub_sub_category_id) : null;
            const brand_id = (data.brand_id && !isNaN(parseInt(data.brand_id))) ? parseInt(data.brand_id) : null;
            const isTrue = (val) => val === true || val === 'true' || val === 1 || val === '1';
            const is_featured = isTrue(data.is_featured) ? 1 : 0;
            let is_weekly_deal = isTrue(data.is_weekly_deal) ? 1 : 0;
            let is_limited_offer = isTrue(data.is_limited_offer) ? 1 : 0;
            const is_daily_offer = isTrue(data.is_daily_offer) ? 1 : 0;
            const is_best_seller = isTrue(data.is_best_seller) ? 1 : 0;
            const track_inventory = isTrue(data.track_inventory) ? 1 : 0;
            const delivery_charge = (data.delivery_charge !== undefined && data.delivery_charge !== null && data.delivery_charge !== '') ? (parseFloat(data.delivery_charge) || 0) : 0;

            const status = data.status || 'active';
            const product_group = data.product_group || data.heading || null;
            const sub_category = data.sub_category || null;
            const seller_id = (data.seller_id && !isNaN(parseInt(data.seller_id))) ? parseInt(data.seller_id) : null;
            const offer_start = data.offer_start || null;
            const offer_end = data.offer_end || null;
            const is_customizable = isTrue(data.is_customizable) ? 1 : 0;
            const custom_dimensions = (() => {
                if (!is_customizable) return null;
                const allowed = ['width', 'depth', 'height'];
                let dims = data.custom_dimensions;
                if (typeof dims === 'string') {
                    try { dims = JSON.parse(dims); } catch (e) { dims = []; }
                }
                if (!Array.isArray(dims)) return null;
                const clean = dims.filter(d => allowed.includes(String(d)));
                return clean.length > 0 ? JSON.stringify(clean) : null;
            })();
            const base_dimensions = (() => {
                if (!is_customizable) return null;
                const allowed = ['width', 'depth', 'height'];
                let bd = data.base_dimensions;
                if (typeof bd === 'string') {
                    try { bd = JSON.parse(bd); } catch (e) { bd = {}; }
                }
                if (!bd || typeof bd !== 'object') return null;
                const clean = {};
                for (const k of allowed) {
                    const n = parseInt(bd[k], 10);
                    if (Number.isFinite(n) && n >= 0) clean[k] = n;
                }
                return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
            })();

            const params = [
                name, name_ar, slug, description, description_ar, short_description, short_description_ar,
                specifications, specifications_ar, price, discount_percentage, offer_price, stock_quantity, track_inventory,
                category_id, sub_category_id, sub_sub_category_id, brand_id, seller_id,
                is_featured, is_weekly_deal, is_limited_offer, is_daily_offer, is_best_seller,
                status, product_group, sub_category, model, youtube_video_link, resources,
                offer_start, offer_end,
                data.frequently_bought_together ? String(data.frequently_bought_together) : null,
                data.you_may_also_need ? String(data.you_may_also_need) : null,
                data.free_gift_product_ids ? String(data.free_gift_product_ids) : null,
                data.compare_config ? String(data.compare_config) : null,
                (data.warranty !== undefined && data.warranty !== '' && data.warranty !== null) ? parseInt(data.warranty) : null,
                (data.warranty_ar !== undefined && data.warranty_ar !== '' && data.warranty_ar !== null) ? parseInt(data.warranty_ar) : null,
                is_customizable, custom_dimensions, base_dimensions, delivery_charge,
                data.linked_parts ? String(data.linked_parts) : null
            ].map(p => (p === undefined ? null : p));

            const [result] = await db.execute(
                'INSERT INTO products (name, name_ar, slug, description, description_ar, short_description, short_description_ar, specifications, specifications_ar, price, discount_percentage, offer_price, stock_quantity, track_inventory, category_id, sub_category_id, sub_sub_category_id, brand_id, seller_id, is_featured, is_weekly_deal, is_limited_offer, is_daily_offer, is_best_seller, status, product_group, sub_category, model, youtube_video_link, resources, offer_start, offer_end, frequently_bought_together, you_may_also_need, free_gift_product_ids, compare_config, warranty, warranty_ar, is_customizable, custom_dimensions, base_dimensions, delivery_charge, linked_parts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                params
            );

            const productId = result.insertId;

            // Persist size tiers if customizable
            if (is_customizable && Array.isArray(data.size_tiers)) {
                try {
                    await ProductSizeTier.replaceForProduct(productId, data.size_tiers);
                } catch (e) {
                    console.error('Failed to persist size tiers for new product', productId, e.message);
                }
            }

            // Handle multiple images
            if (data.images && Array.isArray(data.images)) {
                for (let i = 0; i < data.images.length; i++) {
                    await db.execute(
                        'INSERT INTO product_images (product_id, image_url, is_primary) VALUES (?, ?, ?)',
                        [productId, data.images[i], i === 0 ? 1 : 0]
                    );
                }
            } else if (data.image_url) {
                // Fallback to single image_url if provided
                await db.execute(
                    'INSERT INTO product_images (product_id, image_url, is_primary) VALUES (?, ?, ?)',
                    [productId, data.image_url, 1]
                );
            }

            if (Array.isArray(data.options) && Array.isArray(data.variants) && data.options.length > 0) {
                await this._persistVariants(productId, data.options, data.variants);
            }

            return productId;
        } catch (error) {
            console.error('Database Error in Product.create:', error);
            throw error;
        }
    }

    static async _persistVariants(productId, options, variants) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await ProductVariant.saveForProduct(conn, productId, options, variants);
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            console.error('Failed to persist variants for product', productId, error);
            throw error;
        } finally {
            conn.release();
        }
    }

    static async update(id, data) {
        // Ensure customizable schema exists before UPDATE references the new columns
        await ProductSizeTier.ensureSchema();
        await ensureFreeGiftColumn();
        await ensureCompareConfigColumn();
        await ensureSpecificationsArColumn();
        const allowedColumns = [
            'name', 'name_ar', 'description', 'description_ar', 'short_description', 'short_description_ar',
            'specifications', 'specifications_ar', 'price', 'discount_percentage', 'offer_price', 'stock_quantity',
            'track_inventory', 'category_id', 'sub_category_id', 'sub_sub_category_id', 'brand_id',
            'seller_id', 'is_featured', 'is_weekly_deal', 'is_limited_offer', 'is_daily_offer',
            'is_best_seller', 'status', 'product_group', 'sub_category', 'model',
            'youtube_video_link', 'resources', 'offer_start', 'offer_end',
            'frequently_bought_together', 'you_may_also_need', 'free_gift_product_ids', 'compare_config', 'warranty', 'warranty_ar',
            'is_customizable', 'custom_dimensions', 'base_dimensions', 'delivery_charge', 'linked_parts'
        ];

        const productId = parseInt(id);
        if (isNaN(productId)) {
            throw new Error('Invalid product ID');
        }

        const cleanData = {};

        // Slug (URL) rules:
        //  • Admin sends an explicit `slug` → use it.
        //  • The product NAME changed → regenerate the slug from the new name
        //    (so renaming, e.g. removing an accidental "Black", updates the URL).
        //  • The product has no slug yet (legacy rows) → generate one.
        //  • Otherwise (name unchanged — e.g. just adding an image / editing price)
        //    → leave the existing slug untouched so the URL stays stable.
        if (data.slug) {
            cleanData.slug = await this.generateUniqueSlug(data.slug, productId);
        } else if (data.name) {
            const [currentRows] = await db.execute('SELECT name, slug FROM products WHERE id = ?', [productId]);
            const currentName = currentRows.length > 0 ? currentRows[0].name : null;
            const currentSlug = currentRows.length > 0 ? currentRows[0].slug : null;
            const nameChanged = String(data.name).trim() !== String(currentName || '').trim();
            if (!currentSlug || nameChanged) {
                cleanData.slug = await this.generateUniqueSlug(data.name, productId);
            }
            // else: name unchanged → keep the existing slug
        }

        Object.keys(data).forEach(key => {
            if (allowedColumns.includes(key) && data[key] !== undefined && key !== 'slug') {
                if (['is_featured', 'is_weekly_deal', 'is_limited_offer', 'is_daily_offer', 'is_active', 'track_inventory', 'is_customizable'].includes(key)) {
                    const val = data[key];
                    cleanData[key] = (val === true || val === 'true' || val === 1 || val === '1') ? 1 : 0;
                } else if (key === 'custom_dimensions') {
                    const allowed = ['width', 'depth', 'height'];
                    let dims = data[key];
                    if (typeof dims === 'string') {
                        try { dims = JSON.parse(dims); } catch (e) { dims = []; }
                    }
                    if (Array.isArray(dims)) {
                        const clean = dims.filter(d => allowed.includes(String(d)));
                        cleanData[key] = clean.length > 0 ? JSON.stringify(clean) : null;
                    } else {
                        cleanData[key] = null;
                    }
                } else if (key === 'base_dimensions') {
                    const allowed = ['width', 'depth', 'height'];
                    let bd = data[key];
                    if (typeof bd === 'string') {
                        try { bd = JSON.parse(bd); } catch (e) { bd = {}; }
                    }
                    if (bd && typeof bd === 'object') {
                        const clean = {};
                        for (const k of allowed) {
                            const n = parseInt(bd[k], 10);
                            if (Number.isFinite(n) && n >= 0) clean[k] = n;
                        }
                        cleanData[key] = Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
                    } else {
                        cleanData[key] = null;
                    }
                } else if (['category_id', 'sub_category_id', 'sub_sub_category_id', 'brand_id'].includes(key)) {
                    // Handle numeric foreign keys: empty string or null -> null
                    const val = data[key];
                    if (val === '' || val === null || val === undefined) {
                        cleanData[key] = null;
                    } else {
                        const parsed = parseInt(val);
                        cleanData[key] = isNaN(parsed) ? null : parsed;
                    }
                } else if (['offer_start', 'offer_end'].includes(key)) {
                    // Handle datetime columns: empty string -> null (strict MySQL rejects '')
                    cleanData[key] = (data[key] && data[key] !== '') ? data[key] : null;
                } else if (['offer_price', 'price', 'discount_percentage', 'stock_quantity', 'warranty', 'warranty_ar'].includes(key)) {
                    // Handle numeric columns: empty string -> null
                    const val = data[key];
                    if (val === '' || val === null || val === undefined) {
                        cleanData[key] = null;
                    } else {
                        const parsed = parseFloat(val);
                        cleanData[key] = isNaN(parsed) ? null : parsed;
                    }
                } else {
                    cleanData[key] = data[key] === null ? null : data[key];
                }
            }
        });

        if (cleanData.is_weekly_deal === 1) {
            cleanData.is_limited_offer = 0;
        } else if (cleanData.is_limited_offer === 1) {
            cleanData.is_weekly_deal = 0;
        }

        // Handle images update
        if (data.images && Array.isArray(data.images)) {
            // Option 1: Replace all images (simpler for now)
            await db.execute('DELETE FROM product_images WHERE product_id = ?', [productId]);
            for (let i = 0; i < data.images.length; i++) {
                await db.execute(
                    'INSERT INTO product_images (product_id, image_url, is_primary) VALUES (?, ?, ?)',
                    [productId, data.images[i], i === 0 ? 1 : 0]
                );
            }
        } else if (data.image_url) {
            // Fallback: update/set primary image
            const [existing] = await db.execute(
                'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
                [productId]
            );

            if (existing.length > 0) {
                await db.execute(
                    'UPDATE product_images SET image_url = ? WHERE product_id = ? AND is_primary = 1',
                    [data.image_url, productId]
                );
            } else {
                await db.execute(
                    'INSERT INTO product_images (product_id, image_url, is_primary) VALUES (?, ?, 1)',
                    [productId, data.image_url]
                );
            }
        }

        if (Object.keys(cleanData).length > 0) {
            const fields = Object.keys(cleanData).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(cleanData), productId];
            await db.execute(`UPDATE products SET ${fields} WHERE id = ?`, values);
        }

        // Persist variants if payload includes them. An empty variants array clears them.
        if (Array.isArray(data.options) && Array.isArray(data.variants)) {
            await this._persistVariants(productId, data.options, data.variants);
        }

        // Persist size tiers when payload provides them. If is_customizable was just
        // turned off (cleanData.is_customizable === 0), wipe the tiers regardless.
        if (cleanData.is_customizable === 0) {
            try {
                await ProductSizeTier.replaceForProduct(productId, []);
            } catch (e) {
                console.error('Failed to clear size tiers for product', productId, e.message);
            }
        } else if (Array.isArray(data.size_tiers)) {
            try {
                await ProductSizeTier.replaceForProduct(productId, data.size_tiers);
            } catch (e) {
                console.error('Failed to persist size tiers for product', productId, e.message);
            }
        }
    }

    static async bulkUpdate(ids, data) {
        if (!Array.isArray(ids) || ids.length === 0) return;

        const allowedColumns = [
            'is_featured', 'is_weekly_deal', 'is_limited_offer', 'is_daily_offer',
            'is_active', 'status', 'offer_start', 'offer_end', 'discount_percentage', 'price'
        ];

        const cleanData = {};
        Object.keys(data).forEach(key => {
            if (allowedColumns.includes(key) && data[key] !== undefined) {
                if (['is_featured', 'is_weekly_deal', 'is_limited_offer', 'is_daily_offer', 'is_active'].includes(key)) {
                    const val = data[key];
                    cleanData[key] = (val === true || val === 'true' || val === 1 || val === '1') ? 1 : 0;
                } else if (['offer_start', 'offer_end'].includes(key)) {
                    // Handle datetime columns: empty string -> null (strict MySQL rejects '')
                    cleanData[key] = (data[key] && data[key] !== '') ? data[key] : null;
                } else if (['discount_percentage', 'price'].includes(key)) {
                    // Handle numeric columns: empty string -> null
                    const val = data[key];
                    if (val === '' || val === null || val === undefined) {
                        cleanData[key] = null;
                    } else {
                        const parsed = parseFloat(val);
                        cleanData[key] = isNaN(parsed) ? null : parsed;
                    }
                } else {
                    cleanData[key] = data[key];
                }
            }
        });

        if (Object.keys(cleanData).length === 0) return;

        const fields = Object.keys(cleanData).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(cleanData)];

        // Use placeholders for IDs
        const placeholders = ids.map(() => '?').join(',');
        const query = `UPDATE products SET ${fields} WHERE id IN (${placeholders})`;

        await db.execute(query, [...values, ...ids]);
    }

    static async delete(id) {
        // Perform a hard delete as requested. 
        // Note: product_images, cart_items, and order_items will be deleted automatically due to ON DELETE CASCADE constraints.
        await db.execute('DELETE FROM products WHERE id = ?', [id]);
    }

    static async bulkDelete(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(`DELETE FROM products WHERE id IN (${placeholders})`, ids);
    }
}

module.exports = Product;

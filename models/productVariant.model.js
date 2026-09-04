const db = require('../config/db');

let variantImageUrlsColEnsured = false;
async function ensureVariantImageUrlsColumn() {
    if (variantImageUrlsColEnsured) return;
    const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants'
           AND COLUMN_NAME = 'image_urls'`
    );
    if (cols.length === 0) {
        await db.query(`ALTER TABLE product_variants ADD COLUMN image_urls JSON NULL`);
    }
    variantImageUrlsColEnsured = true;
}

function parseImageUrls(raw) {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
            return parsed.map(s => String(s || '').trim()).filter(Boolean);
        }
    } catch (e) { /* ignore */ }
    return [];
}

// Build a stable signature so we can look up a variant by its chosen option values
// Format: "optionId:value|optionId:value" with option ids sorted ascending
function buildSignature(variantOptions) {
    return [...variantOptions]
        .sort((a, b) => Number(a.option_id) - Number(b.option_id))
        .map(o => `${o.option_id}:${String(o.value).trim()}`)
        .join('|');
}

class ProductVariant {
    // Returns { options, variants } for a product
    static async getByProductId(productId) {
        await ensureVariantImageUrlsColumn();
        const [options] = await db.query(
            'SELECT id, name, name_ar, position, values_json FROM product_options WHERE product_id = ? ORDER BY position ASC, id ASC',
            [productId]
        );

        if (options.length === 0) {
            return { options: [], variants: [] };
        }

        const [variants] = await db.query(
            `SELECT id, sku, price, offer_price, stock_quantity, image_url, image_urls, use_primary_image, options_signature, is_active, is_default
             FROM product_variants WHERE product_id = ? ORDER BY id ASC`,
            [productId]
        );
        variants.forEach(v => {
            const list = parseImageUrls(v.image_urls);
            // Hydrate legacy rows that only had image_url: surface it as a single-entry list.
            v.image_urls = list.length > 0 ? list : (v.image_url ? [v.image_url] : []);
        });

        if (variants.length === 0) {
            return { options, variants: [] };
        }

        const variantIds = variants.map(v => v.id);
        const [valueRows] = await db.query(
            `SELECT variant_id, option_id, value, value_ar, swatch_color
             FROM product_variant_options WHERE variant_id IN (?)`,
            [variantIds]
        );

        // Also surface distinct values per option (for UI display) by scanning variant values
        const valuesByOption = {};
        valueRows.forEach(r => {
            if (!valuesByOption[r.option_id]) valuesByOption[r.option_id] = new Map();
            if (!valuesByOption[r.option_id].has(r.value)) {
                valuesByOption[r.option_id].set(r.value, { value_ar: r.value_ar || null, swatch_color: r.swatch_color || null });
            }
        });
        options.forEach(opt => {
            const map = valuesByOption[opt.id] || new Map();
            const derived = Array.from(map.entries()).map(([value, meta]) => ({ value, value_ar: meta.value_ar, swatch_color: meta.swatch_color }));
            // Prefer canonical ordered values from values_json if present; fall back to derived.
            let canonical = null;
            if (opt.values_json) {
                try {
                    const parsed = typeof opt.values_json === 'string' ? JSON.parse(opt.values_json) : opt.values_json;
                    if (Array.isArray(parsed)) {
                        canonical = parsed.map(v => ({
                            value: String(v.value || '').trim(),
                            value_ar: v.value_ar || null,
                            swatch_color: v.swatch_color || null
                        })).filter(v => v.value);
                    }
                } catch (e) { /* ignore malformed json */ }
            }
            opt.values = canonical && canonical.length > 0 ? canonical : derived;
            delete opt.values_json;
        });

        // Attach option selections to each variant
        const valuesByVariant = {};
        valueRows.forEach(r => {
            if (!valuesByVariant[r.variant_id]) valuesByVariant[r.variant_id] = [];
            valuesByVariant[r.variant_id].push({ option_id: r.option_id, value: r.value, value_ar: r.value_ar, swatch_color: r.swatch_color });
        });
        variants.forEach(v => {
            v.options = valuesByVariant[v.id] || [];
        });

        return { options, variants };
    }

    static async findById(variantId) {
        await ensureVariantImageUrlsColumn();
        const [rows] = await db.execute(
            `SELECT id, product_id, sku, price, offer_price, stock_quantity, image_url, image_urls, use_primary_image, is_active
             FROM product_variants WHERE id = ?`,
            [variantId]
        );
        const row = rows[0] || null;
        if (row) {
            const list = parseImageUrls(row.image_urls);
            row.image_urls = list.length > 0 ? list : (row.image_url ? [row.image_url] : []);
        }
        return row;
    }

    // Full-replace save inside a caller-provided transaction
    // options: [{ id?, name, name_ar, position }]
    // variants: [{ id?, sku, price, offer_price, stock_quantity, image_url, use_primary_image, is_active, options: [{ option_index, value, value_ar }] }]
    // Note: variants[].options[].option_index points at the position in the options[] array above (not DB id),
    //       because new options don't have a DB id yet on create.
    static async saveForProduct(conn, productId, options, variants) {
        await ensureVariantImageUrlsColumn();
        // Wipe existing variant data completely:
        // 1. product_variant_options are deleted by CASCADE from both sides
        // 2. product_variants must be deleted explicitly (they FK to products, not product_options)
        // 3. product_options CASCADE only removes product_variant_options, NOT product_variants
        await conn.execute('DELETE FROM product_variant_options WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)', [productId]);
        await conn.execute('DELETE FROM product_variants WHERE product_id = ?', [productId]);
        await conn.execute('DELETE FROM product_options WHERE product_id = ?', [productId]);

        if (!options || options.length === 0 || !variants || variants.length === 0) {
            await conn.execute('UPDATE products SET has_variants = 0 WHERE id = ?', [productId]);
            return;
        }

        // Insert options, capture DB ids by array index
        const optionIdByIndex = [];
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const valuesJson = Array.isArray(opt.values) && opt.values.length > 0
                ? JSON.stringify(opt.values.map(v => ({
                    value: String(v.value || '').trim(),
                    value_ar: v.value_ar ? String(v.value_ar).trim() : null,
                    swatch_color: v.swatch_color ? String(v.swatch_color).trim() : null
                })).filter(v => v.value))
                : null;
            const [res] = await conn.execute(
                'INSERT INTO product_options (product_id, name, name_ar, position, values_json) VALUES (?, ?, ?, ?, ?)',
                [productId, String(opt.name).trim(), opt.name_ar ? String(opt.name_ar).trim() : null, i, valuesJson]
            );
            optionIdByIndex.push(res.insertId);
        }

        for (const v of variants) {
            const variantOptions = (v.options || []).map(vo => ({
                option_id: optionIdByIndex[vo.option_index],
                value: String(vo.value).trim(),
                value_ar: vo.value_ar ? String(vo.value_ar).trim() : null,
                swatch_color: vo.swatch_color ? String(vo.swatch_color).trim() : null
            })).filter(vo => vo.option_id && vo.value);

            if (variantOptions.length !== options.length) continue; // skip malformed combos

            const signature = buildSignature(variantOptions);
            const price = Number(v.price) || 0;
            const offerPrice = v.offer_price !== undefined && v.offer_price !== null && v.offer_price !== ''
                ? Number(v.offer_price) : null;
            const stock = Number.isFinite(Number(v.stock_quantity)) ? parseInt(v.stock_quantity) : 0;
            const sku = v.sku ? String(v.sku).trim() : null;
            const usePrimary = v.use_primary_image === false || v.use_primary_image === 0 || v.use_primary_image === '0' ? 0 : 1;
            // Normalise image list. The first entry is the canonical variant image_url for legacy fallbacks.
            const imageList = (() => {
                if (usePrimary) return [];
                if (Array.isArray(v.image_urls)) {
                    return v.image_urls.map(s => String(s || '').trim()).filter(Boolean);
                }
                if (v.image_url) return [String(v.image_url)];
                return [];
            })();
            const imageUrl = imageList[0] || null;
            const imageUrlsJson = imageList.length > 0 ? JSON.stringify(imageList) : null;
            const isActive = v.is_active === false || v.is_active === 0 || v.is_active === '0' ? 0 : 1;
            const isDefault = v.is_default === true || v.is_default === 1 || v.is_default === '1' ? 1 : 0;

            const [res] = await conn.execute(
                `INSERT INTO product_variants
                 (product_id, sku, price, offer_price, stock_quantity, image_url, image_urls, use_primary_image, options_signature, is_active, is_default)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [productId, sku, price, offerPrice, stock, imageUrl, imageUrlsJson, usePrimary, signature, isActive, isDefault]
            );
            const variantId = res.insertId;

            for (const vo of variantOptions) {
                await conn.execute(
                    'INSERT INTO product_variant_options (variant_id, option_id, value, value_ar, swatch_color) VALUES (?, ?, ?, ?, ?)',
                    [variantId, vo.option_id, vo.value, vo.value_ar, vo.swatch_color]
                );
            }
        }

        await conn.execute('UPDATE products SET has_variants = 1 WHERE id = ?', [productId]);
    }

    // Decrement stock for a variant within a transaction
    static async decrementStock(conn, variantId, qty) {
        await conn.execute(
            'UPDATE product_variants SET stock_quantity = GREATEST(0, stock_quantity - ?) WHERE id = ?',
            [qty, variantId]
        );
    }

    // Returns enriched variant row with option labels for cart/order display
    static async getDisplayInfo(variantId) {
        const [rows] = await db.query(
            `SELECT pv.id, pv.product_id, pv.sku, pv.price, pv.offer_price, pv.stock_quantity, pv.image_url, pv.use_primary_image,
                    po.name AS option_name, po.name_ar AS option_name_ar, pvo.value, pvo.value_ar
             FROM product_variants pv
             JOIN product_variant_options pvo ON pvo.variant_id = pv.id
             JOIN product_options po ON po.id = pvo.option_id
             WHERE pv.id = ?
             ORDER BY po.position ASC, po.id ASC`,
            [variantId]
        );
        if (rows.length === 0) return null;

        const first = rows[0];
        return {
            id: first.id,
            product_id: first.product_id,
            sku: first.sku,
            price: Number(first.price),
            offer_price: first.offer_price !== null ? Number(first.offer_price) : null,
            stock_quantity: Number(first.stock_quantity),
            image_url: first.image_url,
            use_primary_image: Number(first.use_primary_image) === 1,
            options: rows.map(r => ({
                name: r.option_name,
                name_ar: r.option_name_ar,
                value: r.value,
                value_ar: r.value_ar
            }))
        };
    }
}

ProductVariant.buildSignature = buildSignature;

module.exports = ProductVariant;

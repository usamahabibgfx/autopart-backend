const Brand = require('../models/brand.model');
const generateUniqueSlug = require('../utils/generateSlug');
const db = require('../config/db');

let priorityColumnEnsured = false;
const ensurePriorityColumn = async () => {
    if (priorityColumnEnsured) return;
    // Add column if missing (fresh install)
    try { await db.query('ALTER TABLE brands ADD COLUMN priority INT NULL DEFAULT NULL AFTER is_active'); } catch (e) { /* already exists */ }
    // Migrate existing NOT NULL DEFAULT 0 column → allow NULL
    try { await db.query('ALTER TABLE brands MODIFY COLUMN priority INT NULL DEFAULT NULL'); } catch (e) { /* ignore */ }
    // Reset any 0s left from the previous migration to NULL
    try { await db.query('UPDATE brands SET priority = NULL WHERE priority = 0'); } catch (e) { /* ignore */ }
    priorityColumnEnsured = true;
};

const parsePriority = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = parseInt(raw, 10);
    return (Number.isFinite(n) && n >= 1) ? n : null;
};

const validatePriorityRange = async (priority, excludeId = 0) => {
    if (priority === null) return;
    const [[{ total }]] = await db.query(
        'SELECT COUNT(*) as total FROM brands WHERE id != ?',
        [excludeId]
    );
    const max = excludeId === 0 ? total + 1 : total;
    if (priority > max) {
        const err = new Error(`Priority ${priority} exceeds total brands (${max}). Enter a number between 1 and ${max}.`);
        err.statusCode = 422;
        throw err;
    }
};

const checkPriorityUnique = async (priority, excludeId = 0) => {
    if (priority === null) return;
    const [[{ cnt }]] = await db.query(
        'SELECT COUNT(*) as cnt FROM brands WHERE priority = ? AND id != ?',
        [priority, excludeId]
    );
    if (cnt > 0) {
        const err = new Error(`Priority ${priority} is already assigned to another brand. Each brand must have a unique priority.`);
        err.statusCode = 409;
        throw err;
    }
};

exports.getBrands = async (req, res, next) => {
    try {
        await ensurePriorityColumn();
        const { category, is_daily_offer, search, is_featured, is_limited, is_weekly, seller, minPrice, maxPrice, all } = req.query;

        if (all === '1' || all === 'true') {
            const brands = await Brand.findAll();
            return res.json({ success: true, data: brands });
        }

        const brands = await Brand.findActiveBrands({
            category,
            search,
            is_featured: is_featured === '1' || is_featured === 'true',
            is_limited_offer: is_limited === '1' || is_limited === 'true',
            is_weekly_deal: is_weekly === '1' || is_weekly === 'true',
            is_daily_offer: is_daily_offer === '1' || is_daily_offer === 'true',
            seller,
            minPrice: minPrice ? Number(minPrice) : null,
            maxPrice: maxPrice ? Number(maxPrice) : null
        });

        res.json({ success: true, data: brands });
    } catch (error) {
        next(error);
    }
};

exports.getBrand = async (req, res, next) => {
    try {
        const brand = await Brand.findBySlug(req.params.slug);
        if (!brand) {
            return res.status(404).json({ success: false, message: 'Brand not found' });
        }
        res.json({ success: true, data: brand });
    } catch (error) {
        next(error);
    }
};

exports.createBrand = async (req, res, next) => {
    try {
        const priority = parsePriority(req.body.priority);
        await validatePriorityRange(priority, 0);
        await checkPriorityUnique(priority);
        const slug = await generateUniqueSlug(req.body.name, 'brands');
        const data = {
            name: req.body.name,
            name_ar: req.body.name_ar || null,
            slug,
            image_url: req.body.image_url || null,
            image_url_ar: req.body.image_url_ar || null,
            banner_url_ar: req.body.banner_url_ar || null,
            priority
        };
        const id = await Brand.create(data);
        res.status(201).json({
            success: true,
            message: 'Brand created successfully',
            data: { id, ...data }
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: `Brand "${req.body.name}" already exists` });
        }
        next(error);
    }
};

exports.syncBrands = async (req, res, next) => {
    try {
        const { brands } = req.body;
        if (!brands || !Array.isArray(brands)) {
            return res.status(400).json({ success: false, message: 'Invalid brands data. Expected { brands: [...] }' });
        }

        let synced = 0;
        let failed = 0;
        const errors = [];

        for (const brand of brands) {
            try {
                const slug = await generateUniqueSlug(brand.name, 'brands');
                await Brand.upsert({
                    name: brand.name,
                    name_ar: brand.name_ar || null,
                    slug,
                    image_url: brand.image_url || brand.logo || null
                });
                synced++;
            } catch (err) {
                failed++;
                errors.push({ name: brand.name, error: err.message });
            }
        }

        const failedMsg = failed > 0 ? `, ${failed} failed` : '';
        res.json({
            success: true,
            message: `Synced ${synced} brands successfully${failedMsg}`,
            data: { synced, failed, errors: errors.length > 0 ? errors : undefined }
        });
    } catch (error) {
        next(error);
    }
};

exports.updateBrand = async (req, res, next) => {
    try {
        if (req.body.name) {
            req.body.slug = await generateUniqueSlug(req.body.name, 'brands', req.params.id);
        }
        if ('priority' in req.body) {
            const priority = parsePriority(req.body.priority);
            await validatePriorityRange(priority, req.params.id);
            await checkPriorityUnique(priority, req.params.id);
            req.body.priority = priority;
        }
        await Brand.update(req.params.id, req.body);
        res.json({ success: true, message: 'Brand updated' });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        next(error);
    }
};

exports.deleteBrand = async (req, res, next) => {
    try {
        // Block deletion when non-draft products are still using this brand.
        // Draft products are allowed because they aren't published.
        const [[{ count }]] = await db.query(
            "SELECT COUNT(*) as count FROM products WHERE brand_id = ? AND COALESCE(status, 'active') != 'draft'",
            [req.params.id]
        );
        if (count > 0) {
            return res.status(409).json({
                success: false,
                message: `Cannot delete this brand — ${count} active product${count === 1 ? '' : 's'} still use${count === 1 ? 's' : ''} it. Reassign or move them to draft first.`,
                productCount: count
            });
        }
        await Brand.delete(req.params.id);
        res.json({ success: true, message: 'Brand deleted' });
    } catch (error) {
        next(error);
    }
};

exports.deleteBrands = async (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid IDs' });
        }

        // Find brands that still have non-draft (published) products — these can't be deleted.
        const placeholders = ids.map(() => '?').join(',');
        const [blockedRows] = await db.query(
            `SELECT b.id, b.name, COUNT(p.id) as count
             FROM brands b
             JOIN products p ON p.brand_id = b.id
             WHERE b.id IN (${placeholders})
               AND COALESCE(p.status, 'active') != 'draft'
             GROUP BY b.id, b.name`,
            ids
        );

        const blockedIds = new Set(blockedRows.map(r => r.id));
        const deletableIds = ids.filter(id => !blockedIds.has(id));

        // Delete the safe ones; skip the rest.
        if (deletableIds.length > 0) {
            await Brand.bulkDelete(deletableIds);
        }

        const deleted = deletableIds.length;
        const skipped = blockedRows.length;

        // Build a concise message — frontend can also use the structured fields.
        let message;
        if (deleted > 0 && skipped === 0) {
            message = `Successfully deleted ${deleted} brand${deleted === 1 ? '' : 's'}.`;
        } else if (deleted > 0 && skipped > 0) {
            message = `Deleted ${deleted}, skipped ${skipped} (still in use).`;
        } else {
            // None deleted — all blocked.
            message = `${skipped} brand${skipped === 1 ? '' : 's'} couldn't be deleted (still in use).`;
        }

        res.status(deleted > 0 ? 200 : 409).json({
            success: deleted > 0,
            deleted,
            skipped,
            skippedDetails: blockedRows,
            message
        });
    } catch (error) {
        next(error);
    }
};

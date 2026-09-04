const Coupon = require('../models/coupon.model');

// Get all coupons (Admin)
exports.getCoupons = async (req, res, next) => {
    try {
        const coupons = await Coupon.getAll();
        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) {
        next(error);
    }
};

// Get available coupons (User)
exports.getAvailableCoupons = async (req, res, next) => {
    try {
        const coupons = await Coupon.getAvailable();
        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) {
        next(error);
    }
};

// Create a new coupon (Admin)
exports.createCoupon = async (req, res, next) => {
    try {
        const { code } = req.body;

        // Simple duplicate check (DB will also enforce unique constraint)
        const existing = await Coupon.findByCode(code);
        if (existing) {
            return res.status(400).json({ success: false, message: 'Coupon code already exists' });
        }

        const couponId = await Coupon.create(req.body);
        res.status(201).json({ success: true, message: 'Coupon created successfully', id: couponId });
    } catch (error) {
        next(error);
    }
};

// Update coupon (Admin)
exports.updateCoupon = async (req, res, next) => {
    try {
        await Coupon.update(req.params.id, req.body);
        res.json({ success: true, message: 'Coupon updated' });
    } catch (error) {
        next(error);
    }
};

// Delete coupon (Admin)
exports.deleteCoupon = async (req, res, next) => {
    try {
        await Coupon.delete(req.params.id);
        res.json({ success: true, message: 'Coupon deleted' });
    } catch (error) {
        next(error);
    }
};

// Validate coupon (User)
exports.validateCoupon = async (req, res, next) => {
    try {
        const { code, cart_total, items = [] } = req.body;
        const coupon = await Coupon.findByCode(code);

        if (!coupon) {
            return res.status(404).json({ success: false, message: 'Invalid coupon code' });
        }

        if (!coupon.is_active) {
            return res.status(400).json({ success: false, message: 'This coupon is inactive' });
        }

        if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date().setHours(0, 0, 0, 0)) {
            return res.status(400).json({ success: false, message: 'This coupon has expired' });
        }

        if (coupon.usage_limit > 0 && coupon.used_count >= coupon.usage_limit) {
            return res.status(400).json({ success: false, message: 'This coupon usage limit has been reached' });
        }

        if (cart_total < coupon.min_order_amount) {
            return res.status(400).json({ success: false, message: `Minimum order amount of AED ${coupon.min_order_amount} required` });
        }

        let applicableTotal = cart_total;
        let restricted = false;
        let restrictionMsg = '';

        // Check Brand Restrictions
        if (coupon.applicable_brands) {
            const allowedBrands = JSON.parse(coupon.applicable_brands);
            const applicableItems = items.filter(item => allowedBrands.includes(item.brand));

            if (applicableItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `This coupon is only valid for selected brands.`
                });
            }

            applicableTotal = applicableItems.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
            restricted = true;
            restrictionMsg = '(Valid for selected brands)';
        }

        // Check Product Restrictions
        if (coupon.applicable_products) {
            const allowedProducts = JSON.parse(coupon.applicable_products);
            const applicableItems = items.filter(item => allowedProducts.includes(item.name || item.id));

            if (applicableItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `This coupon is only valid for selected products.`
                });
            }

            // If brands were also restricted, we take the intersection
            const finalApplicableItems = coupon.applicable_brands
                ? items.filter(item => JSON.parse(coupon.applicable_brands).includes(item.brand) && allowedProducts.includes(item.name || item.id))
                : applicableItems;

            if (finalApplicableItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `This coupon is not valid for the items in your cart.`
                });
            }

            applicableTotal = finalApplicableItems.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
            restricted = true;
            restrictionMsg = '(Valid for selected items)';
        }

        let discountAmount = 0;
        const discountValue = parseFloat(coupon.discount_value);

        if (coupon.discount_type === 'percentage') {
            discountAmount = (applicableTotal * discountValue) / 100;
        } else {
            discountAmount = discountValue;
        }

        // Cap discount at applicable total (or cart total if not restricted)
        if (discountAmount > applicableTotal) discountAmount = applicableTotal;

        res.json({
            success: true,
            message: restricted
                ? `Coupon applied! ${restrictionMsg}`
                : 'Coupon applied successfully',
            data: {
                ...coupon,
                discount_amount: Number(discountAmount.toFixed(2))
            }
        });

    } catch (error) {
        next(error);
    }
};

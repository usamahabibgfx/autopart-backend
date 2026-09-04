const Category = require('../models/category.model');
const generateUniqueSlug = require('../utils/generateSlug');

exports.getCategories = async (req, res, next) => {
    try {
        const { brand, is_limited, is_weekly, is_daily, search } = req.query;
        const isLimited = is_limited === '1' || is_limited === 'true';
        const isWeekly = is_weekly === '1' || is_weekly === 'true';
        const isDaily = is_daily === '1' || is_daily === 'true';
        const searchTerm = (search || '').trim();
        const categories = brand
            ? await Category.findByBrand(brand)
            : searchTerm
                ? await Category.findBySearch(searchTerm)
                : (isLimited || isWeekly || isDaily)
                    ? await Category.findActiveByOffer({ is_limited_offer: isLimited, is_weekly_deal: isWeekly, is_daily_offer: isDaily })
                    : await Category.findAll();
        res.json({ success: true, data: categories });
    } catch (error) {
        next(error);
    }
};

exports.getCategory = async (req, res, next) => {
    try {
        const category = await Category.findBySlug(req.params.slug);
        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.json({ success: true, data: category });
    } catch (error) {
        next(error);
    }
};

exports.createCategory = async (req, res, next) => {
    try {
        const { name, name_ar, description, description_ar, image_url, banner_url, image_url_ar, banner_url_ar, is_active, parent_id, type, brands, order_index, show_on_home, home_poster_url, home_poster_url_ar } = req.body;
        const slug = await generateUniqueSlug(name, 'categories');
        const data = {
            name,
            name_ar: name_ar || null,
            slug,
            description: description || null,
            description_ar: description_ar || null,
            image_url: image_url || null,
            banner_url: banner_url || null,
            image_url_ar: image_url_ar || null,
            banner_url_ar: banner_url_ar || null,
            is_active: is_active !== undefined ? is_active : 1,
            parent_id: parent_id || null,
            type: type || 'main_category',
            brands: brands || [],
            order_index: order_index !== undefined && order_index !== null && order_index !== '' ? Number(order_index) : 0,
            show_on_home: show_on_home ? 1 : 0,
            home_poster_url: home_poster_url || null,
            home_poster_url_ar: home_poster_url_ar || null
        };
        const id = await Category.create(data);
        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            data: { id, ...data }
        });
    } catch (error) {
        next(error);
    }
};

exports.updateCategory = async (req, res, next) => {
    try {
        const id = req.params.id;
        const updateData = { ...req.body };
        if (updateData.name) {
            updateData.slug = await generateUniqueSlug(updateData.name, 'categories', id);
        }
        if (updateData.parent_id === '') updateData.parent_id = null;
        await Category.update(id, updateData);
        res.json({ success: true, message: 'Category updated' });
    } catch (error) {
        console.error('UPDATE ERROR:', error);
        next(error);
    }
};

exports.deleteCategory = async (req, res, next) => {
    try {
        await Category.delete(req.params.id);
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        next(error);
    }
};

const express = require('express');
const { getCategories, getCategory, createCategory, updateCategory, deleteCategory } = require('../controllers/category.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

const router = express.Router();

router.route('/')
    .get(getCategories)
    .post(protect, authorize('admin'), createCategory);

router.route('/:slug')
    .get(getCategory);

router.route('/:id')
    .put(protect, authorize('admin'), updateCategory)
    .delete(protect, authorize('admin'), deleteCategory);

module.exports = router;

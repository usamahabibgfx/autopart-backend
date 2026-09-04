const express = require('express');
const { getHomepageCms } = require('../controllers/cms.controller');
const { getActivePromotions } = require('../controllers/admin.controller');

const router = express.Router();

// @desc    Get homepage CMS content
// @route   GET /api/v1/cms/homepage
router.get('/homepage', getHomepageCms);

// @desc    Get active promotions matching a page key
// @route   GET /api/v1/cms/promotions/active?page=<key>
router.get('/promotions/active', getActivePromotions);

module.exports = router;

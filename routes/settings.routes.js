const express = require('express');
const { getSettings, updateSettings } = require('../controllers/settings.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

const router = express.Router();

// GET settings is public (can be used by frontend checkout page)
router.get('/', getSettings);

// PUT settings is restricted to Admin
router.put('/', protect, authorize('admin'), updateSettings);

module.exports = router;

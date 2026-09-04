const db = require('../config/db');

// @desc    Get all settings
// @route   GET /api/v1/settings
// @access  Public
exports.getSettings = async (req, res, next) => {
    try {
        // Ensure table exists (Lazy Migration)
        await db.query(`
            CREATE TABLE IF NOT EXISTS settings (
                \`key\` VARCHAR(100) PRIMARY KEY,
                \`value\` TEXT,
                \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        const [rows] = await db.query('SELECT * FROM settings');
        
        // Format as an object for easier frontend use
        const settings = (rows || []).reduce((acc, row) => {
            if (row && row.key) {
                acc[row.key] = row.value;
            }
            return acc;
        }, {});

        // Add default values if missing
        if (!settings.points_per_aed) settings.points_per_aed = '1';
        if (!settings.aed_per_point) settings.aed_per_point = '0.01'; // Default 100 points = 1 AED

        res.json({ success: true, data: settings });
    } catch (error) {
        console.error('[SETTINGS] Fetch Error:', error.message);
        next(error);
    }
};

// @desc    Update settings
// @route   PUT /api/v1/settings
// @access  Private/Admin
exports.updateSettings = async (req, res, next) => {
    try {
        const { settings } = req.body; // Expecting { points_per_aed: '1', aed_per_point: '0.01' }

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid settings data' });
        }

        for (const [key, value] of Object.entries(settings)) {
            await db.query(`
                INSERT INTO settings (\`key\`, \`value\`) 
                VALUES (?, ?) 
                ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
            `, [key, String(value)]);
        }

        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
        next(error);
    }
};

// Helper function for other controllers to get a specific setting
exports.getSettingValue = async (key, defaultValue) => {
    try {
        const [rows] = await db.query('SELECT \`value\` FROM settings WHERE \`key\` = ?', [key]);
        return rows[0] ? rows[0].value : defaultValue;
    } catch (err) {
        console.error(`Error fetching setting ${key}:`, err);
        return defaultValue;
    }
};

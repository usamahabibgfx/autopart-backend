const jwt = require('jsonwebtoken');
const db = require('../config/db');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token || token === 'none') {
        return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [rows] = await db.execute(
            'SELECT u.id, u.name, u.email, r.name as role FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
            [decoded.id]
        );

        if (rows.length === 0) {
            console.log(`[AUTH] User not found for ID: ${decoded.id}`);
            return res.status(401).json({ success: false, message: 'Not authorized, user not found' });
        }

        req.user = rows[0];
        next();
    } catch (error) {
        console.error(error);
        res.status(401).json({ success: false, message: 'Not authorized' });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};

// Allows admin unconditionally; allows staff if they hold any of the given permission keys.
// Fetches staff_permissions from DB lazily — only for staff users.
const authorizeAdminOrStaff = (...permKeys) => {
    return async (req, res, next) => {
        if (req.user.role === 'admin') return next();

        if (req.user.role === 'staff') {
            try {
                const [rows] = await db.execute(
                    'SELECT staff_permissions FROM users WHERE id = ?',
                    [req.user.id]
                );
                let perms = [];
                if (rows.length > 0) {
                    const raw = rows[0].staff_permissions;
                    perms = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
                }
                if (permKeys.some(k => perms.includes(k))) return next();
            } catch (e) {
                console.error('[authorizeAdminOrStaff] Error fetching staff permissions:', e.message);
            }
        }

        return res.status(403).json({ success: false, message: 'Not authorized to access this section' });
    };
};

// Like protect, but doesn't block if no token — just sets req.user if possible
const optionalProtect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token || token === 'none') {
        return next(); // No token — proceed as guest
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await db.execute(
            'SELECT u.id, u.name, u.email, r.name as role FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
            [decoded.id]
        );
        if (rows.length > 0) {
            req.user = rows[0];
        }
    } catch (error) {
        // Invalid token — proceed as guest, don't block
        console.warn('[optionalProtect] Invalid token, proceeding as guest');
    }

    next();
};

module.exports = { protect, authorize, authorizeAdminOrStaff, optionalProtect };

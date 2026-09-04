/**
 * Custom XSS Sanitization Middleware
 * Replaces xss-clean (which is incompatible with Express 5)
 * Recursively strips dangerous HTML/script content from req.body, req.query, req.params
 */

const sanitizeValue = (value) => {
    if (typeof value !== 'string') return value;

    return value
        // Remove <script> tags and their content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove on* event handlers (onclick, onerror, onload, etc.)
        .replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
        // Remove javascript: protocol in href/src attributes
        .replace(/(?:href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
        // Remove data: protocol for non-image types (allow data:image for base64 images)
        .replace(/(?:href|src)\s*=\s*(?:"data:(?!image)[^"]*"|'data:(?!image)[^']*')/gi, '')
        // Remove <iframe>, <object>, <embed> tags
        .replace(/<(iframe|object|embed|form|input|textarea|button)\b[^>]*>/gi, '')
        .replace(/<\/(iframe|object|embed|form|input|textarea|button)>/gi, '');
};

const sanitizeObject = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeValue(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);

    if (typeof obj === 'object') {
        const sanitized = {};
        for (const key of Object.keys(obj)) {
            sanitized[key] = sanitizeObject(obj[key]);
        }
        return sanitized;
    }

    return obj;
};

const sanitize = (req, res, next) => {
    if (req.body) req.body = sanitizeObject(req.body);
    if (req.query) req.query = sanitizeObject(req.query);
    if (req.params) req.params = sanitizeObject(req.params);
    next();
};

module.exports = sanitize;

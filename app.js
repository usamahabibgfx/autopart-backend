const express = require('express'); // Backend Sync - 2026-03-26 v1.0.1
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const errorHandler = require('./middlewares/error.middleware');
const helmet = require('helmet');
const hpp = require('hpp');
const sanitize = require('./middlewares/sanitize.middleware');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// Load env vars
dotenv.config({
    path: [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../.env')],
});

// Route files
const authRoutes = require('./routes/auth.routes');
const productRoutes = require('./routes/product.routes');
const categoryRoutes = require('./routes/category.routes');
const brandRoutes = require('./routes/brand.routes');
const cartRoutes = require('./routes/cart.routes');
const orderRoutes = require('./routes/order.routes');
const userRoutes = require('./routes/user.routes');
const wishlistRoutes = require('./routes/wishlist.routes');
const adminRoutes = require('./routes/admin.routes');
const sellerRoutes = require('./routes/seller.routes');
const couponRoutes = require('./routes/coupon.routes');
const uploadRoutes = require('./routes/upload.routes');
const reviewRoutes = require('./routes/review.routes');
const quotationRoutes = require('./routes/quotation.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const contactRoutes = require('./routes/contact.routes');
const cmsRoutes = require('./routes/cms.routes');
const settingsRoutes = require('./routes/settings.routes');
const verifyRoutes = require('./routes/verify.routes');
const cookieParser = require('cookie-parser');

const app = express();

// Trust proxy (required for Render, Heroku, etc. behind reverse proxy)
app.set('trust proxy', 1);


// Body parser with raw body support for Stripe webhooks
app.use(express.json({
    limit: '15mb', // large enough for base64-encoded invoice PDFs
    verify: (req, res, buf) => {
        if (req.originalUrl.startsWith('/api/v1/orders/webhook/stripe')) {
            req.rawBody = buf;
        }
    }
}));

// Set security headers with Content Security Policy
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://connect.facebook.net",
                "https://js.stripe.com"
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https://www.google-analytics.com",
                "https://www.facebook.com",
                "https://*.stripe.com",
                "https://lh3.googleusercontent.com",
                process.env.FRONTEND_URL || 'http://localhost:3000'
            ],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            connectSrc: [
                "'self'",
                "https://www.google-analytics.com",
                "https://analytics.google.com",
                "https://www.facebook.com",
                "https://api.stripe.com",
                process.env.FRONTEND_URL || 'http://localhost:3000'
            ],
            frameSrc: ["'self'", "https://js.stripe.com", "https://www.facebook.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
}));

// Prevent HTTP param pollution
app.use(hpp());

// Enable CORS
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.0.100:3000',
    'https://uae.bestsignatureautoparts.com',
    'https://bestsignatureautoparts.com',
    'https://www.bestsignatureautoparts.com',
    'https://api.bestsignatureautoparts.com',
    ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(s => s.trim()) : [])
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith('.vercel.app'))) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Rejected origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));

// Global Rate Limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 requests per windowMs
    message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', globalLimiter);

// Specific Rate Limiter for sensitive routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // Limit each IP to 30 login/register requests per 15 minutes
    message: { success: false, message: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Cookie parser
app.use(cookieParser());

// XSS Sanitization (custom middleware, replaces xss-clean for Express 5 compatibility)
app.use(sanitize);


// Serve static files from uploads directory with cross-origin policy
app.use(['/uploads', '/product_images'], (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});
// UPLOAD_DIR lets uploads live OUTSIDE the project so they survive code updates/redeploys.
// Resolved relative to the app root (e.g. "../uploads" = sibling folder) or used as-is if
// absolute. Must match the destination in middlewares/upload.middleware.js.
const uploadsPath = process.env.UPLOAD_DIR
    ? path.resolve(__dirname, process.env.UPLOAD_DIR)
    : path.join(__dirname, 'uploads');


console.log("cwd =", process.cwd());
console.log("__dirname =", __dirname);
console.log("uploadsPath =", uploadsPath);
console.log("uploads exists =", fs.existsSync(uploadsPath));

app.use('/uploads', express.static(uploadsPath));

app.get('/debug-upload', (req, res) => {
    const fs = require('fs');

    res.json({
        cwd: process.cwd(),
        dirname: __dirname,
        uploadsPath,
        uploadsExists: fs.existsSync(uploadsPath),
        brandsExists: fs.existsSync(path.join(uploadsPath, 'brands')),
        tecnodomExists: fs.existsSync(
            path.join(uploadsPath, 'brands', 'tecnodom.webp')
        )
    });
});
app.use('/product_images', express.static(uploadsPath));

// Dev logging middleware
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// Mount routers
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/contact', authLimiter, contactRoutes); // Also limit contact form
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/brands', brandRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/seller', sellerRoutes);
app.use('/api/v1/coupons', couponRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/quotations', quotationRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
// app.use('/api/v1/contact', contactRoutes); // Moved up with limiter
app.use('/api/v1/cms', cmsRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/verify', verifyRoutes);

// Welcome route
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Best Signature New Auto Spare Parts API' });
});

app.use((req, res, next) => {
    console.log(`404: METHOD ${req.method} URL ${req.originalUrl}`);
    res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
});

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;

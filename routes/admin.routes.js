const express = require('express');
const {
    getDashboardStats,
    getAllUsers,
    createUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
    adjustUserPoints,
    getAllOrders,
    updateHomepageCMS,
    getHeroSlides,
    addHeroSlide,
    updateHeroSlide,
    deleteHeroSlide,
    getHeroPosters,
    addHeroPoster,
    updateHeroPoster,
    deleteHeroPoster,
    getPromotions,
    addPromotion,
    updatePromotion,
    deletePromotion,
    exportProducts,
    exportOrders,
    getRoles,
    notifyOfferByEmail
} = require('../controllers/admin.controller');
const { getAllReviews } = require('../controllers/review.controller');
const { adminGetTrendingProducts, adminSetTrendingProducts } = require('../controllers/product.controller');
const { protect, authorize, authorizeAdminOrStaff } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

// Dashboard / SEO / Analytics all draw from the same stats endpoint
router.get('/stats', authorizeAdminOrStaff('dashboard', 'seo', 'analytics'), getDashboardStats);

// Roles — any admin or staff with users permission (needed for user create/edit dropdowns)
router.get('/roles', authorizeAdminOrStaff('users'), getRoles);

// Users CRUD — delete is admin-only (destructive)
router.route('/users')
    .get(authorizeAdminOrStaff('users'), getAllUsers)
    .post(authorizeAdminOrStaff('users'), createUser);

router.route('/users/:id')
    .put(authorizeAdminOrStaff('users'), updateUser)
    .delete(authorize('admin'), deleteUser);

router.patch('/users/:id/status', authorizeAdminOrStaff('users'), toggleUserStatus);
router.post('/users/:id/points', authorizeAdminOrStaff('users'), adjustUserPoints);

// Orders
router.route('/orders')
    .get(authorizeAdminOrStaff('orders'), getAllOrders);

// CMS
router.route('/cms/homepage')
    .put(authorizeAdminOrStaff('cms'), updateHomepageCMS);

router.route('/cms/hero-slides')
    .get(authorizeAdminOrStaff('cms'), getHeroSlides)
    .post(authorizeAdminOrStaff('cms'), addHeroSlide);

router.route('/cms/hero-slides/:id')
    .put(authorizeAdminOrStaff('cms'), updateHeroSlide)
    .delete(authorizeAdminOrStaff('cms'), deleteHeroSlide);

router.route('/cms/hero-posters')
    .get(authorizeAdminOrStaff('cms'), getHeroPosters)
    .post(authorizeAdminOrStaff('cms'), addHeroPoster);

router.route('/cms/hero-posters/:id')
    .put(authorizeAdminOrStaff('cms'), updateHeroPoster)
    .delete(authorizeAdminOrStaff('cms'), deleteHeroPoster);

router.route('/cms/promotions')
    .get(authorizeAdminOrStaff('cms'), getPromotions)
    .post(authorizeAdminOrStaff('cms'), addPromotion);

router.route('/cms/promotions/:id')
    .put(authorizeAdminOrStaff('cms'), updatePromotion)
    .delete(authorizeAdminOrStaff('cms'), deletePromotion);

// Offer email notification
router.post('/products/:id/notify-offer', authorizeAdminOrStaff('products'), notifyOfferByEmail);

// Trending products (search dropdown curation)
router.route('/trending-products')
    .get(authorizeAdminOrStaff('cms'), adminGetTrendingProducts)
    .put(authorizeAdminOrStaff('cms'), adminSetTrendingProducts);

// Exports — admin only
router.get('/export/products', authorize('admin'), exportProducts);
router.get('/export/orders', authorize('admin'), exportOrders);

// Reviews
router.route('/reviews')
    .get(authorizeAdminOrStaff('reviews'), getAllReviews);

module.exports = router;

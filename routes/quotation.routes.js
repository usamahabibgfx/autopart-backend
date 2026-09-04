const express = require('express');
const { createQuotation, getMyQuotations, deleteQuotation, getQuotations, sendEmailWithPdf, sendSoftwareQuotationEmail } = require('../controllers/quotation.controller');
const { protect, authorize, optionalProtect } = require('../middlewares/auth.middleware');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const quotationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { success: false, message: 'Too many quotation requests from this IP, please try again after an hour' }
});

router.post('/', optionalProtect, quotationLimiter, createQuotation);
router.post('/software-email', quotationLimiter, sendSoftwareQuotationEmail);
router.post('/:id/send-email', sendEmailWithPdf);
router.get('/', protect, authorize('admin'), getQuotations);
router.get('/my-quotations', protect, getMyQuotations);
router.delete('/:id', protect, deleteQuotation);

module.exports = router;

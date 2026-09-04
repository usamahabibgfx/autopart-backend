const express = require('express');
const { createInvoice, getInvoices, getInvoice, checkInvoice } = require('../controllers/invoice.controller');
const { protect, authorize, authorizeAdminOrStaff } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

router.route('/check')
    .get(authorizeAdminOrStaff('orders'), checkInvoice);

router.route('/')
    .get(authorizeAdminOrStaff('invoices'), getInvoices)
    .post(authorizeAdminOrStaff('orders'), createInvoice);

router.route('/:id')
    .get(authorizeAdminOrStaff('invoices'), getInvoice);

module.exports = router;

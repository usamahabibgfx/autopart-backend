const User = require('../models/user.model');
const Address = require('../models/address.model');
const db = require('../config/db');

exports.getProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

// Points statement for the logged-in user: earned / redeemed / expired entries.
exports.getRewardHistory = async (req, res, next) => {
    try {
        const [rows] = await db.query(
            `SELECT id, points, transaction_type, order_id, description, created_at
             FROM reward_points_history
             WHERE user_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 100`,
            [req.user.id]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
};

exports.getAddresses = async (req, res, next) => {
    try {
        const addresses = await Address.getByUser(req.user.id);
        res.json({ success: true, data: addresses });
    } catch (error) {
        next(error);
    }
};

exports.addAddress = async (req, res, next) => {
    try {
        const addressId = await Address.create(req.user.id, req.body);
        res.status(201).json({ success: true, data: { id: addressId, ...req.body } });
    } catch (error) {
        next(error);
    }
};

exports.deleteAddress = async (req, res, next) => {
    try {
        await Address.delete(req.user.id, req.params.id);
        res.json({ success: true, message: 'Address deleted' });
    } catch (error) {
        next(error);
    }
};

exports.updateAddress = async (req, res, next) => {
    try {
        await Address.update(req.user.id, req.params.id, req.body);
        res.json({ success: true, data: { id: parseInt(req.params.id), ...req.body } });
    } catch (error) {
        next(error);
    }
};

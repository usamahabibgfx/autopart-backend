const errorHandler = (err, req, res, next) => {
    // Log the error with request details
    console.error(`[ERROR] ${req.method} ${req.originalUrl}`);
    console.error(err.stack || err);

    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';

    // Handle specific CORS errors from middleware
    if (err.message === 'Not allowed by CORS') {
        statusCode = 403;
    }

    res.status(statusCode).json({
        success: false,
        message: message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack
    });
};

module.exports = errorHandler;

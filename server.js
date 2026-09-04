const dotenv = require('dotenv');
const path = require('path');
// Production hosts inject variables at process start; local files only fill gaps.
dotenv.config({
    path: [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../.env')],
});

console.log('[BOOT] cwd =', process.cwd());
console.log('[BOOT] DB_USER =', JSON.stringify(process.env.DB_USER));
console.log('[BOOT] DB_PASSWORD present =', !!process.env.DB_PASSWORD);
console.log('[BOOT] DB_NAME =', JSON.stringify(process.env.DB_NAME));

const app = require('./app');

const startServer = async () => {
    try {

        // Initialize database and migrations FIRST
        const { initDb } = require('./config/init');
        await initDb();

        const PORT = process.env.PORT || 5000;
        const server = app.listen(PORT, () => {
            console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        });

        // Verify SMTP email connection on startup
        const { verifySmtpConnection } = require('./utils/sendEmail');
        verifySmtpConnection();

        // Clear expired offer flags on startup and every hour
        const { startOfferCleanupJob } = require('./utils/offerCleanup');
        startOfferCleanupJob();

        // Start abandoned cart reminder cron (every 30 min)
        const { startAbandonedCartJob } = require('./services/abandonedCart.service');
        startAbandonedCartJob();

        // Start monthly reward-points e-statement job (fires on the 1st)
        const { startPointsStatementJob } = require('./services/pointsStatement.service');
        startPointsStatementJob();

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (err) => {
            console.log(`Error: ${err.message}`);
            server.close(() => process.exit(1));
        });
    } catch (error) {
        console.error('Failed to start server:', error.message);
        process.exit(1);
    }
};

startServer();

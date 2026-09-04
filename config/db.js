const mysql = require('mysql2');

console.log('[DEBUG] DB_HOST =', JSON.stringify(process.env.DB_HOST));
console.log('[DEBUG] DB_USER =', JSON.stringify(process.env.DB_USER));
console.log('[DEBUG] DB_PASSWORD present?', !!process.env.DB_PASSWORD);
console.log('[DEBUG] DB_PASS present?', !!process.env.DB_PASS);
console.log('[DEBUG] DB_NAME =', JSON.stringify(process.env.DB_NAME));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ...(process.env.DB_SSL === 'true' && {
    ssl: { rejectUnauthorized: false }
  })
});

const promisePool = pool.promise();

// Test connection
promisePool.getConnection()
  .then(connection => {
    console.log('Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
  });

module.exports = promisePool;

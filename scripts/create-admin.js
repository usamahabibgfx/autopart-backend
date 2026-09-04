const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function createAdmin() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
    });

    try {
        const name = 'Admin User';
        const email = 'admin@bestsignatureautoparts.com';
        const password = 'admin123';
        const roleName = 'admin';

        console.log(`Creating admin user: ${email}...`);

        // Check if role exists
        const [roles] = await connection.execute('SELECT id FROM roles WHERE name = ?', [roleName]);
        if (roles.length === 0) {
            console.error('Error: Admin role not found in database.');
            return;
        }
        const roleId = roles[0].id;

        // Check if user exists
        const [existing] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            console.log('Admin user already exists.');
        } else {
            const hashedPassword = await bcrypt.hash(password, 10);
            await connection.execute(
                'INSERT INTO users (name, email, password, role_id, reward_points) VALUES (?, ?, ?, ?, ?)',
                [name, email, hashedPassword, roleId, 1000]
            );
            console.log('✅ Admin user created successfully!');
            console.log(`Email: ${email}`);
            console.log(`Password: ${password}`);
        }
    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        await connection.end();
    }
}

createAdmin();

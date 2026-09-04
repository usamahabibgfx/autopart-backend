const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const setup = async () => {
    // Connection without database to create it
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        multipleStatements: true
    });

    try {
        console.log('--- Database Setup Started ---');

        // 1. Create Database if not exists
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        await connection.query(`USE ${process.env.DB_NAME}`);
        console.log(`Database '${process.env.DB_NAME}' ensured.`);

        // 2. Execute Schema
        const schemaPath = path.join(__dirname, '..', 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await connection.query(schemaSql);
        console.log('Schema imported successfully.');

        // 3. Create Admin User
        const adminName = 'Admin User';
        const adminEmail = 'admin@bestsignatureautoparts.com';
        const adminPassword = 'admin123_secure'; // You should change this later
        const hashedPw = await bcrypt.hash(adminPassword, 10);

        // Check if admin already exists
        const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [adminEmail]);

        if (existing.length === 0) {
            // Get admin role ID
            const [roles] = await connection.query('SELECT id FROM roles WHERE name = "admin"');
            const adminRoleId = roles[0].id;

            await connection.query(
                'INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)',
                [adminName, adminEmail, hashedPw, adminRoleId]
            );

            console.log('\n--- Admin Created Successfully ---');
            console.log(`Email: ${adminEmail}`);
            console.log(`Password: ${adminPassword}`);
            console.log('----------------------------------\n');
        } else {
            console.log('Admin user already exists.');
        }

    } catch (error) {
        console.error('Error during setup:', error.message);
    } finally {
        await connection.end();
        process.exit();
    }
};

setup();

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        console.log('Creating homepage_cms table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS homepage_cms (
                id INT AUTO_INCREMENT PRIMARY KEY,
                section_name VARCHAR(100) NOT NULL UNIQUE,
                content_data JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log('Seeding default homepage data...');
        const defaultHero = {
            title: "Premium Commercial Kitchen & Laundry Solutions",
            subtitle: "Elevate your business with state-of-the-art equipment from global brands. Reliability meets innovation.",
            image_url: "/hero-bg.jpg",
            button_text: "Browse Collection",
            button_link: "/shop"
        };

        const defaultAnnouncement = {
            text: "Free delivery on orders over AED 5,000 across UAE! | 24/7 Support Available",
            is_active: true
        };

        await connection.execute(`
            INSERT INTO homepage_cms (section_name, content_data) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE content_data = VALUES(content_data)
        `, ['hero', JSON.stringify(defaultHero)]);

        await connection.execute(`
            INSERT INTO homepage_cms (section_name, content_data) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE content_data = VALUES(content_data)
        `, ['announcement', JSON.stringify(defaultAnnouncement)]);

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await connection.end();
    }
}

migrate();

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
        console.log('Creating hero_slides table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS hero_slides (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tagline VARCHAR(255),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                image VARCHAR(255) NOT NULL,
                accent VARCHAR(20) DEFAULT '#ff3b30',
                btnText VARCHAR(100) DEFAULT 'Shop Now',
                link VARCHAR(255) DEFAULT '/shopnow',
                order_index INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Migrate existing data from homepage_cms if it exists
        const [rows] = await connection.execute("SELECT content_data FROM homepage_cms WHERE section_name = 'hero'");
        if (rows.length > 0) {
            let slides = rows[0].content_data;
            if (typeof slides === 'string') slides = JSON.parse(slides);
            if (Array.isArray(slides)) {
                console.log(`Migrating ${slides.length} slides to the new table...`);
                for (let i = 0; i < slides.length; i++) {
                    const s = slides[i];
                    await connection.execute(`
                        INSERT INTO hero_slides (tagline, title, description, image, accent, btnText, link, order_index)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [s.tagline, s.title, s.description, s.image, s.accent, s.btnText, s.link, i]);
                }
            }
        } else {
            // Seed default if nothing to migrate
            console.log('Seeding default slides...');
            await connection.execute(`
                INSERT INTO hero_slides (tagline, title, description, image, accent, btnText, link, order_index)
                VALUES 
                ('BEST SIGNATURE AUTO PARTS', 'Premium Cookware & Auto Spare Parts', 'Discover our exclusive collection of genuine, OEM, and quality automotive spare parts trusted by chefs worldwide.', '/assets/banner.webp', '#ff3b30', 'Shop Now', '/shopnow', 0),
                ('QUALITY YOU CAN TRUST', 'Professional Grade Auto Spare Parts', 'From commercial kitchens to your home — experience the difference of premium kitchen technology.', 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?q=80&w=1470&auto=format&fit=crop', '#0056b3', 'Shop Now', '/shopnow', 1)
            `);
        }

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await connection.end();
    }
}

migrate();

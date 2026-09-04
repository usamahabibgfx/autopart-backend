const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function seedExistingSlides() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        const existingSlides = [
            {
                tagline: "BEST SIGNATURE AUTO PARTS",
                title: "Premium Cookware & Auto Spare Parts",
                description: "Discover our exclusive collection of genuine, OEM, and quality automotive spare parts trusted by chefs worldwide.",
                image: "/assets/banner.webp",
                accent: "#ff3b30",
                btnText: "Shop Now",
                link: "/shopnow"
            },
            {
                tagline: "QUALITY YOU CAN TRUST",
                title: "Professional Grade Auto Spare Parts",
                description: "From commercial kitchens to your home — experience the difference of premium kitchen technology.",
                image: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?q=80&w=1470&auto=format&fit=crop",
                accent: "#0056b3",
                btnText: "Shop Now",
                link: "/shopnow"
            }
        ];

        console.log('Syncing existing slides to database...');
        await connection.execute(`
            INSERT INTO homepage_cms (section_name, content_data) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE content_data = VALUES(content_data)
        `, ['hero', JSON.stringify(existingSlides)]);

        console.log('Successfully imported existing slides into CMS.');
    } catch (error) {
        console.error('Failed to sync slides:', error);
    } finally {
        await connection.end();
    }
}

seedExistingSlides();

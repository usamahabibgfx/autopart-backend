const db = require('../config/db');
const slugify = require('slugify');

const categories = [
    "ACCESSORIES", "Bakery Display", "BAKERY LINE", "Bakery Mixers", "Bakery Oven", "Bar Vacuum Machine", "Base Cabinet",
    "Blenders", "Bread Maker", "Bread Slicer", "Cabinets", "Cheese Grater", "Cheese Warmer", "Chocolate Fountain",
    "Chocolate Machine", "COFFEE & BAR LINE", "Coffee Grinder", "Coffee Machines", "Combi Oven", "Cone Baker",
    "Cooker", "COOKING LINE", "Crepe Maker", "Cutter Mixer", "Dish Washer Machines", "Display Chiller", "Donut maker",
    "DRY STORE", "Fabrication", "fimar", "Meat Slicer & Bone Saw", "Fish Display", "FOOD PROCESSING", "Food Warmers",
    "Freezer & Chillers", "Fryers", "Furniture", "Grease Seperator", "Grills", "Hamburger Press", "Hood", "Hot Dog Machine",
    "Hotdog Maker", "Ice Cream Display", "Ice Cream Machines", "Ice Cream powder", "Ice Crusher", "ICE MAKER & FLAKES",
    "Insect Killer", "Installation Kits", "Ironing Equipment", "Juice Maker", "Auto Spare Parts", "kitchen ware",
    "Knife Sterilizers", "LAMP", "LAUNDRY & DISH WASHER", "Laundry Machines", "Limited Sale", "MBM SALE", "Meat Display",
    "Meat Mincer", "Microwave", "National Day Offer", "Offer", "Oven", "Packing Machines", "Pan Cake Maker",
    "Pasta Accessories", "Pasta Cooker", "Pasta Maker", "REFRIGERATION LINE", "Refrigerator", "Rice Cooker",
    "Rolling Machine", "Round Bin", "Salamander", "sale", "sale 11.11", "SALE RATIONAL", "Sandwich Maker",
    "Scales & POS", "Series 600", "Series 700", "Series 900", "Shawarma Knife", "Shawarma Machines", "Sheets",
    "Shelves", "SINK", "Slush Machine", "Smokers", "SNACK MAKER", "SOUS-VIDE COOKING", "Special Offer",
    "SPIRAL KNEADER", "stainless steel", "Supermarket Display", "SUPERMARKET EQUIPMENT", "Tables", "Tandoori Oven",
    "Tea Maker", "Tilting pan & Boiling pan", "Toaster", "Top Brands", "Tray", "Uncategorized", "Vegtable Equipment",
    "Waffle Maker", "Wall Cabinet", "Water Boiler", "Work Tables"
];

async function insertCategories() {
    console.log(`Starting insertion of ${categories.length} categories...`);
    for (const cat of categories) {
        try {
            const slug = slugify(cat, { lower: true });
            // Check if exists
            const [existing] = await db.execute('SELECT id FROM categories WHERE name = ?', [cat]);
            if (existing.length === 0) {
                await db.execute('INSERT INTO categories (name, slug) VALUES (?, ?)', [cat, slug]);
                console.log(`Inserted: ${cat}`);
            } else {
                console.log(`Skipped (already exists): ${cat}`);
            }
        } catch (error) {
            console.error(`Error inserting ${cat}:`, error.message);
        }
    }
    console.log('✅ Category insertion complete.');
    process.exit(0);
}

insertCategories();

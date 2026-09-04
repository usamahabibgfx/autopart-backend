const slugify = require('slugify');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });
const db = require('../config/db');

const data = [
    {
        name: "Engine Parts",
        brands: ["SAB", "GRINDMASTER", "ANFIM", "GHS", "LAMAAZOCCO", "PANCILIO SPECIALTY", "MAHILKONIG", "BUNN"],
        subs: [
            {
                name: "Espresso Machines",
                subsubs: ["Volumetric Espresso Machines", "Gravimetric Espresso Machines"]
            },
            {
                name: "Coffee Grinders",
                subsubs: ["Espresso Grinders", "Brewed Coffee Grinders"]
            },
            {
                name: "Coffee & Tea Brewers",
                subsubs: ["Pour Overs", "Water Boilers", "Filters", "Tea Makers"]
            }
        ]
    },
    {
        name: "Cooling system parts",
        brands: ["snooker", "Scotsman", "VOLGA", "WATERFILTER"],
        subs: [
            { name: "Ice Cube", subsubs: [] },
            { name: "Ice Flakers", subsubs: [] },
            { name: "Ice Bin", subsubs: [] }
        ]
    },
    {
        name: "Cooking equipment",
        brands: ["MBM", "STELCO", "VULCAN", "STAR", "PITCO", "CAPINOX", "RM GASTRO", "DEXION", "MEC", "ROLLER GRILL", "PASTALINE", "FIMAR", "WARING", "BIMATIC", "AILIPU", "VITO", "ELECTROLUX", "FRYMASTER", "HANNY PENNY", "IMPERIAL", "SOTHBEND", "TOASTMASTER", "FAGOR", "STILKO", "SHEFFIELDS", "SALVA", "REFOX", "RATIONAL", "APW WYOTT"],
        subs: [
            {
                name: "Commercial Griddles & Accessories",
                subsubs: ["Gas Griddles", "Electric Griddles"]
            },
            {
                name: "Automotive Business Ranges",
                subsubs: ["Gas Ranges", "Electric Ranges", "Countertop Ranges", "Induction Ranges"]
            },
            {
                name: "Toasters and Panini Grills",
                subsubs: ["Conveyor Toasters", "Panini Grills", "Pop-Up Toasters"]
            },
            {
                name: "Waffle and Crepe Machines",
                subsubs: ["Waffle Irons", "Baking Plates", "Crepe Makers"]
            },
            {
                name: "Char broilers",
                subsubs: ["Radiant Char broilers", "Lava Rock Char broilers"]
            },
            {
                name: "Specialty Engine & Mechanical Parts",
                subsubs: ["Electric Char broilers", "Sous Vide Machines", "Pasta Cookers", "Salamander Grills", "Shawarma Machines", "Specialty Equipment", "Steam Kettles & Braising Pans"]
            },
            {
                name: "Commercial fryer",
                subsubs: ["Gas fryer", "Electric fryer", "Pressure fryer", "Oil Filtration and Accessories", "Fry Dump Stations"]
            },
            {
                name: "Parts",
                subsubs: []
            }
        ]
    },
    {
        name: "Cooling System",
        brands: ["BEST SIGNATURE-FRIDGE", "INFIRGO", "BEST SIGNATURE SHOWCASES", "MKE MATIC", "POLAIR", "SKY RAINBOW", "GEL-MATIC", "TECNODOM", "COLDERA", "BERJAYA", "SPACMAN", "ZEMIC", "MUSSANA"],
        subs: [
            {
                name: "Refrigerators",
                subsubs: ["Reach in Refrigerators", "Undercounter Refrigerators", "Work Top Refrigerators", "Prep Table Refrigerators", "Chef Base Refrigerators", "Display Refrigerators", "Merchandising Refrigerators", "Blast Chillers & Freezers"]
            },
            {
                name: "Ice Cream Machines",
                subsubs: ["Countertop Ice Cream Machines", "Floor Mount Ice Cream Machines"]
            },
            {
                name: "Freezers",
                subsubs: ["Reach-In Freezers", "Undercounter Freezers", "Work Top Freezers", "Ice Cream Dipping Cabinets", "Merchandising Freezers"]
            }
        ]
    },
    {
        name: "Beverage Equipment",
        brands: ["WARING", "SAM TEKNIK", "NANTONG WANDEFU MACHINERY", "COFRIMELL", "MKE MATIC", "ZUMEX", "BILAIT", "UBERMILK", "VITAMIX"],
        subs: [
            { name: "Blenders", subsubs: [] },
            { name: "Juicers", subsubs: [] },
            { name: "Slushy Machines", subsubs: [] },
            { name: "Milkshake Machines", subsubs: [] },
            { name: "Hot Beverage Dispensers", subsubs: [] },
            { name: "Chocolate Fountains", subsubs: [] }
        ]
    },
    {
        name: "Commercial Ovens",
        brands: ["RATIONAL", "UNOX", "CAPINOX", "GGF", "VENARRO", "TURBOCHEF", "MENUMASTER", "VENIX", "JOSPER", "TECNODOM", "MIDDLLEBY MARSHALL"],
        subs: [
            { name: "Microwave Ovens", subsubs: [] },
            { name: "Convection Ovens", subsubs: [] },
            { name: "High Speed Hybrid Ovens", subsubs: [] },
            { name: "Conveyor Ovens", subsubs: [] },
            { name: "Combi Ovens", subsubs: [] },
            { name: "Pizza Ovens", subsubs: [] },
            { name: "Bakery Deck Ovens", subsubs: [] },
            { name: "Cook and Hold Ovens", subsubs: [] },
            { name: "Oven Accessories", subsubs: [] }
        ]
    },
    {
        name: "Food Preparation",
        brands: ["FIMAR", "CAPINOX", "BEST SIGNATURE", "MISKA", "ROBOTCOUPE", "SAP", "OMEGA", "LA MINERVA", "KITCHEN AID", "MAC.PAN", "Z. MATIK"],
        subs: [
            {
                name: "Engine Components Equipment",
                subsubs: ["Engine Components Machines", "Food Processor Blades and Discs"]
            },
            {
                name: "Food Packaging Appliances",
                subsubs: ["Vacuum Sealers", "Label-Printers"]
            },
            {
                name: "Food Blenders",
                subsubs: ["Hand Blenders"]
            },
            { name: "Dehydrators", subsubs: [] },
            {
                name: "Peelers & Dryers",
                subsubs: ["Commercial French Fry Cutters", "Manual Vegetable and Fruit Cutters", "Peelers & Dryers"]
            },
            { name: "Food Slicers", subsubs: [] },
            { name: "Dough Sheeters and Dough Presses", subsubs: [] },
            {
                name: "Meat and Seafood Preparation",
                subsubs: ["Meat Mincer", "Bone Saw Cutters", "Patty Press"]
            }
        ]
    },
    {
        name: "Food Holding and Warming Line",
        brands: ["FRESPRO", "D&S", "STELCO", "HATCO", "ALTO SHAAM"],
        subs: [
            { name: "Heat Lamps", subsubs: [] },
            { name: "Countertop Warmers and Display Cases", subsubs: [] },
            { name: "Strip Warmers", subsubs: [] },
            { name: "Holding and Proofing Cabinets", subsubs: [] }
        ]
    },
    {
        name: "Storage",
        brands: [],
        subs: [
            { name: "Storage Shelves", subsubs: [] },
            { name: "Storage Racks", subsubs: [] },
            { name: "Carts, Trucks and Dollies", subsubs: [] },
            { name: "Dinnerware Storage and Transport", subsubs: [] }
        ]
    },
    {
        name: "laundries",
        brands: ["FAGOR", "IMESA", "BATTISTELLA", "SPEED QUEEN", "MBM", "HOONVED", "CAPINOX", "OZIT", "UNION"],
        subs: [
            { name: "washing machines", subsubs: [] },
            { name: "dryers", subsubs: [] },
            { name: "IRON", subsubs: [] },
            { name: "Dishwasher", subsubs: [] }
        ]
    }
];

async function migrate() {
    console.log("🚀 Starting Category Migration...");
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Clear existing data
        console.log("🧹 Clearing existing categories and brand mappings...");
        await connection.execute("DELETE FROM category_brands");
        await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
        await connection.execute("TRUNCATE TABLE categories");
        await connection.execute("SET FOREIGN_KEY_CHECKS = 1");

        // 2. Insert Hierarchy
        for (const main of data) {
            const mainSlug = slugify(main.name, { lower: true });
            const [mainResult] = await connection.execute(
                "INSERT INTO categories (name, slug, type, is_active) VALUES (?, ?, 'main_category', 1)",
                [main.name, mainSlug]
            );
            const mainId = mainResult.insertId;
            console.log(`✅ Main: ${main.name}`);

            // Link Brands
            if (main.brands.length > 0) {
                for (const brandName of main.brands) {
                    // Try to find brand
                    const [brands] = await connection.execute("SELECT id FROM brands WHERE name LIKE ?", [`%${brandName}%`]);
                    if (brands.length > 0) {
                        await connection.execute(
                            "INSERT INTO category_brands (category_id, brand_id) VALUES (?, ?)",
                            [mainId, brands[0].id]
                        );
                    } else {
                        console.warn(`⚠️ Brand not found: ${brandName}`);
                    }
                }
            }

            for (const sub of main.subs) {
                const subSlug = slugify(`${main.name}-${sub.name}`, { lower: true });
                const [subResult] = await connection.execute(
                    "INSERT INTO categories (name, slug, type, parent_id, is_active) VALUES (?, ?, 'sub_category', ?, 1)",
                    [sub.name, subSlug, mainId]
                );
                const subId = subResult.insertId;
                console.log(`   📂 Sub: ${sub.name}`);

                for (const subsub of sub.subsubs) {
                    const subsubSlug = slugify(`${sub.name}-${subsub}`, { lower: true });
                    await connection.execute(
                        "INSERT INTO categories (name, slug, type, parent_id, is_active) VALUES (?, ?, 'sub_sub_category', ?, 1)",
                        [subsub, subsubSlug, subId]
                    );
                    console.log(`      🏷️ Sub-Sub: ${subsub}`);
                }
            }
        }

        await connection.commit();
        console.log("\n✅ Category Hierarchy Synced!");

        // 3. Initialize Settings
        console.log("⚙️ Initializing global settings...");
        const settings = [
            { key: 'points_per_aed', value: '1' },
            { key: 'aed_per_point', value: '0.01' }
        ];

        for (const s of settings) {
            await connection.execute(`
                INSERT INTO settings (\`key\`, \`value\`) 
                VALUES (?, ?) 
                ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
            `, [s.key, s.value]);
        }
        console.log("✅ Global settings initialized.");

        console.log("\n✨ Database Synchronization Successful!");
    } catch (error) {
        await connection.rollback();
        console.error("\n❌ Migration Failed:", error);
    } finally {
        connection.release();
        process.exit();
    }
}

migrate();

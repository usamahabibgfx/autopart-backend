const db = require('../config/db');
const slugify = require('slugify');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const initialBrands = [
    { name: "3MF", logo: "/assets/brands/3mf.jpg.webp" },
    { name: "ALTO-SHAAM", logo: "/assets/brands/Alto-Shaam.png.webp" },
    { name: "Anfim", logo: "/assets/brands/anfilm.png.webp" },
    { name: "APW Wyott", logo: "/assets/brands/apwwyott.png.webp" },
    { name: "ASAKI", logo: "/assets/brands/asaki-logo.jpg.webp" },
    { name: "BERJAYA", logo: "/assets/brands/Berjaya-Logo.jpg.webp" },
    { name: "blendtec", logo: "/assets/brands/Blendec-logo.png.webp" },
    { name: "BREMA", logo: "/assets/brands/brema.jpg.webp" },
    { name: "CAMRY", logo: "/assets/brands/camry.jpg.webp" },
    { name: "capinox", logo: "/assets/brands/capinox.jpg.webp" },
    { name: "COFRIMELL", logo: "/assets/brands/cofrimell.jpg.webp" },
    { name: "Desmon", logo: "/assets/brands/desmon.png.webp" },
    { name: "EASYLINE", logo: "/assets/brands/easyline.jpg.webp" },
    { name: "Electrolux", logo: "/assets/brands/electrolux.jpg.webp" },
    { name: "GG F", logo: "/assets/brands/ggf-logo.jpg.webp" },
    { name: "EMPERO", logo: "/assets/brands/empero.jpg.webp" },
    { name: "FAGOR", logo: "/assets/brands/FagorProfesional.png.webp" },
    { name: "ACE FILTERS", logo: "/assets/brands/Falater.png.webp" },
    { name: "fimar", logo: "/assets/brands/fimar.jpg.webp" },
    { name: "Frymaster", logo: "/assets/brands/FRYMASTER.png.webp" },
    { name: "GEL MATIC", logo: "/assets/brands/gelmatic.jpg.webp" },
    { name: "GHS", logo: "/assets/brands/ghs.jpg.webp" },
    { name: "Hamilton Beach", logo: "/assets/brands/hamilton-logo.jpg.webp" },
    { name: "Hatco", logo: "/assets/brands/hacto.jpg.webp" },
    { name: "HENNY PENNY", logo: "/assets/brands/hennypenny.jpg.webp" },
    { name: "HCONVED", logo: "/assets/brands/hoonved.jpg.webp" },
    { name: "IMESA", logo: "/assets/brands/imesa.jpg.webp" },
    { name: "IMPERIAL", logo: "/assets/brands/IMPERIAL.png.webp" },
    { name: "INFRICO", logo: "/assets/brands/inofrigo.jpg.webp" },
    { name: "JOSPER", logo: "/assets/brands/josper.jpg.webp" },
    { name: "KITCHENAID", logo: "/assets/brands/Kitchen-Aid.png.webp" },
    { name: "LA MARZOCCO", logo: "/assets/brands/La-Marzocco.png.webp" },
    { name: "La Minerva", logo: "/assets/brands/LA-MINERVA.png.webp" },
    { name: "LA CIMBALI", logo: "/assets/brands/lacimbali.jpg.webp" },
    { name: "Longoni", logo: "/assets/brands/Longoni-Brand.png.webp" },
    { name: "mac.pan", logo: "/assets/brands/macpac.jpg.webp" },
    { name: "MAHLKONIG", logo: "/assets/brands/MAHLKONIG-vector-logo.png.webp" },
    { name: "BEST SIGNATURE", logo: "/assets/brands/bestsignature.jpg.webp" },
    { name: "BEST SIGNATURE FABRICATION", logo: "/assets/brands/fabrication.webp" },
    { name: "MBM", logo: "/assets/brands/mbm-logo.jpg.webp" },
    { name: "MENUMASTER", logo: "/assets/brands/menumaster.jpg.webp" },
    { name: "MERRYCHEF", logo: "/assets/brands/merrychef.png.webp" },
    { name: "Middleby Marshall", logo: "/assets/brands/middleby-marshall-logo.gif.webp" },
    { name: "miska", logo: "/assets/brands/Logo-MiskaFoodTechnology1.jpg.webp" },
    { name: "MKE-MATIC", logo: "/assets/brands/mke-logo.jpg.webp" },
    { name: "MOEL", logo: "/assets/brands/moel.jpg.webp" },
    { name: "MONOLITH", logo: "/assets/brands/monolith.jpg.webp" },
    { name: "nuova SIMONELLI", logo: "/assets/brands/simonelli.jpg.webp" },
    { name: "OMEGA", logo: "/assets/brands/Omega.png.webp" },
    { name: "oztiryakiler", logo: "/assets/brands/oztriyakiler.jpg.webp" },
    { name: "PITCO", logo: "/assets/brands/pitco.jpg.webp" },
    { name: "POSLIX", logo: "/assets/brands/poslix.jpg.webp" },
    { name: "PRINCE CASTLE", logo: "/assets/brands/prince-casle.png.webp" },
    { name: "RANCILIO", logo: "/assets/brands/Rancilio-logo-1.png.webp" },
    { name: "RATIONAL", logo: "/assets/brands/rational.jpg.webp" },
    { name: "RED FOX", logo: "/assets/brands/redfox.jpg.webp" },
    { name: "robot coupe", logo: "/assets/brands/robotcoupe.jpg.webp" },
    { name: "ROLLER GRILL", logo: "/assets/brands/roller-grill.jpg.webp" },
    { name: "ROTONDI", logo: "/assets/brands/Rotondi-Group.png.webp" },
    { name: "SAB", logo: "/assets/brands/sab.jpg.webp" },
    { name: "samixir", logo: "/assets/brands/samixir.jpg.webp" },
    { name: "SANTOS", logo: "/assets/brands/santos.jpg.webp" },
    { name: "SAP", logo: "/assets/brands/sap-bone-saw-machine-in-dubai.png.webp" },
    { name: "SHEFFIELD", logo: "/assets/brands/Sheffiel.png.webp" },
    { name: "SOFINOR", logo: "/assets/brands/sofinor.jpg.webp" },
    { name: "SOUTHBEND", logo: "/assets/brands/southbend.jpg.webp" },
    { name: "SPACEMAN", logo: "/assets/brands/20210329_Spaceman-Logo_Black.png.webp" },
    { name: "Speed Queen", logo: "/assets/brands/Speed-Queen.png.webp" },
    { name: "STAR", logo: "/assets/brands/star.jpg.webp" },
    { name: "TOASTMASTER", logo: "/assets/brands/Toastmaster.png.webp" },
    { name: "UNION", logo: "/assets/brands/Union.png.webp" },
    { name: "VULCAN", logo: "/assets/brands/VULCAN-BRAND.png.webp" },
    { name: "SERVER", logo: "/assets/brands/server.jpg.webp" },
    { name: "STILCO", logo: "/assets/brands/stilco1.jpg.webp" },
    { name: "TECHNOCOOLER", logo: "/assets/brands/technocooler.jpg.webp" },
    { name: "TECNODOM", logo: "/assets/brands/tecnodom.jpg.webp" },
    { name: "UEBERMILK", logo: "/assets/brands/uebermilk_logo_small.png.webp" },
    { name: "UNOX", logo: "/assets/brands/unox.jpg.webp" },
    { name: "VITAMIX", logo: "/assets/brands/vitamix.jpg.webp" },
    { name: "BATTISTELLA", logo: "/assets/brands/BATTISTELLA-1.webp" },
    { name: "BILAIT", logo: "/assets/brands/BILAIT-Logo.webp" },
    { name: "VITO", logo: "/assets/brands/VITO-OIL-FILTER-SYSTEM.png.webp" },
    { name: "Zemic", logo: "/assets/brands/Zemic-Europe.png.webp" },
    { name: "Zumex", logo: "/assets/brands/Zumex.png.webp" },
    { name: "Ailipu", logo: "/assets/brands/ailipu-1.webp" },
    { name: "Bimatic", logo: "/assets/brands/bimatic.webp" },
    { name: "Bunn", logo: "/assets/brands/bunn.webp" },
    { name: "Grindmaster", logo: "/assets/brands/grindmaster.webp" },
    { name: "Hoshizaki", logo: "/assets/brands/hoshizaki.webp" },
    { name: "Mussana", logo: "/assets/brands/mussana.webp" },
    { name: "Pastaline", logo: "/assets/brands/pastaline.webp" },
    { name: "Salva", logo: "/assets/brands/salva.webp" },
    { name: "Snooker", logo: "/assets/brands/snooker-1.webp" },
    { name: "Turbo Chef", logo: "/assets/brands/turbo-chef.webp" },
    { name: "Venarro", logo: "/assets/brands/venarro.jpg.webp" },
    { name: "Venix", logo: "/assets/brands/venix.jpg.webp" },
    { name: "Warning", logo: "/assets/brands/warning.jpg.webp" },
    { name: "Zmatik", logo: "/assets/brands/zmatik-1.webp" }
];

async function seedBrands() {
    console.log('Starting brand seeding...');
    try {
        for (const brand of initialBrands) {
            const slug = slugify(brand.name, { lower: true });

            // Check if brand already exists
            const [existing] = await db.execute('SELECT id FROM brands WHERE slug = ?', [slug]);

            if (existing.length === 0) {
                await db.execute(
                    'INSERT INTO brands (name, slug, image_url) VALUES (?, ?, ?)',
                    [brand.name, slug, brand.logo]
                );
                console.log(`Added: ${brand.name}`);
            } else {
                // Update image URL if it changed
                await db.execute(
                    'UPDATE brands SET image_url = ? WHERE slug = ?',
                    [brand.logo, slug]
                );
                console.log(`Updated: ${brand.name}`);
            }
        }
        console.log('Brand seeding completed successfully!');
    } catch (error) {
        console.error('Error seeding brands:', error);
    } finally {
        process.exit();
    }
}

seedBrands();

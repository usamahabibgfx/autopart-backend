/**
 * Remaps all products to correct categories based on product name keywords.
 * Run: node scripts/remap_categories.js
 * Add --apply flag to actually commit changes: node scripts/remap_categories.js --apply
 */

const db = require('../config/db');

const APPLY = process.argv.includes('--apply');

// Rules are checked in order — first match wins.
// cat = category_id, sub = sub_category_id, subsub = sub_sub_category_id (null = clear it)
const RULES = [
  // ── LAUNDRY (117) ────────────────────────────────────────────────────────
  { kw: ['washer extractor', 'conveyor washing machine', 'compact utensil washer', 'laundry washing'], cat: 117, sub: 118 },
  { kw: ['tumbler dryer', 'laundry dryer', 'drying ironer', 'flatwork ironer', 'laundry finishing', 'laundry ironing and folding'], cat: 117, sub: 119 },
  { kw: ['iron board', 'ironing table', 'heated and vacuum ironing', 'argo - iron', 'vaporino inox'], cat: 117, sub: 120 },
  { kw: ['pre-wash spray unit', 'dishwasher', 'glasswasher', 'glass dish washer', 'glass washer', 'rack-mounted dishwasher', 'rack mounted dishwasher', 'undercounter type dishwasher', 'hood type dishwasher', 'conveyor type dishwasher'], cat: 117, sub: 121 },
  { kw: ['laundry accessories'], cat: 117, sub: 115 }, // trolley for laundry → Carts

  // ── SUPERMARKET (138) ────────────────────────────────────────────────────
  { kw: ['fish display chiller', 'fish display'], cat: 138, sub: 139 },
  { kw: ['meat display'], cat: 138, sub: 140 },
  { kw: ['weighing scale', 'price computing', 'counting platform scale', 'hanging weighing', 'label printing scale', 'label printing', 'cash drawer', 'barcode scanner', 'pos terminal', 'thermal printer', 'wired barcode', 'wireless barcode', 'pos printer'], cat: 138, sub: 141 },
  { kw: ['island type supermarket', 'vulcan dairy', 'vulcan inox dairy', 'vulcan - fruit', 'vulcan fruit & vegetables', 'vulcan fruit'], cat: 138, sub: 142 },

  // ── FOOD HOLDING & WARMING (107) ─────────────────────────────────────────
  { kw: ['heat lamp', 'infrared food warmer', 'glo-ray'], cat: 107, sub: 108 },
  { kw: ['strip warmer'], cat: 107, sub: 110 },
  { kw: ['proofing cabinet', 'holding cabinet', 'proofer', 'trolley spray proofer', 'fermentation chamber', 'fermenter cabinet', 'high volume double compartment holding'], cat: 107, sub: 111 },
  { kw: ['bain marie', 'nachos warmer', 'nacho chip warmer', 'food warmer cart', 'warming showcase', 'hot topping', 'topping warmer', 'cheese warmer', 'heated display showcase', 'commercial nachos', 'warming display', 'heating unit'], cat: 107, sub: 109 },

  // ── STORAGE (112) ────────────────────────────────────────────────────────
  { kw: ['adjustable wall shelf', 'tubular shelf stainless', 'wall shelf'], cat: 112, sub: 113 },
  { kw: ['stainless steel table', 'stainless steel base cabinet', 'work top table', 'worktop module', 'worktop purpose', 'work top purpose'], cat: 112, sub: 113 },
  { kw: ['storage rack'], cat: 112, sub: 114 },
  { kw: ['food distribution cart', 'double door food warmer cart'], cat: 112, sub: 115 }, // food transport carts
  { kw: ['trolley for pasta', 'trolley cfm', 'laundry accessories - trolley'], cat: 112, sub: 115 },

  // ── COMMERCIAL OVENS (77) ─────────────────────────────────────────────────
  { kw: ['turbochef', 'xpresschef', 'rapid cook', 'high speed oven'], cat: 77, sub: 80 },
  { kw: ['microwave oven', 'microwave'], cat: 77, sub: 78 },
  { kw: ['combi oven', 'combi steam', 'bakerlux combi', 'bakerlux manuel gas combi', 'bakery ovens 4 trays squero combi', 'squero combi', 'campiello bakery', 'campiello digital bakery', 'vittoria led control electric combi', 'bakery & pastry oven', 'bakery &amp; pastry oven'], cat: 77, sub: 82 },
  { kw: ['deck oven', 'triple deck', 'tri deck', 'bakery deck'], cat: 77, sub: 84 },
  { kw: ['conveyor oven'], cat: 77, sub: 81 },
  { kw: ['cook and hold', 'cabinet hot vacuum multi day'], cat: 77, sub: 85 },
  { kw: ['pizza oven', 'venarro rotary gas pizza', 'venarro rotating base gas pizza', 'venarro dyk', 'charcoal oven', 'charcoal oven'], cat: 77, sub: 83 },
  { kw: ['oven accessory', 'alum perf pan'], cat: 77, sub: 86 },
  { kw: ['convection oven', 'bakery convection', 'bakery gas oven', 'baker lux manuel gas oven', 'bakerlux manuel gas oven'], cat: 77, sub: 79 },

  // ── BEVERAGE EQUIPMENT (70) ───────────────────────────────────────────────
  { kw: ['automatic citrus juicer', 'automatic centrifugal juicer', 'automatic orange juicer', 'citrus juicer', 'orange juicer', 'juice extractor', 'centrifugal juicer', 'vitaminbar juice'], cat: 70, sub: 72 },
  { kw: ['slushy machine', 'slushy', 'slush machine', 'slush', 'granita', 'aizar smart'], cat: 70, sub: 73 },
  { kw: ['milkshake machine', 'milkshake', 'triple-spindle drink mixer', 'drink mixer'], cat: 70, sub: 74 },
  { kw: ['hot beverage dispenser', 'hot chocolate dispenser', 'ubermilk'], cat: 70, sub: 75 },
  { kw: ['chocolate fountain'], cat: 70, sub: 76 },
  { kw: ['bar blender', 'blendtec', 'vita-prep', 'blender drink machine', 'blender touch', 'blender variable speed', 'blender advance', 'blender on counter', 'blender container', 'blender jar', 'tango bar blender', 'tempest blender', 'brushless blender', '908 bar blender', 'blender mixer'], cat: 70, sub: 122 },

  // ── ENGINE PARTS (1) ─────────────────────────────────────────────────────
  { kw: ['gravimetric espresso'], cat: 1, sub: 2, subsub: 4 },
  { kw: ['engine component', 'espresso coffee machine', 'aurelia ii', 'traditional coffee machine', 'automatic coffee machine'], cat: 1, sub: 2, subsub: 3 },
  { kw: ['espresso grinder', 'anfim alba coffee grinder', 'automatic silent espresso coffee grinder'], cat: 1, sub: 5, subsub: 6 },
  { kw: ['coffee grinder', 'brewed coffee grinder'], cat: 1, sub: 5 },
  { kw: ['pour over', 'drip vehicle spare part'], cat: 1, sub: 8, subsub: 9 },
  { kw: ['water boiler'], cat: 1, sub: 8, subsub: 10 },
  { kw: ['tea maker', 'tea machine'], cat: 1, sub: 8, subsub: 12 },
  { kw: ['vehicle spare part', 'bunn vehicle spare part', 'bunn toaster'], cat: 1, sub: 8 },
  { kw: ['smart water filter', 'filter cartridge bwt'], cat: 1, sub: 8, subsub: 11 },

  // ── COOLING SYSTEM PARTS (13) ────────────────────────────────────────────────────
  { kw: ['ice flaker', 'flake ice machine'], cat: 13, sub: 15 },
  { kw: ['ice storage bin', 'ice bin'], cat: 13, sub: 16 },
  { kw: ['ice machine', 'ice maker', 'ice cube maker', 'bullet ice machine', 'ice cube machine', 'ice production'], cat: 13, sub: 14 },
  { kw: ['top kit hoshizaki'], cat: 13, sub: 16 }, // ice bin accessory

  // ── COOKING EQUIPMENT (17) ────────────────────────────────────────────────
  // Griddles
  { kw: ['gas griddle', 'griddle lp gas', 'griddle gas'], cat: 17, sub: 18, subsub: 19 },
  { kw: ['electric griddle', 'griddle electric', 'toastmaster griddle'], cat: 17, sub: 18, subsub: 20 },
  { kw: ['griddle', 'upper clam grill plate', 'teflon sheet', 'teflon accessory'], cat: 17, sub: 18 },
  // Induction
  { kw: ['induction range', 'induction cooker', 'wok induction', 'induction wok'], cat: 17, sub: 21, subsub: 25 },
  // Gas ranges
  { kw: ['gas range', 'gas cooker', 'gas burner cooker', 'gas boiling top', 'american style', 'gas burner boiling top', '4 round plates on electric oven', '4 square plates on electric oven', 'undercounter electric oven pt-90 el'], cat: 17, sub: 21, subsub: 22 },
  { kw: ['electric range', 'electric oven with plates'], cat: 17, sub: 21, subsub: 23 },
  { kw: ['countertop range', 'boiling top'], cat: 17, sub: 21, subsub: 24 },
  { kw: ['automotive business range', 'range cooker', 'gas cooker'], cat: 17, sub: 21 },
  // Toasters
  { kw: ['conveyor toaster', 'conveyor type toaster', 'bun grill toaster', 'vertical conveyor bun grill'], cat: 17, sub: 26, subsub: 27 },
  { kw: ['panini grill', 'panini press', 'contact grill', 'upper clam grill'], cat: 17, sub: 26, subsub: 28 },
  { kw: ['bread toaster', 'pop-up toaster', 'pop up toaster'], cat: 17, sub: 26, subsub: 29 },
  { kw: ['toaster'], cat: 17, sub: 26 },
  // Waffle / Crepe
  { kw: ['waffle iron', 'waffle maker', 'waffle baker', 'waffle for ice cream cones'], cat: 17, sub: 30, subsub: 31 },
  { kw: ['baking plate', 'teflon sheet'], cat: 17, sub: 30, subsub: 32 },
  { kw: ['crepe maker', 'crepe machine'], cat: 17, sub: 30, subsub: 33 },
  // Char broilers
  { kw: ['lava rock char', 'lava rock broiler'], cat: 17, sub: 34, subsub: 36 },
  { kw: ['charbroiler', 'char broiler', 'radiant char'], cat: 17, sub: 34, subsub: 35 },
  // Specialty cooking
  { kw: ['electric char broiler', 'electric charbroiler'], cat: 17, sub: 37, subsub: 38 },
  { kw: ['sous vide'], cat: 17, sub: 37, subsub: 39 },
  { kw: ['pasta cooker'], cat: 17, sub: 37, subsub: 40 },
  { kw: ['salamander grill', 'salamander'], cat: 17, sub: 37, subsub: 41 },
  { kw: ['shawarma'], cat: 17, sub: 37, subsub: 42 },
  { kw: ['rotisserie', 'chicken rotisserie'], cat: 17, sub: 37, subsub: 42 },
  { kw: ['steam kettle', 'braising pan'], cat: 17, sub: 37, subsub: 44 },
  { kw: ['wok', 'vario cooking center', 'universal smoker', 'smoker', 'tartlet cooking', 'bolbol ufo burger', 'viennett', 'charcoal oven'], cat: 17, sub: 37, subsub: 43 },
  // Fryers
  { kw: ['gas fryer', 'propane fryer', 'lp gas fryer', 'twin tank gas fryer', 'solstice supreme'], cat: 17, sub: 45, subsub: 46 },
  { kw: ['electric fryer', 'fryer with electric', 'liter fryer with electric'], cat: 17, sub: 45, subsub: 47 },
  { kw: ['pressure fryer'], cat: 17, sub: 45, subsub: 48 },
  { kw: ['oil filtration', 'vito xs', 'vito xm', 'vito xl', 'cellulose particle filter'], cat: 17, sub: 45, subsub: 49 },
  { kw: ['fry dump'], cat: 17, sub: 45, subsub: 50 },
  { kw: ['fryer'], cat: 17, sub: 45 },

  // ── REFRIGERATION (51) ────────────────────────────────────────────────────
  // Ice cream machines
  { kw: ['countertop ice cream', 'table top ice cream'], cat: 51, sub: 61, subsub: 62 },
  { kw: ['floor mount ice cream', 'floor standing ice cream'], cat: 51, sub: 61, subsub: 63 },
  { kw: ['soft serve', 'ice cream machine', 'gelato machine', 'gelato', 'soft-serve'], cat: 51, sub: 61 },
  // Freezers
  { kw: ['ice cream dipping cabinet', 'dipping cabinet'], cat: 51, sub: 64, subsub: 68 },
  { kw: ['merchandising freezer'], cat: 51, sub: 64, subsub: 69 },
  { kw: ['reach-in freezer', 'reach in freezer'], cat: 51, sub: 64, subsub: 65 },
  { kw: ['undercounter freezer', 'under counter freezer'], cat: 51, sub: 64, subsub: 66 },
  { kw: ['work top freezer', 'worktop freezer'], cat: 51, sub: 64, subsub: 67 },
  { kw: ['upright freezer', 'door upright freezer', 'door freezer counter', 'freezer counter', 'two door freezer', 'three door upright beverage freezer', 'upright negative'], cat: 51, sub: 64, subsub: 65 },
  { kw: ['freezer'], cat: 51, sub: 64 },
  // Refrigerators
  { kw: ['blast chiller'], cat: 51, sub: 52, subsub: 60 },
  { kw: ['merchandising refrigerator', 'merchandising chiller'], cat: 51, sub: 52, subsub: 59 },
  { kw: ['saladette', 'saladette preparation chiller', 'table top saladette'], cat: 51, sub: 52, subsub: 56 },
  { kw: ['prep table refrigerator', 'prep table chiller'], cat: 51, sub: 52, subsub: 56 },
  { kw: ['chef base refrigerator', 'chef base chiller', 'chef base'], cat: 51, sub: 52, subsub: 57 },
  { kw: ['display refrigerator', 'display chiller', 'cake showcase', 'cake display showcase', 'upright showcase', 'cold showcase', 'layer display showcase', 'upright display chiller', 'ventilated positive display', 'ventilated negative display', 'refrigerator display'], cat: 51, sub: 52, subsub: 58 },
  { kw: ['work top chiller', 'worktop chiller', 'worktop refrigerator', 'work top refrigerator'], cat: 51, sub: 52, subsub: 55 },
  { kw: ['undercounter refrigerator', 'under counter refrigerator', 'undercounter chiller'], cat: 51, sub: 52, subsub: 54 },
  { kw: ['bar cooler', 'beverage chiller', 'three door upright beverage chiller', 'bar cooler bc', 'bar fridge'], cat: 51, sub: 52, subsub: 58 },
  { kw: ['reach-in refrigerator', 'reach in refrigerator'], cat: 51, sub: 52, subsub: 53 },
  { kw: ['upright refrigerator', 'upright chiller', 'door refrigerator counter', 'refrigerator counter', 'two door refrigerator', 'four doors upright chiller', 'four door upright chiller', 'doors upright cold showcase', 'ventilated 3 doors saladette'], cat: 51, sub: 52, subsub: 53 },
  { kw: ['refrigerator', 'chiller', 'cold showcase'], cat: 51, sub: 52 },

  // ── FOOD PREPARATION (87) ─────────────────────────────────────────────────
  // Hand blenders
  { kw: ['immersion hand blender', 'hand blender', 'stick blender', 'blixer'], cat: 87, sub: 94, subsub: 95 },
  // Food processors
  { kw: ['food processor', 'engine components machine', '4-qt food processor', 'vertical cutter mixer', 'vertical cutter'], cat: 87, sub: 88, subsub: 89 },
  { kw: ['processor blade', 'processor disc', 'food processor blade', 'white plastic disks'], cat: 87, sub: 88, subsub: 90 },
  // Vacuum / Packaging
  { kw: ['vacuum chamber machine', 'bar vacuum machine', 'automatic table vacuum packaging', 'continuous sealing machine', 'can sealer'], cat: 87, sub: 91, subsub: 92 },
  // Dehydrators
  { kw: ['dehydrator', 'dehydrating'], cat: 87, sub: 96 },
  // Cutters / Peelers
  { kw: ['commercial french fry cutter', 'french fry cutter'], cat: 87, sub: 97, subsub: 98 },
  { kw: ['vegetable cutter', 'vegetable preparation machine', 'vegetable prep machine', 'vegetable slicer machine', 'manual vegetable', 'vegetable processor'], cat: 87, sub: 97, subsub: 99 },
  { kw: ['peeler', 'peeling machine'], cat: 87, sub: 97, subsub: 100 },
  // Slicers (food/bread/meat)
  { kw: ['food slicer', 'meat slicer', 'bread slicer', 'bread slicing machine', 'baget bread slicer', 'bun dividers', 'bread moulder'], cat: 87, sub: 101 },
  // Dough
  { kw: ['dough sheeter', 'dough press', 'pizza rolling mill', 'pasta rolling', 'bread moulder', 'bun divider', 'bun rounders'], cat: 87, sub: 102 },
  // Meat & Seafood
  { kw: ['meat mincer', 'meat grinder', 'mincer'], cat: 87, sub: 103, subsub: 104 },
  { kw: ['bone saw machine', 'bone saws machine', 'bone saw'], cat: 87, sub: 103, subsub: 105 },
  { kw: ['patty press', 'burger press', 'bolbol ufo burger'], cat: 87, sub: 103, subsub: 106 },
  // General food prep blenders (commercial / vita-prep style)
  { kw: ['vita-prep', 'vitamix blender', 'blender vita-prep', 'blender variable speed'], cat: 87, sub: 94 },
];

function matchRule(name) {
  const lower = name.toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.kw) {
      if (lower.includes(kw)) {
        return rule;
      }
    }
  }
  return null;
}

async function run() {
  const [rows] = await db.query(
    'SELECT id, name, category_id, sub_category_id, sub_sub_category_id FROM products'
  );

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const changes = [];

  for (const product of rows) {
    const rule = matchRule(product.name);
    if (!rule) {
      skipped++;
      continue;
    }

    const newCat = rule.cat ?? null;
    const newSub = rule.sub ?? null;
    const newSubsub = rule.subsub ?? null;

    const same =
      product.category_id === newCat &&
      product.sub_category_id === newSub &&
      product.sub_sub_category_id === newSubsub;

    if (same) {
      unchanged++;
      continue;
    }

    changes.push({ product, newCat, newSub, newSubsub });

    if (APPLY) {
      await db.query(
        'UPDATE products SET category_id=?, sub_category_id=?, sub_sub_category_id=? WHERE id=?',
        [newCat, newSub, newSubsub, product.id]
      );
    }
    updated++;
  }

  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(APPLY ? '  APPLIED CHANGES' : '  DRY RUN — pass --apply to commit');
  console.log('='.repeat(60));
  console.log(`  Total products : ${rows.length}`);
  console.log(`  Will update    : ${updated}`);
  console.log(`  Already correct: ${unchanged}`);
  console.log(`  No rule match  : ${skipped}`);
  console.log('='.repeat(60));

  // Print sample of changes
  const SHOW = 60;
  console.log(`\nSample changes (first ${SHOW}):\n`);
  for (const { product, newCat, newSub, newSubsub } of changes.slice(0, SHOW)) {
    console.log(
      `  [${product.id}] ${product.name.substring(0, 55).padEnd(55)} ` +
      `${product.category_id ?? 'null'}/${product.sub_category_id ?? 'null'}/${product.sub_sub_category_id ?? 'null'} ` +
      `→ ${newCat ?? 'null'}/${newSub ?? 'null'}/${newSubsub ?? 'null'}`
    );
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });

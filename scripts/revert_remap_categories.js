/**
 * Reverts the category remap by setting all rule-matched products back to NULL.
 * Run: node scripts/revert_remap_categories.js
 * Add --apply to commit: node scripts/revert_remap_categories.js --apply
 */

const db = require('../config/db');

const APPLY = process.argv.includes('--apply');

// Same keyword list as remap_categories.js — all products matching any keyword get cleared.
const ALL_KEYWORDS = [
  'washer extractor','conveyor washing machine','compact utensil washer','laundry washing',
  'tumbler dryer','laundry dryer','drying ironer','flatwork ironer','laundry finishing','laundry ironing and folding',
  'iron board','ironing table','heated and vacuum ironing','argo - iron','vaporino inox',
  'pre-wash spray unit','dishwasher','glasswasher','glass dish washer','glass washer',
  'rack-mounted dishwasher','rack mounted dishwasher','undercounter type dishwasher',
  'hood type dishwasher','conveyor type dishwasher','laundry accessories',
  'fish display chiller','fish display','meat display',
  'weighing scale','price computing','counting platform scale','hanging weighing',
  'label printing scale','label printing','cash drawer','barcode scanner','pos terminal',
  'thermal printer','wired barcode','wireless barcode','pos printer',
  'island type supermarket','vulcan dairy','vulcan inox dairy','vulcan - fruit',
  'vulcan fruit & vegetables','vulcan fruit',
  'heat lamp','infrared food warmer','glo-ray','strip warmer',
  'proofing cabinet','holding cabinet','proofer','trolley spray proofer',
  'fermentation chamber','fermenter cabinet','high volume double compartment holding',
  'bain marie','nachos warmer','nacho chip warmer','food warmer cart','warming showcase',
  'hot topping','topping warmer','cheese warmer','heated display showcase',
  'commercial nachos','warming display','heating unit',
  'adjustable wall shelf','tubular shelf stainless','wall shelf',
  'stainless steel table','stainless steel base cabinet','work top table',
  'worktop module','worktop purpose','work top purpose','storage rack',
  'food distribution cart','double door food warmer cart',
  'trolley for pasta','trolley cfm','laundry accessories - trolley',
  'turbochef','xpresschef','rapid cook','high speed oven',
  'microwave oven','microwave',
  'combi oven','combi steam','bakerlux combi','bakerlux manuel gas combi',
  'bakery ovens 4 trays squero combi','squero combi','campiello bakery',
  'campiello digital bakery','vittoria led control electric combi',
  'bakery & pastry oven','bakery &amp; pastry oven',
  'deck oven','triple deck','tri deck','bakery deck','conveyor oven',
  'cook and hold','cabinet hot vacuum multi day',
  'pizza oven','venarro rotary gas pizza','venarro rotating base gas pizza','venarro dyk',
  'charcoal oven','oven accessory','alum perf pan',
  'convection oven','bakery convection','bakery gas oven',
  'baker lux manuel gas oven','bakerlux manuel gas oven',
  'automatic citrus juicer','automatic centrifugal juicer','automatic orange juicer',
  'citrus juicer','orange juicer','juice extractor','centrifugal juicer','vitaminbar juice',
  'slushy machine','slushy','slush machine','slush','granita','aizar smart',
  'milkshake machine','milkshake','triple-spindle drink mixer','drink mixer',
  'hot beverage dispenser','hot chocolate dispenser','ubermilk',
  'chocolate fountain',
  'bar blender','blendtec','vita-prep','blender drink machine','blender touch',
  'blender variable speed','blender advance','blender on counter','blender container',
  'blender jar','tango bar blender','tempest blender','brushless blender',
  '908 bar blender','blender mixer',
  'gravimetric espresso','engine component','espresso coffee machine','aurelia ii',
  'traditional coffee machine','automatic coffee machine',
  'espresso grinder','anfim alba coffee grinder','automatic silent espresso coffee grinder',
  'coffee grinder','brewed coffee grinder','pour over','drip vehicle spare part',
  'water boiler','tea maker','tea machine','vehicle spare part','bunn vehicle spare part',
  'bunn toaster','smart water filter','filter cartridge bwt',
  'ice flaker','flake ice machine','ice storage bin','ice bin',
  'ice machine','ice maker','ice cube maker','bullet ice machine','ice cube machine',
  'ice production','top kit hoshizaki',
  'gas griddle','griddle lp gas','griddle gas',
  'electric griddle','griddle electric','toastmaster griddle',
  'griddle','upper clam grill plate','teflon sheet','teflon accessory',
  'induction range','induction cooker','wok induction','induction wok',
  'gas range','gas cooker','gas burner cooker','gas boiling top','american style',
  'gas burner boiling top','4 round plates on electric oven','4 square plates on electric oven',
  'undercounter electric oven pt-90 el','electric range','electric oven with plates',
  'countertop range','boiling top','automotive business range','range cooker',
  'conveyor toaster','conveyor type toaster','bun grill toaster','vertical conveyor bun grill',
  'panini grill','panini press','contact grill','upper clam grill',
  'bread toaster','pop-up toaster','pop up toaster','toaster',
  'waffle iron','waffle maker','waffle baker','waffle for ice cream cones',
  'baking plate','crepe maker','crepe machine',
  'lava rock char','lava rock broiler','charbroiler','char broiler','radiant char',
  'electric char broiler','electric charbroiler','sous vide','pasta cooker',
  'salamander grill','salamander','shawarma','rotisserie','chicken rotisserie',
  'steam kettle','braising pan','wok','vario cooking center','universal smoker',
  'smoker','tartlet cooking','bolbol ufo burger','viennett',
  'gas fryer','propane fryer','lp gas fryer','twin tank gas fryer','solstice supreme',
  'electric fryer','fryer with electric','liter fryer with electric',
  'pressure fryer','oil filtration','vito xs','vito xm','vito xl',
  'cellulose particle filter','fry dump','fryer',
  'countertop ice cream','table top ice cream','floor mount ice cream',
  'floor standing ice cream','soft serve','ice cream machine','gelato machine',
  'gelato','soft-serve',
  'ice cream dipping cabinet','dipping cabinet','merchandising freezer',
  'reach-in freezer','reach in freezer','undercounter freezer','under counter freezer',
  'work top freezer','worktop freezer','upright freezer','door upright freezer',
  'door freezer counter','freezer counter','two door freezer',
  'three door upright beverage freezer','upright negative','freezer',
  'blast chiller','merchandising refrigerator','merchandising chiller',
  'saladette','saladette preparation chiller','table top saladette',
  'prep table refrigerator','prep table chiller','chef base refrigerator',
  'chef base chiller','chef base','display refrigerator','display chiller',
  'cake showcase','cake display showcase','upright showcase','cold showcase',
  'layer display showcase','upright display chiller','ventilated positive display',
  'ventilated negative display','refrigerator display',
  'work top chiller','worktop chiller','worktop refrigerator','work top refrigerator',
  'undercounter refrigerator','under counter refrigerator','undercounter chiller',
  'bar cooler','beverage chiller','three door upright beverage chiller','bar fridge',
  'reach-in refrigerator','reach in refrigerator','upright refrigerator','upright chiller',
  'door refrigerator counter','refrigerator counter','two door refrigerator',
  'four doors upright chiller','four door upright chiller',
  'doors upright cold showcase','ventilated 3 doors saladette',
  'refrigerator','chiller','cold showcase',
  'immersion hand blender','hand blender','stick blender','blixer',
  'food processor','engine components machine','4-qt food processor',
  'vertical cutter mixer','vertical cutter','processor blade','processor disc',
  'food processor blade','white plastic disks',
  'vacuum chamber machine','bar vacuum machine','automatic table vacuum packaging',
  'continuous sealing machine','can sealer','dehydrator','dehydrating',
  'commercial french fry cutter','french fry cutter',
  'vegetable cutter','vegetable preparation machine','vegetable prep machine',
  'vegetable slicer machine','manual vegetable','vegetable processor',
  'peeler','peeling machine',
  'food slicer','meat slicer','bread slicer','bread slicing machine',
  'baget bread slicer','bun dividers','bread moulder',
  'dough sheeter','dough press','pizza rolling mill','pasta rolling',
  'bun divider','bun rounders',
  'meat mincer','meat grinder','mincer',
  'bone saw machine','bone saws machine','bone saw',
  'patty press','burger press','vita-prep','vitamix blender','blender vita-prep',
];

function matchesAny(name) {
  const lower = name.toLowerCase();
  return ALL_KEYWORDS.some(kw => lower.includes(kw));
}

async function run() {
  const [rows] = await db.query(
    'SELECT id, name, category_id, sub_category_id, sub_sub_category_id FROM products'
  );

  let count = 0;
  for (const product of rows) {
    if (!matchesAny(product.name)) continue;

    const alreadyNull =
      product.category_id === null &&
      product.sub_category_id === null &&
      product.sub_sub_category_id === null;

    if (alreadyNull) continue;

    count++;
    if (APPLY) {
      await db.query(
        'UPDATE products SET category_id=NULL, sub_category_id=NULL, sub_sub_category_id=NULL WHERE id=?',
        [product.id]
      );
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(APPLY ? '  REVERTED' : '  DRY RUN — add --apply to commit');
  console.log('='.repeat(50));
  console.log(`  Products cleared: ${count}`);
  console.log('='.repeat(50));
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });

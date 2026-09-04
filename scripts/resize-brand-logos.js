/**
 * Resize existing brand logos to 480w WebP @ q80.
 * - Backs up originals to backend/uploads/brands/_originals/<filename> before overwriting.
 * - Idempotent: if a backup already exists, the original has been processed before — skips.
 * - Skips images already <= 480px wide (no upscaling, no needless re-encode).
 *
 * Run: node scripts/resize-brand-logos.js
 */
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const sharp = require('sharp');

const BRANDS_DIR = path.join(__dirname, '..', 'uploads', 'brands');
const BACKUP_DIR = path.join(BRANDS_DIR, '_originals');
const MAX_WIDTH = 480;
const QUALITY = 80;

const IMG_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif']);

async function ensureDir(dir) {
    await fsPromises.mkdir(dir, { recursive: true });
}

async function processFile(filename) {
    const srcPath = path.join(BRANDS_DIR, filename);
    const ext = path.extname(filename).toLowerCase();
    if (!IMG_EXT.has(ext)) return { filename, skipped: 'not-image' };

    const stat = await fsPromises.stat(srcPath);
    if (!stat.isFile()) return { filename, skipped: 'not-file' };

    // Read the file into memory first — sharp's native file open can be blocked
    // by sandbox/AV on Windows, but Node's fs.readFile goes through normal channels.
    const srcBuf = await fsPromises.readFile(srcPath);

    const meta = await sharp(srcBuf).metadata();
    if (meta.width && meta.width <= MAX_WIDTH) {
        return { filename, skipped: `already-small (${meta.width}w)` };
    }

    // Back up original if we haven't already
    const backupPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(backupPath)) {
        await fsPromises.writeFile(backupPath, srcBuf);
    }

    // Resize and overwrite the source in place.
    const buf = await sharp(srcBuf)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 4 })
        .toBuffer();

    await fsPromises.writeFile(srcPath, buf);
    const newStat = await fsPromises.stat(srcPath);

    return {
        filename,
        before: stat.size,
        after: newStat.size,
        savedKB: ((stat.size - newStat.size) / 1024).toFixed(1),
        fromWidth: meta.width,
    };
}

async function main() {
    if (!fs.existsSync(BRANDS_DIR)) {
        console.error(`Brands directory not found: ${BRANDS_DIR}`);
        process.exit(1);
    }
    await ensureDir(BACKUP_DIR);

    const entries = await fsPromises.readdir(BRANDS_DIR);
    const files = entries.filter(f => !f.startsWith('_') && !f.startsWith('.'));

    console.log(`Processing ${files.length} file(s) in ${BRANDS_DIR}\n`);

    let totalBefore = 0;
    let totalAfter = 0;
    let processed = 0;
    let skipped = 0;
    const errors = [];

    for (const f of files) {
        try {
            const r = await processFile(f);
            if (r.skipped) {
                skipped++;
                console.log(`  skip  ${f}  (${r.skipped})`);
            } else {
                processed++;
                totalBefore += r.before;
                totalAfter += r.after;
                console.log(`  ok    ${f}  ${(r.before / 1024).toFixed(1)}KB -> ${(r.after / 1024).toFixed(1)}KB  (-${r.savedKB}KB, was ${r.fromWidth}w)`);
            }
        } catch (e) {
            errors.push({ f, e: e.message });
            console.error(`  ERR   ${f}  ${e.message}`);
        }
    }

    console.log(`\nDone. Processed ${processed}, skipped ${skipped}, errors ${errors.length}.`);
    if (processed > 0) {
        console.log(`Total: ${(totalBefore / 1024).toFixed(1)}KB -> ${(totalAfter / 1024).toFixed(1)}KB (saved ${((totalBefore - totalAfter) / 1024).toFixed(1)}KB)`);
    }
    console.log(`Originals backed up in: ${BACKUP_DIR}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

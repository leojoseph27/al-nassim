/* ============================================================================
   AL-NASSIM — reversible product-image WebP migration utility
   ============================================================================
   Converts existing product images (public/uploads/*.png|jpg|jpeg|avif) to
   optimized WebP and repoints Product.image / Product.images[] at the new
   files. Run MANUALLY — never part of deployment.

   Modes
     node scripts/migrate-product-images.cjs                 → DRY RUN (default)
     node scripts/migrate-product-images.cjs --apply         → perform migration
     node scripts/migrate-product-images.cjs --restore       → revert DB refs to
                                                               the original
                                                               files using the
                                                               manifest
   Options
     --quality=N        WebP quality (default 82, clamped 40-95)
     --max-width=N      longest-side cap in px (default 1600, min 320)
     --min-saving=KB    skip when the saving is below this (default 10 KB)
     --limit=N          process at most N images this run (resumable)
     --retry=N          retries per image on sharp failure (default 1)
     --ids=1,2,3        restrict to specific product ids

   Safety properties
     - Originals are NEVER deleted. Restore is possible at any time because
       the original files stay on disk and the manifest maps every change.
     - A WebP file is only referenced after it exists on disk and has been
       re-decoded by sharp for verification.
     - Conversion happens only when the WebP is genuinely smaller; otherwise
       the original reference is kept.
     - Duplicate image references (same file on several products) are converted
       once and every reference is updated.
     - Order-item image snapshots are historical copies — never rewritten;
       they keep working because originals are never deleted.
     - GIF files are skipped (animation would be lost).
     - Manifest: scripts/product-image-migration-manifest.json
       Log:      scripts/product-image-migration.log
   ========================================================================== */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MANIFEST = path.join(process.cwd(), "scripts", "product-image-migration-manifest.json");
const LOG = path.join(process.cwd(), "scripts", "product-image-migration.log");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const RESTORE = args.includes("--restore");
function opt(name, dflt) {
  // Accept both "--name value" and "--name=value".
  const eq = args.find((a) => a.startsWith("--" + name + "="));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const QUALITY = Math.min(95, Math.max(40, Number.parseInt(opt("quality", "82"), 10) || 82));
const MAX_DIM = Math.max(320, Number.parseInt(opt("max-width", "1600"), 10) || 1600);
const MIN_SAVING = (Number.parseInt(opt("min-saving", "10"), 10) || 10) * 1024;
const LIMIT = Number.parseInt(opt("limit", "0"), 10) || 0;
const RETRY = Math.max(1, Number.parseInt(opt("retry", "1"), 10) || 1);
const IDS = (opt("ids", "") || "").split(",").map((s) => Number.parseInt(s, 10)).filter(Number.isFinite);

function log(line) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG, `[${stamp}] ${line}\n`);
  console.log(line);
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return { entries: [] }; }
}
function saveManifest(m) { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }

async function convertToWebp(srcPath, destPath) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY; attempt++) {
    try {
      const out = await sharp(srcPath, { failOn: "error" })
        .rotate()
        .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY, alphaQuality: 90 })
        .toBuffer();
      if (out.length === 0) throw new Error("empty output");
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* Collect the exact /uploads/... references on a product (primary + gallery),
   de-duplicated but with a per-product replacement plan. */
function refsOf(p) {
  const refs = new Set();
  if (p.image && p.image.startsWith("/uploads/")) refs.add(p.image);
  for (const g of p.images || []) if (typeof g === "string" && g.startsWith("/uploads/")) refs.add(g);
  return [...refs];
}

async function main() {
  if (RESTORE) return restore();
  return run();
}

async function run() {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  log(`=== product image migration start (${mode}) quality=${QUALITY} maxDim=${MAX_DIM} minSaving=${MIN_SAVING / 1024}KB ===`);
  const products = await prisma.product.findMany({
    where: IDS.length ? { id: { in: IDS } } : undefined,
    select: { id: true, slug: true, image: true, images: true },
    orderBy: { id: "asc" },
  });

  // file → referencing products
  const byFile = new Map();
  for (const p of products) {
    for (const ref of refsOf(p)) {
      if (!byFile.has(ref)) byFile.set(ref, []);
      byFile.get(ref).push(p.id);
    }
  }
  log(`products scanned: ${products.length}; unique local image refs: ${byFile.size}`);

  const manifest = loadManifest();
  const doneMap = new Map(manifest.entries.filter((e) => e.status === "migrated").map((e) => [e.from, e]));
  const results = { converted: 0, skippedSmall: 0, skippedGif: 0, skippedWebp: 0, missing: 0, failed: 0, productsUpdated: 0 };
  const updates = new Map(); // productId → { replacements: Map<from, to> }

  let processed = 0;
  for (const [ref, productIds] of byFile) {
    if (LIMIT && processed >= LIMIT) break;
    const base = ref.replace(/^\/uploads\//, "");
    const srcPath = path.join(UPLOAD_DIR, base);
    const ext = path.extname(base).toLowerCase();

    if (ext === ".webp") { results.skippedWebp++; continue; }
    if (ext === ".gif") { log(`SKIP gif (animation): ${ref}`); results.skippedGif++; continue; }
    if (doneMap.has(ref)) {
      // The WebP was produced (and verified) by an earlier run, but the DB
      // references may still point at the original — e.g. after a partially
      // applied multi-image run. Queue the reference repair if needed.
      const destName = base.replace(/\.[^.]+$/, "") + ".webp";
      const to = "/uploads/" + destName;
      if (APPLY && fs.existsSync(path.join(UPLOAD_DIR, destName))) {
        for (const pid of productIds) {
          if (!updates.has(pid)) updates.set(pid, { replacements: new Map() });
          updates.get(pid).replacements.set(ref, to);
        }
        log(`REPAIR references ${ref} -> ${to} (webp already exists from earlier run)`);
      } else {
        log(`SKIP already migrated: ${ref}`);
      }
      continue;
    }

    let stat;
    try { stat = fs.statSync(srcPath); } catch {
      log(`MISSING file for ${ref} (referenced by products ${productIds.join(",")})`);
      results.missing++;
      continue;
    }

    let out;
    try {
      out = await convertToWebp(srcPath, null);
    } catch (e) {
      log(`FAIL convert ${ref}: ${e.message}`);
      results.failed++;
      continue;
    }
    processed++;

    if (stat.size - out.length < MIN_SAVING) {
      log(`SKIP too small a saving: ${ref} ${(stat.size / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB`);
      results.skippedSmall++;
      continue;
    }

    const destName = base.replace(/\.[^.]+$/, "") + ".webp";
    const destPath = path.join(UPLOAD_DIR, destName);
    if (fs.existsSync(destPath)) {
      // A previous run (or another product) already produced this variant —
      // verify it decodes before referencing it.
      try {
        const meta = await sharp(destPath).metadata();
        if (!meta.width) throw new Error("existing webp undecodable");
      } catch (e) {
        log(`FAIL existing webp invalid ${destName}: ${e.message}`);
        results.failed++;
        continue;
      }
    } else if (!APPLY) {
      // Dry run: do not write anything.
    } else {
      fs.writeFileSync(destPath, out);
      // VERIFY before any reference change: file exists, size matches, decodes.
      const written = fs.statSync(destPath);
      if (written.size !== out.length) { log(`FAIL verify size ${destName}`); results.failed++; fs.unlinkSync(destPath); continue; }
      try {
        const meta = await sharp(destPath).metadata();
        if (!meta.width || !meta.height) throw new Error("undecodable");
      } catch (e) { log(`FAIL verify decode ${destName}`); results.failed++; fs.unlinkSync(destPath); continue; }
    }

    log(`${APPLY ? "MIGRATED" : "WOULD MIGRATE"} ${ref} -> /uploads/${destName}  ${(stat.size / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB  (products ${productIds.join(",")})`);
    results.converted++;
    manifest.entries.push({
      from: ref,
      to: "/uploads/" + destName,
      products: productIds,
      bytesBefore: stat.size,
      bytesAfter: APPLY ? out.length : null,
      appliedAt: APPLY ? new Date().toISOString() : null,
      status: APPLY ? "migrated" : "dry-run",
    });

    if (APPLY) {
      for (const pid of productIds) {
        // Accumulate ALL of a product's replacements and write ONE merged
        // update per product — writing per-ref would let a later ref's stale
        // snapshot overwrite an earlier ref's already-updated fields.
        if (!updates.has(pid)) updates.set(pid, { replacements: new Map() });
        updates.get(pid).replacements.set(ref, "/uploads/" + destName);
      }
    }
  }

  if (APPLY && updates.size) {
    // Reference updates only AFTER all conversions above succeeded: one
    // update per product, applying its merged replacement map to the
    // product's current DB state (fresh read, not the scan snapshot).
    for (const [pid, u] of updates) {
      const cur = await prisma.product.findUnique({ where: { id: pid }, select: { image: true, images: true } });
      if (!cur) continue;
      const repl = (v) => u.replacements.get(v) || v;
      const image = repl(cur.image);
      const images = (cur.images || []).map(repl);
      if (image !== cur.image || JSON.stringify(images) !== JSON.stringify(cur.images)) {
        await prisma.product.update({ where: { id: pid }, data: { image, images } });
        results.productsUpdated++;
      }
    }
    log(`DB references updated on ${results.productsUpdated} product rows.`);
  }

  saveManifest(manifest);
  log(`=== done: ${JSON.stringify(results)} ===`);
}

async function restore() {
  const manifest = loadManifest();
  const migrated = manifest.entries.filter((e) => e.status === "migrated");
  log(`=== restore: ${migrated.length} manifest entries ===`);
  let restored = 0;
  for (const e of migrated) {
    // Only revert when the original file still exists (it must — we never delete).
    if (!fs.existsSync(path.join(UPLOAD_DIR, e.from.replace(/^\/uploads\//, "")))) {
      log(`RESTORE SKIP — original missing: ${e.from}`);
      continue;
    }
    for (const pid of e.products || []) {
      const p = await prisma.product.findUnique({ where: { id: pid }, select: { image: true, images: true } });
      if (!p) continue;
      const image = p.image === e.to ? e.from : p.image;
      const images = (p.images || []).map((g) => (g === e.to ? e.from : g));
      if (image !== p.image || JSON.stringify(images) !== JSON.stringify(p.images)) {
        await prisma.product.update({ where: { id: pid }, data: { image, images } });
        restored++;
      }
    }
    e.status = "restored";
  }
  saveManifest(manifest);
  log(`=== restore done: ${restored} product rows reverted ===`);
}

main()
  .catch((e) => { log("FATAL " + (e && e.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

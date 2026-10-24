import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/* ---- Automatic image optimization ---------------------------------------
   Every authorized admin upload is converted to WebP before it is stored,
   so the admin never converts anything by hand and the storefront always
   receives an optimized file.
   - Quality/dimensions are configurable via env (IMAGE_WEBP_QUALITY 40-95,
     IMAGE_MAX_WIDTH px cap on the longest side).
   - Transparency (PNG/alpha) is preserved by WebP's alpha channel.
   - .rotate() applies EXIF orientation so photos are never sideways, and
     resize(fit:"inside", withoutEnlargement) never upscales.
   - Animated GIFs are stored untouched (WebP conversion would lose frames).
   - If optimization does not actually shrink the file, the original bytes
     are stored instead (never worse than before). */
const WEBP_QUALITY = (() => {
  const n = Number.parseInt(process.env.IMAGE_WEBP_QUALITY ?? "82", 10);
  return Number.isFinite(n) ? Math.min(95, Math.max(40, n)) : 82;
})();
const MAX_DIMENSION = (() => {
  const n = Number.parseInt(process.env.IMAGE_MAX_WIDTH ?? "1600", 10);
  return Number.isFinite(n) && n >= 320 ? n : 1600;
})();

interface OptimizedImage {
  buffer: Buffer;
  ext: string;
}

async function optimizeImage(buffer: Buffer, sniffedExt: string): Promise<OptimizedImage | null> {
  // Animated GIFs: WebP output here would drop animation frames — store as-is.
  if (sniffedExt === "gif") return { buffer, ext: "gif" };
  try {
    const img = sharp(buffer, { failOn: "error" });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;
    // Decompression-bomb guard far above any legitimate product photo.
    if (meta.width > 20000 || meta.height > 20000) return null;
    const out = await img
      .rotate() // no args = auto-orient from EXIF, never damages pixels otherwise
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, alphaQuality: 90 })
      .toBuffer();
    if (out.length === 0) return null;
    // Store the optimized version only when it is genuinely smaller.
    if (out.length >= buffer.length) return { buffer, ext: sniffedExt };
    return { buffer: out, ext: "webp" };
  } catch {
    // Undecodable/corrupt file that still sniffed as an image header.
    return null;
  }
}

function forbidden() {
  return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
}

/**
 * Magic-byte sniffing — the declared MIME type and filename extension are
 * client-controlled and cannot be trusted. The actual bytes determine the
 * type; the extension is then derived from the sniffed type so a renamed
 * HTML/polyglot file can never be stored or served as an image.
 * Returns the canonical extension, or null if the bytes match no allowed type.
 */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg"; // JPEG
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "png";
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "gif"; // GIF87a/GIF89a
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  // ISO-BMFF container (AVIF): "....ftyp" with a brand starting avif/avis
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();

  /* Bodies larger than the server's request-size ceiling (10MB in dev) are
     truncated by Next and fail FormData parsing here — catch that so an
     oversized upload answers with a clean client error instead of an
     unhandled 500. Bodies under the ceiling still hit the explicit 8MB
     MAX_SIZE check below. */
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Upload body could not be read — the file is too large or malformed" },
      { status: 413 }
    );
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ success: false, data: null, error: "No file provided" }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  /* Validate + optimize EVERYTHING first, then write. A failure on file N of
     a multi-file upload therefore cannot leave files 1..N-1 orphaned in
     /public/uploads with no product ever referencing them. */
  const processed: { buffer: Buffer; name: string }[] = [];
  const urls: string[] = [];
  for (const file of files) {
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, data: null, error: `File ${file.name} exceeds 8MB limit` }, { status: 413 });
    }
    // Declared MIME must be present AND allowed — an empty Content-Type is no
    // longer accepted (previously it bypassed this check entirely).
    if (!file.type || !ALLOWED.has(file.type)) {
      return NextResponse.json({ success: false, data: null, error: `File type ${file.type || "(none)"} not allowed` }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Enforce the limit on the REAL byte length, not the declared size.
    if (buffer.length > MAX_SIZE) {
      return NextResponse.json({ success: false, data: null, error: `File ${file.name} exceeds 8MB limit` }, { status: 413 });
    }

    // Authoritative type check: sniff the magic bytes. The stored extension
    // comes from the sniffed type (never the client filename), and must agree
    // with the declared MIME family.
    const sniffedExt = sniffImageType(buffer);
    if (!sniffedExt) {
      return NextResponse.json({ success: false, data: null, error: `File ${file.name} is not a valid JPEG/PNG/WebP/GIF/AVIF image` }, { status: 415 });
    }
    const declaredFamily = file.type.replace("image/", ""); // jpeg|png|webp|gif|avif
    const sniffedFamily = sniffedExt === "jpg" ? "jpeg" : sniffedExt;
    if (declaredFamily !== sniffedFamily) {
      return NextResponse.json({ success: false, data: null, error: `File ${file.name} content does not match its declared type` }, { status: 415 });
    }

    const optimized = await optimizeImage(buffer, sniffedExt);
    if (!optimized) {
      return NextResponse.json({ success: false, data: null, error: `File ${file.name} could not be processed as an image` }, { status: 415 });
    }

    // Random server-generated name: no traversal, no overwrite, no extension
    // under attacker control.
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${optimized.ext}`;
    processed.push({ buffer: optimized.buffer, name });
    urls.push(`/uploads/${name}`);
  }

  for (const item of processed) {
    try {
      await writeFile(path.join(UPLOAD_DIR, item.name), item.buffer);
    } catch (err) {
      // Never leave a half-written file behind for the failed object; the
      // already-written siblings stay (they are valid, though unreferenced).
      try { await unlink(path.join(UPLOAD_DIR, item.name)); } catch { /* best effort */ }
      return NextResponse.json({ success: false, data: null, error: "Failed to store uploaded image" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, data: { urls }, error: null });
}

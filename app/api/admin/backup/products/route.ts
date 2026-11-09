import { NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createZip, type ZipEntry } from "@/lib/backup-zip";

export const dynamic = "force-dynamic";

/* Full product catalogue backup (ZIP download, ADMIN only).
   Exports EVERY product row with all stored scalar fields plus the full
   relation trees (colours, sizes, gallery images, custom attribute values,
   related-product links, stock movements), and the ACTUAL image files from
   the local uploads storage. Nothing is deleted or modified — read-only. */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const BATCH = 200;

interface ImageRef {
  file: string;
  products: number[];
  roles: string[];
}

function collectImageName(url: unknown, productId: number, role: string, refs: Map<string, ImageRef>): void {
  if (typeof url !== "string" || !url) return;
  const match = url.match(/\/uploads\/([^/?#]+)/);
  if (!match) return; // external URL or non-uploads path: recorded, not downloadable
  let name: string;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    name = match[1];
  }
  if (!name) return;
  const ref = refs.get(name) ?? { file: name, products: [], roles: [] };
  if (!ref.products.includes(productId)) ref.products.push(productId);
  if (!ref.roles.includes(role)) ref.roles.push(role);
  refs.set(name, ref);
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbCount = await prisma.product.count();
  const products: object[] = [];
  let cursor: number | undefined;
  // Cursor pagination so large catalogues never truncate.
  for (;;) {
    const batch = await prisma.product.findMany({
      take: BATCH,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        colors: true,
        sizes: true,
        mediaImages: true,
        customValues: true,
        relatedFrom: true,
        relatedTo: true,
        stockMovements: true,
      },
    });
    if (!batch.length) break;
    products.push(...batch);
    cursor = batch[batch.length - 1].id;
    if (products.length >= dbCount) break;
  }

  // Collect every image reference (main, gallery array, gallery table rows).
  const refs = new Map<string, ImageRef>();
  for (const raw of products) {
    const p = raw as {
      id: number; image: string; images: string[]; mediaImages: { url: string; isPrimary: boolean }[];
    };
    collectImageName(p.image, p.id, "main", refs);
    for (const url of p.images ?? []) collectImageName(url, p.id, "gallery", refs);
    for (const im of p.mediaImages ?? [])
      collectImageName(im.url, p.id, im.isPrimary ? "primary-gallery" : "gallery", refs);
  }

  const entries: ZipEntry[] = [];
  const imageManifest: object[] = [];
  const missingImages: object[] = [];
  /* Include the WHOLE uploads store, not just product-referenced files:
     disaster recovery must not lose unreferenced leftovers either.
     Referenced files are annotated with the products that use them. */
  const referencedNames = new Set(refs.keys());
  let diskImages = 0;
  try {
    for (const diskName of await readdir(UPLOAD_DIR)) {
      diskImages++;
      if (referencedNames.has(diskName)) continue;
      const data = await readFile(path.join(UPLOAD_DIR, diskName));
      entries.push({ name: `images/${diskName}`, data });
      imageManifest.push({ file: `images/${diskName}`, originalName: diskName, storage: "local:public/uploads", referenced: false, products: [], roles: [] });
    }
  } catch { /* uploads dir missing: referenced-file pass below reports what is missing */ }
  void diskImages;
  for (const [name, meta] of refs) {
    const safe = path.basename(name); // never escape the uploads directory
    try {
      const data = await readFile(path.join(UPLOAD_DIR, safe));
      entries.push({ name: `images/${safe}`, data });
      imageManifest.push({ file: `images/${safe}`, products: [...meta.products], roles: [...meta.roles], storage: "local:public/uploads" });
    } catch {
      missingImages.push({ file: safe, reason: "file not found in local uploads storage", products: [...meta.products], roles: [...meta.roles] });
    }
  }

  const exportedAt = new Date().toISOString();
  entries.push({
    name: "products.json",
    data: Buffer.from(
      JSON.stringify(
        {
          schema: "nassim-products-backup/1",
          exportedAt,
          counts: { dbProducts: dbCount, exportedProducts: products.length },
          products,
        },
        null,
        1,
      ),
      "utf8",
    ),
  });
  entries.push({
    name: "manifest.json",
    data: Buffer.from(
      JSON.stringify(
        {
          type: "products",
          exportedAt,
          counts: {
            dbProducts: dbCount,
            exportedProducts: products.length,
            images: imageManifest.length,
            missingImages: missingImages.length,
          },
          storage: { bucket: "local:public/uploads", note: "image files live under public/uploads on the app server" },
          images: imageManifest,
          missingImages,
        },
        null,
        1,
      ),
      "utf8",
    ),
  });

  const zip = createZip(entries);
  const date = exportedAt.slice(0, 10);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="nassim-full-products-backup-${date}.zip"`,
      "Content-Length": String(zip.length),
      "X-Product-Count": String(products.length),
      "X-Image-Count": String(imageManifest.length),
      "X-Missing-Image-Count": String(missingImages.length),
      "Cache-Control": "no-store",
    },
  });
}

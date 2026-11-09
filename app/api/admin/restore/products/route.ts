import { NextResponse } from "next/server";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readZip } from "@/lib/backup-zip";

export const dynamic = "force-dynamic";

/* NON-DESTRUCTIVE product restore (ADMIN only).
   Validates a previously downloaded products backup ZIP and imports the
   products that do not already exist. Existing records are NEVER modified
   or deleted: an archive product whose id OR slug already exists is skipped
   and reported as a conflict. Image files are written only when absent on
   disk. POST ?dryRun=1 returns the full validation report and changes
   nothing. */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const CHUNK_DIR = path.join(os.tmpdir(), "nassim-restore");
const BATCH = 500;

interface ArchiveProduct {
  id?: number;
  slug?: string;
  name?: string;
  categoryId?: number;
  image?: string;
  images?: string[];
  mediaImages?: { url?: string; isPrimary?: boolean; sortOrder?: number }[];
  colors?: { colorId?: number }[];
  sizes?: { sizeId?: number }[];
  customValues?: { attributeId?: number; value?: string }[];
  relatedFrom?: { productId?: number; relatedId?: number; displayOrder?: number }[];
  relatedTo?: { productId?: number; relatedId?: number; displayOrder?: number }[];
  stockMovements?: { delta?: number; reason?: string; note?: string; actorId?: number | null; createdAt?: string }[];
  [key: string]: unknown;
}

function uploadedName(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  const match = url.match(/\/uploads\/([^/?#]+)/);
  if (!match) return null;
  try {
    return path.basename(decodeURIComponent(match[1]));
  } catch {
    return path.basename(match[1]);
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  /* The archive arrives CHUNKED as raw octet-stream slices (the dev server
     caps single request bodies at ~10MB and multipart breaks even earlier).
     The client sends ?uploadId + ?chunk per slice and ?last=1 on the final
     one; slices are appended into a temp file, which is parsed and deleted
     once complete. */
  let bytes: Buffer;
  const contentType = req.headers.get("content-type") ?? "";
  const uploadId = (url.searchParams.get("uploadId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
  const isLast = url.searchParams.get("last") === "1";

  if (uploadId && Number.isFinite(chunkIndex) && !(contentType.includes("multipart/form-data"))) {
    const slice = Buffer.from(await req.arrayBuffer());
    await mkdir(CHUNK_DIR, { recursive: true });
    const partPath = path.join(CHUNK_DIR, `products-${uploadId}.part`);
    await writeFile(partPath, slice, chunkIndex === 0 ? {} : { flag: "a" });
    if (!isLast) return NextResponse.json({ ok: true, received: slice.length });
    bytes = await readFile(partPath);
    await rm(partPath, { force: true });
  } else {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach the backup ZIP as the file field" }, { status: 400 });
    bytes = Buffer.from(await file.arrayBuffer());
  }
  let files: Map<string, Buffer>;
  try {
    files = readZip(bytes).files;
  } catch (err) {
    return NextResponse.json({ error: `Cannot read archive (${bytes.length} bytes received): ${(err as Error).message}` }, { status: 400 });
  }

  try {
    return await runRestore(dryRun, files);
  } catch (err) {
    return NextResponse.json({ error: `Restore failed: ${(err as Error).message}` }, { status: 500 });
  }
}

async function runRestore(dryRun: boolean, files: Map<string, Buffer>) {

  const productsRaw = files.get("products.json");
  if (!productsRaw) return NextResponse.json({ error: "products.json is missing from the archive" }, { status: 400 });
  let parsed: { products?: ArchiveProduct[] };
  try {
    parsed = JSON.parse(productsRaw.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "products.json is not valid JSON" }, { status: 400 });
  }
  const archived = Array.isArray(parsed.products) ? parsed.products : null;
  if (!archived) return NextResponse.json({ error: "products.json does not contain a products array" }, { status: 400 });

  // Live reference maps (batched reads — no truncation on large catalogues).
  const liveProducts = new Map<number, string>();
  let cursor: number | undefined;
  for (;;) {
    const batch = await prisma.product.findMany({
      take: BATCH,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, slug: true },
    });
    if (!batch.length) break;
    for (const p of batch) liveProducts.set(p.id, p.slug);
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }
  const liveSlugs = new Set(liveProducts.values());
  const liveCategories = new Set((await prisma.category.findMany({ select: { id: true } })).map((c) => c.id));
  const liveColors = new Set((await prisma.color.findMany({ select: { id: true } })).map((c) => c.id));
  const liveSizes = new Set((await prisma.size.findMany({ select: { id: true } })).map((c) => c.id));
  const liveAttributes = new Set((await prisma.customAttribute.findMany({ select: { id: true } })).map((c) => c.id));

  const report = {
    productsInArchive: archived.length,
    imagesInArchive: [...files.keys()].filter((n) => n.startsWith("images/")).length,
    restorable: 0,
    conflicts: [] as { id?: number; slug?: string; reason: string }[],
    invalid: [] as { index: number; reason: string }[],
    missingCategories: [] as { id?: number; slug?: string; categoryId: number }[],
    missingImages: [] as { product: string; file: string }[],
    imagesToWrite: 0,
  };

  for (let index = 0; index < archived.length; index++) {
    const p = archived[index];
    const label = p?.slug ?? `#${p?.id ?? index}`;
    if (!p || typeof p !== "object" || typeof p.id !== "number" || typeof p.slug !== "string" || !p.slug || typeof p.name !== "string") {
      report.invalid.push({ index, reason: "missing id, slug or name" });
      continue;
    }
    if (liveProducts.has(p.id) || liveSlugs.has(p.slug)) {
      report.conflicts.push({ id: p.id, slug: p.slug, reason: "a product with this id or slug already exists — existing record preserved" });
      continue;
    }
    if (typeof p.categoryId !== "number" || !liveCategories.has(p.categoryId)) {
      report.missingCategories.push({ id: p.id, slug: p.slug, categoryId: p.categoryId ?? -1 });
      continue;
    }
    for (const url of [p.image, ...(p.images ?? []), ...(p.mediaImages ?? []).map((im) => im?.url)]) {
      const name = uploadedName(url);
      if (!name) continue;
      if (!files.has(`images/${name}`)) report.missingImages.push({ product: label, file: name });
    }
    report.restorable++;
  }

  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, report });

  let created = 0;
  let imagesWritten = 0;
  let imagesKept = 0;
  const createdIds: number[] = [];
  for (const p of archived) {
    if (!p || typeof p.id !== "number" || typeof p.slug !== "string" || !p.slug || typeof p.name !== "string") continue;
    if (liveProducts.has(p.id) || liveSlugs.has(p.slug)) continue;
    if (typeof p.categoryId !== "number" || !liveCategories.has(p.categoryId)) continue;

    const {
      id, slug, name, categoryId, image, images, mediaImages, colors, sizes, customValues, relatedFrom, relatedTo, stockMovements,
      ...scalars
    } = p;

    for (const url of [image, ...(images ?? []), ...(mediaImages ?? []).map((im) => im?.url)]) {
      const fileName = uploadedName(url);
      if (!fileName) continue;
      const entry = files.get(`images/${fileName}`);
      if (!entry) continue;
      const diskPath = path.join(UPLOAD_DIR, fileName);
      try {
        await writeFile(diskPath, entry, { flag: "wx" }); // never overwrite an existing file
        imagesWritten++;
      } catch {
        imagesKept++; // file already exists on disk — preserved as-is
      }
    }

    const createData = {
      ...(scalars as object),
        id, slug, name, categoryId,
        colors: {
          create: (colors ?? [])
            .filter((c) => typeof c?.colorId === "number" && liveColors.has(c.colorId))
            .map((c) => ({ colorId: c.colorId as number })),
        },
        sizes: {
          create: (sizes ?? [])
            .filter((s) => typeof s?.sizeId === "number" && liveSizes.has(s.sizeId))
            .map((s) => ({ sizeId: s.sizeId as number })),
        },
        mediaImages: {
          create: (mediaImages ?? [])
            .filter((im) => typeof im?.url === "string")
            .map((im) => ({ url: im.url as string, isPrimary: !!im.isPrimary, sortOrder: im.sortOrder ?? 0 })),
        },
        customValues: {
          create: (customValues ?? [])
            .filter((cv) => typeof cv?.attributeId === "number" && liveAttributes.has(cv.attributeId))
            .map((cv) => ({ attributeId: cv.attributeId as number, value: cv.value ?? "" })),
        },
      } as unknown as Parameters<typeof prisma.product.create>[0]["data"];
    await prisma.product.create({ data: createData });
    created++;
    createdIds.push(id);
  }

  // Related-product links are restored after all products exist (order-safe).
  let relatedCreated = 0;
  for (const p of archived) {
    if (!p || typeof p.id !== "number" || !createdIds.includes(p.id)) continue;
    for (const rel of [...(p.relatedFrom ?? []), ...(p.relatedTo ?? [])]) {
      if (typeof rel?.productId !== "number" || typeof rel?.relatedId !== "number") continue;
      if (!liveProducts.has(rel.productId) && !createdIds.includes(rel.productId)) continue;
      if (!liveProducts.has(rel.relatedId) && !createdIds.includes(rel.relatedId)) continue;
      try {
        await prisma.relatedProduct.create({ data: { productId: rel.productId, relatedId: rel.relatedId, displayOrder: rel.displayOrder ?? 0 } });
        relatedCreated++;
      } catch {
        /* duplicate link rows are skipped; the parent product stays intact */
      }
    }
  }

  return NextResponse.json({
    ok: true,
    result: { ...report, created, imagesWritten, imagesKept, relatedCreated },
  });
}

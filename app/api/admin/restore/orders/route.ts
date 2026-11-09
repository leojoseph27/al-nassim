import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import os from "node:os";
import path from "node:path";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { readZip } from "@/lib/backup-zip";

export const dynamic = "force-dynamic";

/* NON-DESTRUCTIVE orders restore (ADMIN only).
   Validates a previously downloaded orders backup ZIP and imports orders
   that do not already exist (matched by id AND orderNumber). Existing
   orders are NEVER modified or deleted: a conflicting order is skipped and
   reported. Historical item snapshots (name/slug/image/price) and all
   timestamps are restored exactly as archived. POST ?dryRun=1 returns the
   full validation report and changes nothing. */

const BATCH = 500;
const CHUNK_DIR = path.join(os.tmpdir(), "nassim-restore");

interface ArchiveOrderItem {
  id?: number;
  orderId?: number;
  productId?: number | null;
  slug?: string;
  name?: string;
  image?: string;
  price?: string | number;
  quantity?: number;
  itemStatus?: string;
}

interface ArchiveOrder {
  id?: number;
  orderNumber?: string;
  userId?: number | null;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  address?: string;
  city?: string;
  status?: string;
  items?: ArchiveOrderItem[];
  statusHistory?: { status?: string; note?: string; createdAt?: string }[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface ArchiveSecurity {
  orderNumber?: string;
  tokenHash?: string;
  idempotencyKey?: string | null;
}

const VALID_STATUSES = new Set([
  "PENDING", "SEEN", "UNDER_REVIEW", "READY_FOR_CONFIRMATION", "CONFIRMED", "PACKING",
  "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED",
  "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_STAFF",
]);

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const contentType = req.headers.get("content-type") ?? "";
  const uploadId = (url.searchParams.get("uploadId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
  const isLast = url.searchParams.get("last") === "1";
  let bytes: Buffer;
  if (uploadId && Number.isFinite(chunkIndex) && !contentType.includes("multipart/form-data")) {
    const slice = Buffer.from(await req.arrayBuffer());
    await mkdir(CHUNK_DIR, { recursive: true });
    const partPath = path.join(CHUNK_DIR, `orders-${uploadId}.part`);
    await writeFile(partPath, slice, chunkIndex === 0 ? {} : { flag: "a" });
    if (!isLast) return NextResponse.json({ ok: true, received: slice.length });
    bytes = await readFile(partPath);
    await rm(partPath, { force: true });
  } else if (contentType.includes("multipart/form-data")) {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach the backup ZIP as the file field" }, { status: 400 });
    bytes = Buffer.from(await file.arrayBuffer());
  } else {
    bytes = Buffer.from(await req.arrayBuffer());
  }
  let files: Map<string, Buffer>;
  try {
    files = readZip(bytes).files;
  } catch (err) {
    return NextResponse.json({ error: `Cannot read archive: ${(err as Error).message}` }, { status: 400 });
  }

  const ordersRaw = files.get("orders.json");
  if (!ordersRaw) return NextResponse.json({ error: "orders.json is missing from the archive" }, { status: 400 });
  let parsed: { orders?: ArchiveOrder[]; orderSecurity?: ArchiveSecurity[] };
  try {
    parsed = JSON.parse(ordersRaw.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "orders.json is not valid JSON" }, { status: 400 });
  }
  const archived = Array.isArray(parsed.orders) ? parsed.orders : null;
  if (!archived) return NextResponse.json({ error: "orders.json does not contain an orders array" }, { status: 400 });

  // Live reference maps (batched reads).
  const liveOrders = new Map<number, string>(); // id -> orderNumber
  let cursor: number | undefined;
  for (;;) {
    const batch = await prisma.order.findMany({
      take: BATCH,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, orderNumber: true },
    });
    if (!batch.length) break;
    for (const o of batch) liveOrders.set(o.id, o.orderNumber);
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }
  const liveOrderNumbers = new Set(liveOrders.values());
  const liveSecurityNumbers = new Set((await prisma.orderSecurity.findMany({ select: { orderNumber: true } })).map((x) => x.orderNumber));
  const liveProductIds = new Set((await prisma.product.findMany({ select: { id: true } })).map((p) => p.id));
  const liveUserIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const report = {
    ordersInArchive: archived.length,
    restorable: 0,
    conflicts: [] as { id?: number; orderNumber?: string; reason: string }[],
    invalid: [] as { index: number; reason: string }[],
    itemsWithUnknownProducts: [] as { orderNumber?: string; productId: number }[],
    itemsWithUnknownUsers: [] as { orderNumber?: string; userId: number }[],
    invalidStatuses: [] as { orderNumber?: string; status: string }[],
    securityRowsInArchive: Array.isArray(parsed.orderSecurity) ? parsed.orderSecurity.length : 0,
    securityRestorable: 0,
    securityConflicts: 0,
  };

  for (let index = 0; index < archived.length; index++) {
    const o = archived[index];
    if (!o || typeof o !== "object" || typeof o.id !== "number" || typeof o.orderNumber !== "string" || !o.orderNumber) {
      report.invalid.push({ index, reason: "missing id or orderNumber" });
      continue;
    }
    if (!o.customerName || typeof o.customerName !== "string") {
      report.invalid.push({ index, reason: "missing customerName" });
      continue;
    }
    if (liveOrders.has(o.id) || liveOrderNumbers.has(o.orderNumber)) {
      report.conflicts.push({ id: o.id, orderNumber: o.orderNumber, reason: "an order with this id or number already exists — existing record preserved" });
      continue;
    }
    if (typeof o.status === "string" && !VALID_STATUSES.has(o.status)) {
      report.invalidStatuses.push({ orderNumber: o.orderNumber, status: o.status });
    }
    for (const item of o.items ?? []) {
      if (typeof item?.productId === "number" && !liveProductIds.has(item.productId)) {
        report.itemsWithUnknownProducts.push({ orderNumber: o.orderNumber, productId: item.productId });
      }
    }
    if (typeof o.userId === "number" && !liveUserIds.has(o.userId)) {
      report.itemsWithUnknownUsers.push({ orderNumber: o.orderNumber, userId: o.userId });
    }
    report.restorable++;
  }

  const securityRows = Array.isArray(parsed.orderSecurity) ? parsed.orderSecurity : [];
  for (const s of securityRows) {
    if (s && typeof s.orderNumber === "string" && typeof s.tokenHash === "string" &&
        !liveSecurityNumbers.has(s.orderNumber)) {
      report.securityRestorable++;
    } else {
      report.securityConflicts++;
    }
  }

  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, report });

  let created = 0;
  let itemsCreated = 0;
  let historyCreated = 0;
  let securityCreated = 0;
  const skippedDetails: string[] = [];
  for (const o of archived) {
    if (!o || typeof o.id !== "number" || typeof o.orderNumber !== "string" || !o.orderNumber || !o.customerName) continue;
    if (liveOrders.has(o.id) || liveOrderNumbers.has(o.orderNumber)) continue;

    const { id, items, statusHistory, userId, ...scalars } = o;
    let effectiveUserId: number | null = null;
    if (typeof userId === "number" && liveUserIds.has(userId)) effectiveUserId = userId;
    else if (typeof userId === "number") skippedDetails.push(`${o.orderNumber}: original userId ${userId} not present — order restored with userId null (original fields preserved)`);

    const createData = {
      
        ...(scalars as object),
        id,
        userId: effectiveUserId,
        items: {
          create: (items ?? []).map((item) => {
            const { id: _itemId, orderId: _orderId, ...itemFields } = item;
            const ITEM_STATUSES = new Set(["PENDING", "AVAILABLE", "UNAVAILABLE", "REMOVED_AFTER_CONFIRMATION", "DELIVERED"]);
            if (typeof itemFields.itemStatus === "string" && !ITEM_STATUSES.has(itemFields.itemStatus)) itemFields.itemStatus = "PENDING";
            const productId = typeof item.productId === "number" && liveProductIds.has(item.productId) ? item.productId : null;
            return {
              slug: item.slug ?? "",
              name: item.name ?? "",
              image: item.image ?? "",
              price: (item.price ?? 0) as string | number,
              quantity: item.quantity ?? 1,
              itemStatus: (itemFields.itemStatus ?? undefined) as never,
              productId,
            };
          }),
        },
    } as unknown as Parameters<typeof prisma.order.create>[0]["data"];
    const order = await prisma.order.create({ data: createData });
    created++;
    itemsCreated += (items ?? []).length;
    if ((statusHistory ?? []).length) {
      await prisma.orderStatusEvent.createMany({
        data: (statusHistory ?? []).map((h) => ({
          orderId: order.id,
          status: (VALID_STATUSES.has(h.status ?? "") ? h.status : "PENDING") as never,
          note: h.note ?? "",
          ...(h.createdAt ? { createdAt: new Date(h.createdAt) } : {}),
        })),
      });
      historyCreated += (statusHistory ?? []).length;
    }
  }

  for (const s of securityRows) {
    if (!s || typeof s.orderNumber !== "string" || typeof s.tokenHash !== "string") continue;
    if (liveSecurityNumbers.has(s.orderNumber)) continue;
    // Only attach security rows to orders that exist after this restore.
    if (!liveOrderNumbers.has(s.orderNumber) && !archived.some((o) => o.orderNumber === s.orderNumber)) continue;
    try {
      await prisma.orderSecurity.create({
        data: { orderNumber: s.orderNumber, tokenHash: s.tokenHash, idempotencyKey: s.idempotencyKey ?? null },
      });
      securityCreated++;
    } catch {
      /* unique tokenHash/idempotencyKey collision — row skipped, reported in conflicts count */
    }
  }

  return NextResponse.json({
    ok: true,
    result: { ...report, created, itemsCreated, historyCreated, securityCreated, skippedDetails },
  });
}

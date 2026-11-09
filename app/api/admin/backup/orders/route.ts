import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createZip, type ZipEntry } from "@/lib/backup-zip";

export const dynamic = "force-dynamic";

/* Full order backup (ZIP download, ADMIN only).
   Exports EVERY order with all stored fields, its items (historical price
   snapshots preserved verbatim), status history, notifications and the
   order-security rows (token HASHES only — raw tokens are never stored).
   No user credentials (password hashes) are ever included. Read-only. */

const BATCH = 200;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbCount = await prisma.order.count();
  const orders: object[] = [];
  let cursor: number | undefined;
  for (;;) {
    const batch = await prisma.order.findMany({
      take: BATCH,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { items: true, statusHistory: true, notifications: true },
    });
    if (!batch.length) break;
    orders.push(...batch);
    cursor = batch[batch.length - 1].id;
    if (orders.length >= dbCount) break;
  }

  const security = await prisma.orderSecurity.findMany();
  const exportedAt = new Date().toISOString();
  const entries: ZipEntry[] = [
    {
      name: "orders.json",
      data: Buffer.from(
        JSON.stringify(
          {
            schema: "nassim-orders-backup/1",
            exportedAt,
            counts: { dbOrders: dbCount, exportedOrders: orders.length },
            orders,
            orderSecurity: security,
          },
          null,
          1,
        ),
        "utf8",
      ),
    },
    {
      name: "manifest.json",
      data: Buffer.from(
        JSON.stringify(
          {
            type: "orders",
            exportedAt,
            counts: { dbOrders: dbCount, exportedOrders: orders.length, orderSecurityRows: security.length },
            notes: [
              "Order items keep the historical name/slug/image/price snapshot exactly as stored at purchase time.",
              "orderSecurity rows contain token HASHES, never raw customer tokens.",
              "No user credentials (password hashes) are included in this archive.",
            ],
          },
          null,
          1,
        ),
        "utf8",
      ),
    },
  ];

  const zip = createZip(entries);
  const date = exportedAt.slice(0, 10);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="nassim-full-orders-backup-${date}.zip"`,
      "Content-Length": String(zip.length),
      "X-Order-Count": String(orders.length),
      "Cache-Control": "no-store",
    },
  });
}

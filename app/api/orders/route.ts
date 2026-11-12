import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { calculateBillableTotals } from "@/lib/order-workflow";
import { generateOrderAccessToken, hashOrderAccessToken } from "@/lib/order-access";
import { orderShortPath } from "@/lib/order-link";
import { resolveCustomerOrigin } from "@/lib/public-origin";
import { autoNotifyAfterOrder } from "@/lib/whatsapp-automation";
import { getShippingRule, computeShipping } from "@/lib/shipping";
import { rateLimit, getClientIp } from "@/lib/security";
import { notifyStaffOfNewOrder } from "@/lib/web-push";
import type { Order } from "@prisma/client";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// NOTE: `shipping` is deliberately NOT accepted from the client — the fee is
// derived server-side (lib/shipping.ts). Unknown body keys are stripped by
// zod, so existing storefront payloads that still include it keep working.
const orderSchema = z.object({
  customerName: z.string().min(2).max(100),
  customerEmail: z.union([
    z.string().email(),
    z.literal(""),
    z.undefined(),
  ]).transform((v) => (v ? String(v).toLowerCase() : "")).default(""),
  customerPhone: z.string().min(6).max(30),
  address: z.string().min(3).max(500),
  city: z.string().min(2).max(100),
  notes: z.string().max(1000).optional().default(""),
  items: z
    .array(
      z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        image: z.string().max(1000).optional().default(""),
        price: z.number(),
        qty: z.number().int().min(1).max(999),
      })
    )
    .min(1)
    .max(100),
  currency: z.string().max(10).optional().default("KD"),
});

const IDEMPOTENCY_HEADER = "x-idempotency-key";
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

/** Shape shared by the fresh-create response and idempotent replays. */
function orderResponse(order: Order & { items: Prisma.OrderItemGetPayload<object>[] }, accessToken: string | null, idempotentReplay: boolean) {
  return NextResponse.json({
    success: true,
    order: { orderNumber: order.orderNumber },
    data: {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        currency: order.currency,
        // Raw capability token for guest order tracking — returned once here
        // (and on idempotent replays of the SAME submission). Never logged.
        accessToken,
        // Signed short public link (/o/{id}-{signature}) — the customer-facing order link for the guest flow.
        shortPath: orderShortPath(order.id),
        idempotentReplay,
        ...calculateBillableTotals(
          (order.items as { price: unknown; quantity: number; itemStatus: string }[]).map((i) => ({ price: i.price, quantity: i.quantity, itemStatus: i.itemStatus })),
          order.shipping
        ),
        items: order.items.map((i) => ({
          id: i.id,
          slug: i.slug,
          name: i.name,
          qty: i.quantity,
          price: Number(i.price),
          itemStatus: i.itemStatus,
        })),
      },
    },
    error: null,
  });
}

export async function POST(req: NextRequest) {
  // Abuse guard: order creation is guest-accessible and commits a real order
  // on every call. 8 orders / 10 minutes / IP is far above any legitimate
  // customer rate while capping spam and duplicate floods.
  const ip = getClientIp(req);
  const rl = rateLimit(`orders:${ip}`, { max: 8, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, data: null, error: "Too many orders from this connection. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, data: null, error: "Invalid request body" }, { status: 400 });
  }
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: "Please fill in all required fields correctly." },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Idempotency: the checkout client generates ONE key per submission attempt
  // and sends it as a header. A replay (double-click, retry after a lost
  // response, refresh) returns the original order instead of creating a
  // duplicate and reserving stock twice. The pre-check here catches the
  // common case cheaply; the unique index inside the transaction catches the
  // concurrent race.
  const rawIdemKey = req.headers.get(IDEMPOTENCY_HEADER);
  let idempotencyKey: string | null = null;
  if (rawIdemKey !== null) {
    const k = idempotencyKeySchema.safeParse(rawIdemKey);
    if (!k.success) {
      return NextResponse.json({ success: false, data: null, error: "Invalid idempotency key" }, { status: 400 });
    }
    idempotencyKey = k.data;
    const existingSec = await prisma.orderSecurity.findUnique({ where: { idempotencyKey } });
    if (existingSec) {
      const existing = await prisma.order.findUnique({
        where: { orderNumber: existingSec.orderNumber },
        include: { items: true },
      });
      if (existing) return orderResponse(existing, null, true);
    }
  }

  // Verify products exist and are active. NO online-stock validation happens
  // here: a storefront order is a customer REQUEST — availability is confirmed
  // by store staff over the phone (internal Order Page), never by blocking
  // checkout. Product.stock is left untouched at placement; because no
  // reservation ledger rows are written for the order, the later *_RESTORE
  // operations in lib/online-stock.ts are correct no-ops for it (same
  // treatment as legacy pre-ledger orders).
  const slugs = Array.from(new Set(input.items.map((i) => i.slug)));
  const products = await prisma.product.findMany({ where: { slug: { in: slugs }, isActive: true } });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  for (const item of input.items) {
    const product = bySlug.get(item.slug);
    if (!product) {
      return NextResponse.json(
        { success: false, data: null, error: `Product "${item.name}" is no longer available.` },
        { status: 400 }
      );
    }
  }

  const user = await getSessionUser();

  // SERVER-AUTHORITATIVE shipping rule (Setting-configurable): below the
  // threshold a flat fee applies, at or above it shipping is free. The fee
  // is computed from the SERVER-side subtotal below (DB product prices) —
  // the client-sent value, if any, is never read, so a manipulated payload
  // cannot change the order total.
  const shippingRule = await getShippingRule();

  // Guest-tracking capability token: raw value returned once in the response;
  // only its SHA-256 hash is stored (see lib/order-access.ts).
  const accessToken = generateOrderAccessToken();

  try {
    const order = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const orderItems = input.items.map((item) => {
        const product = bySlug.get(item.slug)!;
        const price = Number(product.price);
        subtotal += price * item.qty;
        return {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          image: product.image,
          price: product.price,
          quantity: item.qty,
          itemStatus: "PENDING" as const,
        };
      });
      // Threshold decision from the SERVER-side subtotal just accumulated
      // (never a client-supplied amount).
      const shipping = computeShipping(subtotal, shippingRule);
      const total = subtotal + shipping;

      // Order number: ORD-<n> from the dedicated Postgres sequence. nextval()
      // is atomic, so concurrent checkouts each get a distinct number without
      // lock contention on the Order table, and deleted/cancelled orders never
      // cause a number to be reused.
      const seqRows = await tx.$queryRaw<{ next_num: bigint }[]>(
        Prisma.sql`SELECT nextval('order_number_seq') AS next_num`
      );
      const orderNumber = `ORD-${Number(seqRows[0].next_num)}`;

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: user?.id ?? null,
          // Permanent ownership snapshot — captured once at checkout and never
          // mutated, even if the placing account is later deleted. This is the
          // stable ownership identifier (and historical email for records).
          // The live userId/customerEmail above may be nulled/tombstoned on
          // account deletion; these snapshot fields always identify the order.
          originalUserId: user?.id ?? null,
          originalUserEmail: user?.email ?? input.customerEmail,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          address: input.address,
          city: input.city,
          notes: input.notes,
          currency: input.currency,
          subtotal,
          shipping,
          total,
          status: "PENDING",
          items: { create: orderItems },
          statusHistory: { create: { status: "PENDING", note: "Order placed" } },
        },
        include: { items: true },
      });

      // Security metadata (capability-token hash + idempotency key) commits
      // atomically with the order. A concurrent duplicate submission with the
      // same key loses the unique-index race (P2002) and is converted into a
      // replay of the winner in the catch below — stock is never reserved twice.
      await tx.orderSecurity.create({
        data: {
          orderNumber,
          tokenHash: hashOrderAccessToken(accessToken),
          idempotencyKey,
        },
      });

      // Checkout consumes the ordered items: remove them from the ordering
      // user's SERVER cart (the client clears its localStorage cart on
      // success). Without this, a logged-in customer's next cart visit
      // re-merges the just-ordered items back in, inviting duplicate orders.
      // Only the ordered products are removed — items that were not part of
      // this order (e.g. added from another device) stay in the cart.
      if (user) {
        await tx.cartItem.deleteMany({
          where: {
            userId: user.id,
            productId: { in: [...new Set(orderItems.map((i) => i.productId))] },
          },
        });
      }

      return created;
    });

    // Web Push to staff devices — fired ONLY for a genuinely NEW order (this
    // code path is unreachable for idempotent replays, which return earlier).
    // notifyStaffOfNewOrder never throws, so checkout can never fail because
    // of push delivery problems.
    await notifyStaffOfNewOrder({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      total: Number(order.total),
      currency: order.currency,
    });

    /* AUTOMATIC WHATSAPP NOTIFICATION — fired ONLY here, after the backend
       has confirmed a FRESH order creation (idempotent replays return
       earlier and never reach this line, so a browser retry/refresh can
       never duplicate the message). The link origin comes from the central
       environment-aware resolver (lib/public-origin.ts): in production the
       configured APP_BASE_URL domain always wins; in development the
       trusted origin of THIS customer request (LAN origin, current ngrok
       tunnel) is used, falling back to APP_BASE_URL.
       Fire-and-forget by contract: the order response is already final,
       WhatsApp is an additional notification — an offline/disconnected/
       failed send is recorded on the order as FAILED for staff retry and
       never affects the order response. */
    void autoNotifyAfterOrder(order.id, resolveCustomerOrigin(req.headers) || undefined);

    return orderResponse(order, accessToken, false);
  } catch (err) {
    // Lost idempotency race: an identical concurrent submission (same key)
    // committed microseconds earlier — return its order instead of a duplicate.
    if (
      idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const sec = await prisma.orderSecurity.findUnique({ where: { idempotencyKey } });
      if (sec) {
        const existing = await prisma.order.findUnique({
          where: { orderNumber: sec.orderNumber },
          include: { items: true },
        });
        if (existing) return orderResponse(existing, null, true);
      }
    }
    console.error("Order creation failed:", err);
    return NextResponse.json(
      { success: false, data: null, error: "Could not place order. Please try again." },
      { status: 500 }
    );
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ success: false, data: null, error: "Not authenticated" }, { status: 401 });
  }
  // Ownership is anchored to the current account's userId only — never by
  // email. A new account reusing a previously-deleted account's email gets a
  // fresh userId and therefore cannot match that account's old orders (which
  // had userId nulled at deletion time). This also blocks email-reuse leaks.
  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: true },
    orderBy: { id: "desc" },
  });
  const payload = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    staffNotes: o.staffNotes,
    createdAt: o.createdAt,
    currency: o.currency,
    ...calculateBillableTotals(
      o.items.map((i) => ({ price: i.price, quantity: i.quantity, itemStatus: i.itemStatus })),
      o.shipping
    ),
    items: o.items.map((i) => ({
      id: i.id,
      slug: i.slug,
      name: i.name,
      qty: i.quantity,
      quantity: i.quantity,
      price: Number(i.price),
      itemStatus: i.itemStatus,
    })),
  }));
  return NextResponse.json({ success: true, orders: payload, data: payload, error: null });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import {
  isAutomationEnabled,
  sendOrderMessage,
  orderIdempotencyKey,
  testRecipients,
} from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

const sendSchema = z.object({ orderId: z.number().int().positive() });

/**
 * Automated WhatsApp order notification — the Baileys counterpart of the
 * manual wa.me workflow in internal-orders2.html. Only reachable when the
 * admin toggle is ON. All policy is enforced HERE:
 *  - toggle OFF  → 403, the manual wa.me flow remains the only path;
 *  - already sent → no second message (duplicate prevention);
 *  - recipient   → ALWAYS the fixed test number, never the customer's phone;
 *  - whatsappSent is only set to true after Baileys confirms delivery.
 */
export async function POST(req: NextRequest) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, data: null, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, data: null, error: "Invalid input" }, { status: 400 });
  }
  const orderId = parsed.data.orderId;

  // Toggle OFF: never send anything automated.
  if (!(await isAutomationEnabled())) {
    return NextResponse.json({ success: false, data: null, error: "WhatsApp automation is disabled" }, { status: 403 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, customerName: true, customerPhone: true, whatsappSent: true },
  });
  if (!order) return NextResponse.json({ success: false, data: null, error: "Order not found" }, { status: 404 });


  // Duplicate prevention: the order was already sent successfully (flag is
  // only set after a confirmed Baileys delivery). Refuse without sending.
  if (order.whatsappSent) {
    return NextResponse.json({
      success: false,
      data: null,
      error: "This order's WhatsApp notification was already sent successfully.",
      code: "ALREADY_SENT",
    }, { status: 409 });
  }

  const result = await sendOrderMessage(
    orderId,
    { customerName: order.customerName, customerPhone: order.customerPhone },
    orderIdempotencyKey(orderId),
    // Same customer link as the manual wa.me flow; the request's own origin
    // mirrors the manual flow's window.location.origin fallback when
    // APP_BASE_URL is unset.
    req.nextUrl.origin
  );

  const stamp = new Date().toISOString();

  if (!result.ok) {
    // Failure / unknown: whatsappSent stays false, so staff can retry cleanly.
    const status = result.customerPhone || order.customerPhone;
    await prisma.auditLog.create({
      data: {
        actorId: staff.id,
        action: "WHATSAPP_AUTO_SEND_FAILED",
        entity: "Order",
        entityId: String(order.id),
        detail: `${order.orderNumber} | customer=${status || "invalid"} | recipient=${result.recipient || "-"} | status=FAILED | at=${stamp} | ${result.error}`,
      },
    }).catch(() => {});
    return NextResponse.json({ success: false, data: null, error: result.error }, { status: result.status });
  }

  // Baileys confirmed the send — only NOW is the order marked as sent.
  await prisma.order.update({ where: { id: order.id }, data: { whatsappSent: true } });
  await prisma.auditLog.create({
    data: {
      actorId: staff.id,
      action: "WHATSAPP_AUTO_SENT",
      entity: "Order",
      entityId: String(order.id),
      detail: `${order.orderNumber} | customer=+${result.customerPhone} | recipient=+${result.recipient}${result.redirected ? " (REDIRECTED, TEST MODE)" : ""} | status=SENT | messageId=${result.messageId || "-"} | at=${stamp}`,
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    data: {
      delivered: true,
      deliveryStatus: "SENT",
      messageId: result.messageId ?? null,
      testMode: result.testMode,
      /** The customer's own normalized number. */
      customerPhone: "+" + result.customerPhone,
      /** The number the message actually went to. */
      recipient: "+" + result.recipient,
      /** true = the customer's number was replaced by a testing number. */
      redirected: result.redirected,
      allowedRecipients: result.testMode ? testRecipients().map((r) => "+" + r) : null,
      sentAt: stamp,
    },
    error: null,
  });
}

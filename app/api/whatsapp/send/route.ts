import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { notifyOrder, isAutomationEnabled, testRecipients } from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

const sendSchema = z.object({ orderId: z.number().int().positive() });

/**
 * Staff MANUAL WhatsApp send / retry — the backup path for notifications
 * that failed automatically, plus the only path when staff choose to send
 * themselves. It uses the SAME notifyOrder() lifecycle as the automatic
 * post-checkout trigger, so:
 *   - SENT orders can never be re-sent (409 duplicate);
 *   - an in-flight automatic attempt returns 409 busy (no duplicates);
 *   - FAILED/PENDING orders can be retried freely;
 *   - TEST MODE + recipient allowlist + automation toggle are enforced
 *     exactly as for automatic sends.
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

  // Toggle OFF: never send anything automated or manual (existing behaviour).
  if (!(await isAutomationEnabled())) {
    return NextResponse.json({ success: false, data: null, error: "WhatsApp automation is disabled" }, { status: 403 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, whatsappSent: true, whatsappStatus: true },
  });
  if (!order) return NextResponse.json({ success: false, data: null, error: "Order not found" }, { status: 404 });

  const outcome = await notifyOrder(orderId, { actorId: staff.id, source: "manual" });

  if (outcome.result === "duplicate") {
    return NextResponse.json({
      success: false,
      data: null,
      error: "This order's WhatsApp notification was already sent successfully.",
      code: "ALREADY_SENT",
    }, { status: 409 });
  }
  if (outcome.result === "busy") {
    return NextResponse.json({
      success: false,
      data: null,
      error: outcome.error || "Another notification attempt is in progress. Try again in a moment.",
      code: "IN_PROGRESS",
    }, { status: 409 });
  }
  if (outcome.result === "skipped") {
    return NextResponse.json({ success: false, data: null, error: outcome.error }, { status: 403 });
  }
  if (outcome.result === "failed") {
    return NextResponse.json({ success: false, data: null, error: outcome.error || "Send failed" }, { status: 502 });
  }

  // SENT (manual)
  return NextResponse.json({
    success: true,
    data: {
      delivered: true,
      deliveryStatus: "SENT",
      sentBy: "manual",
      messageId: outcome.messageId ?? null,
      testMode: outcome.testMode ?? false,
      customerPhone: outcome.customerPhone ?? null,
      recipient: outcome.recipient ?? null,
      redirected: outcome.redirected ?? false,
      allowedRecipients: outcome.testMode ? testRecipients().map((r) => "+" + r) : null,
    },
    error: null,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { isAutomationEnabled, serviceLogout } from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

/**
 * Disconnect (unlink) the currently linked WhatsApp account. Staff-gated and
 * automation-toggle-gated: the company WhatsApp account can never be
 * disconnected by an unauthenticated or unauthorised caller, and the API key
 * for the Baileys service stays server-side. The Baileys service performs a
 * real logout, wipes its stored credentials and immediately emits a fresh QR
 * for the next account.
 */
export async function POST() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
  if (!(await isAutomationEnabled())) {
    return NextResponse.json({ success: false, data: null, error: "WhatsApp automation is disabled" }, { status: 403 });
  }
  const result = await serviceLogout();
  if (!result.ok) {
    return NextResponse.json({ success: false, data: null, error: result.error || "Disconnect failed" }, { status: 503 });
  }
  await prisma.auditLog.create({
    data: {
      actorId: staff.id,
      action: "WHATSAPP_DISCONNECTED",
      entity: "Setting",
      entityId: "whatsapp_service",
      detail: `Store WhatsApp account unlinked by ${staff.name}`,
    },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { disconnected: true }, error: null });
}

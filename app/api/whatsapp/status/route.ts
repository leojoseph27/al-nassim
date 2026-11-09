import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isAutomationEnabled, serviceStatus } from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

/** Live WhatsApp connection status, proxied server-side so the Baileys
 *  service never needs to be reachable from staff browsers. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
  const enabled = await isAutomationEnabled();
  if (!enabled) {
    return NextResponse.json({ success: false, data: null, error: "WhatsApp automation is disabled" }, { status: 403 });
  }
  const status = await serviceStatus();
  return NextResponse.json({ success: true, data: status, error: null });
}

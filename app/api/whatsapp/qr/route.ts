import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isAutomationEnabled, serviceQr, serviceStatus } from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

/** QR code for linking the store WhatsApp account. The QR always comes from
 *  the existing Baileys service — this route only proxies it (with the API
 *  key applied server-side) so staff devices on the LAN never talk to the
 *  WhatsApp service directly. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
  if (!(await isAutomationEnabled())) {
    return NextResponse.json({ success: false, data: null, error: "WhatsApp automation is disabled" }, { status: 403 });
  }
  const status = await serviceStatus();
  if (!status.serviceUp) {
    return NextResponse.json({ success: false, data: null, error: "WhatsApp service is not running. Ask the administrator to start it." }, { status: 503 });
  }
  if (status.connected) {
    return NextResponse.json({ success: true, data: { connected: true, phone: status.phone }, error: null });
  }
  const qr = await serviceQr();
  if (!qr.ok) {
    return NextResponse.json({ success: false, data: null, error: qr.error || "QR not available yet" }, { status: qr.status });
  }
  return NextResponse.json({ success: true, data: { connected: false, phone: status.phone, qrDataUrl: qr.qrDataUrl }, error: null });
}

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isAutomationEnabled, isTestModeEnabled, testRecipients } from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

function maskRecipient(r: string): string {
  // "+965 6623 5398"-style grouping for readability.
  return "+" + (r.length > 8 ? r.slice(0, 3) + " " + r.slice(3, 7) + " " + r.slice(7) : r);
}

/** Staff-readable WhatsApp automation configuration. Staff learn the admin
 *  toggle and TEST MODE state through this endpoint; both can only be
 *  changed via the admin-only route. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
  const [enabled, testMode] = await Promise.all([isAutomationEnabled(), isTestModeEnabled()]);
  return NextResponse.json({
    success: true,
    data: {
      enabled,
      testMode,
      testRecipients: testRecipients().map(maskRecipient),
    },
    error: null,
  });
}

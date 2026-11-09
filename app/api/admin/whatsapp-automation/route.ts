import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import {
  isAutomationEnabled,
  setAutomationEnabled,
  isTestModeEnabled,
  setTestModeEnabled,
} from "@/lib/whatsapp-automation";

export const dynamic = "force-dynamic";

/** Admin-only WhatsApp automation controls.
 *  GET  → { enabled, testMode }
 *  POST → set either. testMode=false switches to REAL CUSTOMER DELIVERY and
 *         must be toggled deliberately by an admin (default is ON). */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
  const [enabled, testMode] = await Promise.all([isAutomationEnabled(), isTestModeEnabled()]);
  return NextResponse.json({ success: true, data: { enabled, testMode }, error: null });
}

const postSchema = z.object({
  enabled: z.boolean().optional(),
  testMode: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ success: false, data: null, error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, data: null, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, data: null, error: "Invalid input" }, { status: 400 });
  }
  if (parsed.data.enabled !== undefined) {
    await setAutomationEnabled(parsed.data.enabled, admin.id);
  }
  if (parsed.data.testMode !== undefined) {
    await setTestModeEnabled(parsed.data.testMode, admin.id);
  }
  const [enabled, testMode] = await Promise.all([isAutomationEnabled(), isTestModeEnabled()]);
  return NextResponse.json({ success: true, data: { enabled, testMode }, error: null });
}

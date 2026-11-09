"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/app/admin/_components/ConfirmDialog";

/**
 * Admin settings — WhatsApp Message Automation.
 *
 * When ON, the Store Staff page (internal-orders2.html) gains the LINK
 * WHATSAPP connection option and sends order notifications automatically
 * through the local Baileys WhatsApp service; the manual wa.me flow is
 * suppressed. When OFF, the existing manual wa.me workflow works exactly
 * as before and nothing automated is sent. The value is persisted in the
 * Setting table server-side and enforced by the API routes — this card
 * only shapes the UI.
 */
export function SettingsTab() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [testMode, setTestMode] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<"" | "enabled" | "testMode">("");
  const [confirmReal, setConfirmReal] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    fetch("/api/admin/whatsapp-automation", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setEnabled(d.data.enabled);
          setTestMode(d.data.testMode);
        } else setError(d.error || "Failed to load setting");
      })
      .catch(() => setError("Network error"));
  }, []);

  useEffect(load, [load]);

  function post(body: { enabled?: boolean; testMode?: boolean }, which: "enabled" | "testMode") {
    if (saving) return;
    setSaving(which);
    setMessage("");
    setError("");
    fetch("/api/admin/whatsapp-automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setEnabled(d.data.enabled);
          setTestMode(d.data.testMode);
          if (body.enabled !== undefined) {
            setMessage(body.enabled
              ? "WhatsApp automation is ON. Staff can link WhatsApp and order messages send automatically."
              : "WhatsApp automation is OFF. The manual wa.me workflow is active again.");
          }
          if (body.testMode !== undefined) {
            setMessage(body.testMode
              ? "TEST MODE ON — automated messages are restricted to the testing numbers."
              : "TEST MODE OFF — automated messages now go to customers' real numbers.");
          }
        } else setError(d.error || "Failed to update setting");
      })
      .catch(() => setError("Network error"))
      .finally(() => setSaving(""));
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-[#25d366]/15" aria-hidden>
              {/* WhatsApp glyph */}
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#25d366]">
                <path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.38A9.9 9.9 0 1 0 12.04 2Zm5.8 14.06c-.25.7-1.45 1.34-2 1.38-.5.05-1.13.24-3.8-.79-3.22-1.27-5.26-4.55-5.42-4.76-.16-.21-1.3-1.72-1.3-3.28 0-1.56.82-2.32 1.11-2.64.29-.32.63-.4.84-.4h.6c.19 0 .45-.07.7.54.26.62.88 2.15.95 2.3.08.16.13.35.02.56-.1.21-.16.34-.31.52l-.47.55c-.16.16-.32.33-.14.65.19.32.82 1.35 1.76 2.19 1.21 1.08 2.23 1.41 2.55 1.57.32.16.5.13.69-.08.18-.21.79-.92 1-1.24.21-.32.42-.26.71-.16.29.11 1.82.86 2.13 1.02.32.16.53.24.61.37.08.14.08.79-.17 1.49Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">WhatsApp Message Automation</h2>
              <p className="text-sm text-gray-500 mt-1">
                Sends customer order notifications automatically through the store&apos;s linked WhatsApp
                account (local Baileys service) when staff trigger the WhatsApp action on the
                Store Staff page.
              </p>
            </div>
          </div>
          {/* Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled === true}
            disabled={saving !== "" || enabled === null}
            onClick={() => post({ enabled: !enabled }, "enabled")}
            className={`relative inline-flex flex-none h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              enabled ? "bg-green-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* TEST MODE switch — deliberately separate and default ON */}
        <div className="mt-4 flex items-start justify-between gap-4 border-t border-gray-100 pt-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">TEST MODE</h3>
            <p className="text-sm text-gray-500 mt-1">
              {testMode
                ? "ON — automated messages are restricted to the configured testing numbers; any other number is redirected to the primary testing number."
                : "OFF — REAL CUSTOMER DELIVERY: automated messages go to each customer's actual WhatsApp number."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={testMode === true}
            disabled={saving !== "" || testMode === null}
            onClick={() => (testMode ? post({ testMode: false }, "testMode") : post({ testMode: true }, "testMode"))}
            className={`relative inline-flex flex-none h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              testMode === false ? "bg-red-600" : "bg-green-600"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                testMode === false ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {testMode === false && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Real customer delivery is ACTIVE. Every automated message goes to the customer&apos;s actual number.
            <button onClick={() => setConfirmReal(true)} className="ml-2 underline font-semibold">Turn TEST MODE back on</button>
          </div>
        )}
        <ConfirmDialog
          open={confirmReal}
          title="Re-enable TEST MODE?"
          body="Automated messages will again be restricted to the configured testing numbers. Real customer delivery stops immediately."
          confirmLabel="Enable TEST MODE"
          onConfirm={() => { setConfirmReal(false); post({ testMode: true }, "testMode"); }}
          onCancel={() => setConfirmReal(false)}
        />

        <div className="mt-4 border-t border-gray-100 pt-3 text-sm text-gray-600 space-y-1">
          <p>
            <span className="font-semibold text-gray-800">ON:</span> staff see “LINK WHATSAPP” in the staff page
            navigation, scan the QR to link the store account, and order WhatsApp messages are sent
            automatically — the manual wa.me link is disabled.
          </p>
          <p>
            <span className="font-semibold text-gray-800">OFF:</span> the existing manual wa.me workflow works
            exactly as before; nothing is sent automatically and staff do not need to connect WhatsApp.
          </p>
          <p className="text-xs text-gray-400">
            While TEST MODE is ON, automated messages are restricted to the testing numbers configured on the
            server (WHATSAPP_TEST_RECIPIENT) — any other number is redirected to the primary testing number.
            Turning TEST MODE OFF is a deliberate admin action that enables real customer delivery; it is never
            enabled automatically.
          </p>
        </div>

        {saving && <p className="mt-3 text-sm text-gray-500">Saving…</p>}
        {message && <p className="mt-3 text-sm text-green-600">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {enabled !== null && (
          <p className="mt-3 text-xs text-gray-400">
            Current state: {enabled ? "ON" : "OFF"} (persisted in the application database — survives restarts).
            <button onClick={load} className="ml-2 underline hover:text-gray-600">Reload</button>
          </p>
        )}
      </div>
    </div>
  );
}

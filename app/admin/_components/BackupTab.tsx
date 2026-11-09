"use client";

import { useRef, useState } from "react";

/* Backup & Restore (ADMIN only tab).
   Four independent actions: download the products ZIP, download the orders
   ZIP, and validate-then-restore either archive. Restores are two-step:
   the file is first validated with ?dryRun=1 (no data changes), the report
   is shown, and the restore button only activates after the operator ticks
   the explicit confirmation checkbox. Restores never delete or overwrite
   existing records — conflicts are skipped and reported. */

interface RestoreReport {
  productsInArchive?: number;
  ordersInArchive?: number;
  imagesInArchive?: number;
  restorable?: number;
  conflicts: { id?: number; slug?: string; orderNumber?: string; reason: string }[];
  invalid: { index: number; reason: string }[];
  missingCategories?: { slug?: string; categoryId: number }[];
  missingImages?: { product: string; file: string }[];
  itemsWithUnknownProducts?: { orderNumber?: string; productId: number }[];
  securityRestorable?: number;
  created?: number;
  imagesWritten?: number;
  imagesKept?: number;
  relatedCreated?: number;
  itemsCreated?: number;
  historyCreated?: number;
  securityCreated?: number;
  skippedDetails?: string[];
}

type Kind = "products" | "orders";

export function BackupTab() {
  const [busy, setBusy] = useState<"" | `backup-${Kind}` | `restore-${Kind}` | `validate-${Kind}`>("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reports, setReports] = useState<Record<Kind, RestoreReport | null>>({ products: null, orders: null });
  const [files, setFiles] = useState<Record<Kind, File | null>>({ products: null, orders: null });
  const [confirmed, setConfirmed] = useState<Record<Kind, boolean>>({ products: false, orders: false });
  const [counts, setCounts] = useState<{ products?: string; images?: string; missing?: string; orders?: string }>({});
  const inputs = useRef<Record<Kind, HTMLInputElement | null>>({ products: null, orders: null });

  async function downloadBackup(kind: Kind) {
    setBusy(`backup-${kind}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/backup/${kind}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `nassim-${kind}-backup.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (kind === "products") {
        setCounts((c) => ({
          ...c,
          products: res.headers.get("X-Product-Count") ?? "?",
          images: res.headers.get("X-Image-Count") ?? "?",
          missing: res.headers.get("X-Missing-Image-Count") ?? "?",
        }));
        setMessage({ kind: "ok", text: `Products backup downloaded (${(blob.size / 1024).toFixed(0)} KB).` });
      } else {
        setCounts((c) => ({ ...c, orders: res.headers.get("X-Order-Count") ?? "?" }));
        setMessage({ kind: "ok", text: `Orders backup downloaded (${(blob.size / 1024).toFixed(0)} KB).` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: `Backup failed: ${(err as Error).message}` });
    } finally {
      setBusy("");
    }
  }

  function readReport(res: Response): Promise<RestoreReport> {
    return res.json().then((body) => {
      if (body.error) throw new Error(body.error);
      return (body.report ?? body.result) as RestoreReport;
    });
  }

  /* Uploads the archive in 4MB raw slices (the dev server caps single
     request bodies at ~10MB), then the final slice triggers validation or
     the actual restore. Upload progress shows through setMessage. */
  async function runRestoreStep(kind: Kind, dryRun: boolean) {
    const CHUNK = 4 * 1024 * 1024;
    const file = files[kind];
    if (!file) {
      setMessage({ kind: "error", text: "Choose a backup ZIP file first." });
      return;
    }
    setBusy(dryRun ? `validate-${kind}` : `restore-${kind}`);
    setMessage(null);
    try {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK));
      let lastBody: Response | null = null;
      for (let i = 0; i < totalChunks; i++) {
        const isLast = i === totalChunks - 1;
        const qs = `?uploadId=${uploadId}&chunk=${i}${isLast ? "&last=1" : ""}${isLast && dryRun ? "&dryRun=1" : ""}`;
        const res = await fetch(`/api/admin/restore/${kind}${qs}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status} on chunk ${i + 1}/${totalChunks}`);
        }
        setMessage({ kind: "ok", text: `Uploading… chunk ${i + 1}/${totalChunks}` });
        if (isLast) lastBody = res;
      }
      const report = await readReport(lastBody as Response);
      setReports((r) => ({ ...r, [kind]: report }));
      if (!dryRun) {
        setConfirmed((c) => ({ ...c, [kind]: false }));
        if (inputs.current[kind]) inputs.current[kind].value = "";
        setFiles((f) => ({ ...f, [kind]: null }));
        const done =
          kind === "products"
            ? `Restored ${report.created ?? 0} products, ${report.imagesWritten ?? 0} image files written, ${report.imagesKept ?? 0} existing images kept. ${report.conflicts?.length ?? 0} conflicts skipped.`
            : `Restored ${report.created ?? 0} orders, ${report.itemsCreated ?? 0} items, ${report.historyCreated ?? 0} history rows, ${report.securityCreated ?? 0} security rows. ${report.conflicts?.length ?? 0} conflicts skipped.`;
        setMessage({ kind: "ok", text: done });
      }
    } catch (err) {
      setMessage({ kind: "error", text: `${dryRun ? "Validation" : "Restore"} failed: ${(err as Error).message}` });
    } finally {
      setBusy("");
    }
  }

  function reportSummary(kind: Kind, report: RestoreReport): string[] {
    if (kind === "products") {
      return [
        `Products in archive: ${report.productsInArchive ?? 0}`,
        `Images in archive: ${report.imagesInArchive ?? 0}`,
        `New products to create: ${report.restorable ?? 0}`,
        `Conflicts (already exist — will be preserved and skipped): ${report.conflicts?.length ?? 0}`,
        `Missing category references: ${report.missingCategories?.length ?? 0}`,
        `Missing image files: ${report.missingImages?.length ?? 0}`,
      ];
    }
    return [
      `Orders in archive: ${report.ordersInArchive ?? 0}`,
      `New orders to create: ${report.restorable ?? 0}`,
      `Conflicts (already exist — will be preserved and skipped): ${report.conflicts?.length ?? 0}`,
      `Items referencing products that no longer exist: ${report.itemsWithUnknownProducts?.length ?? 0}`,
      `Invalid rows: ${report.invalid?.length ?? 0}`,
      `Security rows restorable: ${report.securityRestorable ?? 0}`,
    ];
  }

  const conflictList = (kind: Kind) => {
    const report = reports[kind];
    if (!report?.conflicts?.length) return null;
    const items = report.conflicts.slice(0, 8).map((c) => c.slug ?? c.orderNumber ?? `#${c.id}`);
    return <li className="text-xs text-gray-500">e.g. {items.join(", ")}{report.conflicts.length > 8 ? "…" : ""}</li>;
  };

  const panel = (kind: Kind, title: string, backupHint: string) => (
    <section className="border border-gray-200 rounded-lg p-4 bg-white">
      <h3 className="font-semibold text-gray-900">{title}</h3>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => downloadBackup(kind)}
          disabled={busy !== ""}
          className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy === `backup-${kind}` ? "Preparing…" : `Backup All ${kind === "products" ? "Products" : "Orders"} (ZIP)`}
        </button>
        {kind === "products" && counts.products !== undefined && (
          <span className="text-xs text-gray-600">
            Exported {counts.products} products, {counts.images} images{counts.missing !== "0" ? `, ${counts.missing} MISSING` : ""}.
          </span>
        )}
        {kind === "orders" && counts.orders !== undefined && (
          <span className="text-xs text-gray-600">Exported {counts.orders} orders.</span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">{backupHint}</p>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <input
          ref={(el) => { inputs.current[kind] = el; }}
          type="file"
          accept=".zip"
          onChange={(e) => {
            setFiles((f) => ({ ...f, [kind]: e.target.files?.[0] ?? null }));
            setReports((r) => ({ ...r, [kind]: null }));
            setConfirmed((c) => ({ ...c, [kind]: false }));
          }}
          className="text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => runRestoreStep(kind, true)}
            disabled={busy !== "" || !files[kind]}
            className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-50"
          >
            {busy === `validate-${kind}` ? "Validating…" : "Validate archive"}
          </button>
          <button
            onClick={() => runRestoreStep(kind, false)}
            disabled={busy !== "" || !files[kind] || !reports[kind] || !confirmed[kind]}
            className="px-3 py-1.5 rounded-md bg-blue-700 text-white text-sm font-medium disabled:opacity-40"
          >
            {busy === `restore-${kind}` ? "Restoring…" : `Restore ${kind === "products" ? "Products" : "Orders"}`}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Restore is non-destructive: existing records are preserved; conflicting records are skipped and reported.
        </p>

        {reports[kind] && (
          <div className="mt-2 text-sm bg-gray-50 border border-gray-200 rounded p-3">
            <ul className="list-disc ml-5 space-y-0.5">
              {reportSummary(kind, reports[kind] as RestoreReport).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {conflictList(kind)}
            </ul>
            {(reports[kind]?.missingImages?.length ?? 0) > 0 && (
              <p className="mt-1 text-xs text-red-700">
                Missing image files: {reports[kind]!.missingImages!.map((m) => m.file).slice(0, 5).join(", ")}
                {reports[kind]!.missingImages!.length > 5 ? "…" : ""}
              </p>
            )}
            {(reports[kind]?.invalid?.length ?? 0) > 0 && (
              <p className="mt-1 text-xs text-red-700">Invalid rows: {reports[kind]!.invalid!.length}</p>
            )}
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed[kind]}
                onChange={(e) => setConfirmed((c) => ({ ...c, [kind]: e.target.checked }))}
              />
              I confirm I want to import the new records listed above.
            </label>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Backup &amp; Restore</h2>
        <p className="text-sm text-gray-600 mt-1">
          Full catalogue and order backups, including the actual image files. Restores are validated first and never
          delete or overwrite existing records.
        </p>
      </div>

      {message && (
        <div className={`text-sm rounded-md p-3 ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </div>
      )}

      {panel("products", "Product backups", "Archive: products.json (every stored field + colour/size/gallery/custom-value/related/stock relations), manifest.json and the images/ directory with the real image files.")}
      {panel("orders", "Order backups", "Archive: orders.json (every stored field, historical item price snapshots, status history, token-hash security rows) and manifest.json.")}
    </div>
  );
}

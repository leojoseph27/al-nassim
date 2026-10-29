"use client";

import { useCallback, useEffect, useState } from "react";
import { MasterDataTab } from "@/app/admin/_components/MasterDataTab";
import { ProductsTab } from "@/app/admin/_components/ProductsTab";
import { CustomersTab } from "@/app/admin/_components/CustomersTab";
import StaffTab from "@/app/admin/_components/StaffTab";
import { ConfirmDialog } from "@/app/admin/_components/ConfirmDialog";

type Tab = "dashboard" | "products" | "orders" | "master-data" | "customers" | "staff" | "audit-log";

const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  products: "Products",
  orders: "Orders",
  "master-data": "Master Data",
  customers: "Customers",
  staff: "Staff",
  "audit-log": "Audit Log",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface StatsData {
  totals: { orders: number; products: number; customers: number };
  operational: {
    pendingReview: number;
    waitingConfirmation: number;
    readyForPacking: number;
    currentlyPacking: number;
    readyForDelivery: number;
    deliveredToday: number;
    completedToday: number;
    cancelledToday: number;
    unreadNotifications: number;
  };
  ordersByStatus: { status: string; count: number }[];
  recentOrders: { id: number; orderNumber: string; customerName: string; status: string; total: number; currency: string; createdAt: string }[];
  topProducts: { slug: string; name: string; sold: number }[];
}

interface LowStockData {
  items: {
    id: number;
    slug: string;
    name: string;
    sku: string;
    stock: number;
    threshold: number;
    category: string;
    status: "OUT_OF_STOCK" | "LOW_STOCK";
  }[];
  counts: { total: number; outOfStock: number; lowStock: number };
}

interface AdminOrder {
  id: number;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  city: string;
  notes: string;
  staffNotes: string;
  posStatus: string;
  status: string;
  statusLabel: string;
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: {
    id: number;
    slug: string;
    name: string;
    image: string;
    price: number;
    quantity: number;
    itemStatus: string;
  }[];
}

/* Display-only formatting for a stored E.164 customerPhone: one space after
   the country calling code ("+96555123456" -> "+965 55123456") so staff can
   read the code and the number apart. The boundary follows the real calling
   code lengths (1-digit: 1, 7; the 2-digit set below; anything else 3-digit),
   never a fixed digit count. Non-E.164 / legacy values come back untouched;
   the stored data and payloads are unchanged. */
const DIAL2 = new Set(
  "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(" ")
);
function formatPhoneDisplay(phone: string): string {
  const m = /^\+(\d{6,15})$/.exec(String(phone ?? "").replace(/[\s()-]/g, ""));
  if (!m) return String(phone ?? "");
  const d = m[1];
  const dialLen = d[0] === "1" || d[0] === "7" ? 1 : DIAL2.has(d.slice(0, 2)) ? 2 : 3;
  return "+" + d.slice(0, dialLen) + " " + d.slice(dialLen);
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const ORDER_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "READY_FOR_CONFIRMATION",
  "CONFIRMED",
  "PACKING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_STAFF",
] as const;

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  UNDER_REVIEW: "bg-blue-100 text-blue-800",
  READY_FOR_CONFIRMATION: "bg-indigo-100 text-indigo-800",
  CONFIRMED: "bg-green-100 text-green-800",
  PACKING: "bg-purple-100 text-purple-800",
  READY_FOR_DELIVERY: "bg-cyan-100 text-cyan-800",
  OUT_FOR_DELIVERY: "bg-orange-100 text-orange-800",
  DELIVERED: "bg-teal-100 text-teal-800",
  COMPLETED: "bg-gray-200 text-gray-800",
  CANCELLED_BY_CUSTOMER: "bg-red-100 text-red-800",
  CANCELLED_BY_STAFF: "bg-red-100 text-red-800",
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  AVAILABLE: "bg-green-100 text-green-800",
  UNAVAILABLE: "bg-red-100 text-red-800",
  REMOVED_AFTER_CONFIRMATION: "bg-gray-200 text-gray-500 line-through",
  DELIVERED: "bg-teal-100 text-teal-800",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  return n.toFixed(3);
}

function statusLabel(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {statusLabel(status)}
    </span>
  );
}

function ItemStatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ITEM_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {statusLabel(status)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function AdminApp({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [authState, setAuthState] = useState<"loading" | "ok" | "denied">("loading");
  const [userName, setUserName] = useState("");
  // Role from the verified session ("ADMIN" | "STAFF"). ADMIN sees the full
  // panel; STAFF gets the order-focused interface. The APIs enforce the same
  // split server-side — this only shapes the UI.
  const [role, setRole] = useState<"ADMIN" | "STAFF" | "">("");
  const [loggingOut, setLoggingOut] = useState(false);
  // Leaving Products with an unsaved form asks first — the ProductsTab
  // reports its dirty state up through this callback.
  const [productsDirty, setProductsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const handleProductsDirty = useCallback((dirty: boolean) => setProductsDirty(dirty), []);

  function switchTab(next: Tab) {
    if (tab === "products" && next !== "products" && productsDirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  }

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        const me = data?.data?.user;
        if (me && (me.role === "ADMIN" || me.role === "STAFF")) {
          setUserName(me.name);
          setRole(me.role);
          setAuthState("ok");
        } else {
          setAuthState("denied");
        }
      })
      .catch(() => setAuthState("denied"));
  }, []);

  // The logout route is POST-only (a plain <a href> would 405). The session
  // row is deleted server-side; the cookie is cleared in the same response.
  function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
      .catch(() => {})
      .finally(() => {
        window.location.href = "/admin/login?redirect=%2Fadmin.html";
      });
  }

  if (authState === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading admin panel…</div>;
  }
  if (authState === "denied") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50">
        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center">
          <span className="text-2xl">🔒</span>
        </div>
        <p className="text-gray-700 font-semibold text-lg">Staff access required</p>
        <p className="text-gray-500 text-sm">You need an admin or staff account to access this panel.</p>
        <a href="/admin/login" className="mt-2 px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
          Go to Admin Login
        </a>
        <a href="/home.html" className="text-gray-400 text-xs hover:text-gray-600 mt-2">← Back to Storefront</a>
      </div>
    );
  }

  // Staff may only open the order-facing tabs; a deep link to an admin-only
  // tab (e.g. /admin/products) falls back to the staff home ("orders").
  // Server APIs enforce the real permission split regardless of the tab.
  const allowedTabs: Tab[] =
    role === "ADMIN"
      ? ["dashboard", "products", "orders", "master-data", "customers", "staff", "audit-log"]
      : ["dashboard", "orders", "customers"];
  const activeTab: Tab = allowedTabs.includes(tab) ? tab : "orders";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gray-900 text-white">
        {/* Wraps on narrow screens: the six tab pills, brand and user area
            stack instead of overflowing the viewport. */}
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-2">
              <img src="/LOGO.png" alt="AL-NASSIM" className="h-8 w-auto" />
              <span className="font-bold text-lg tracking-wide">Admin</span>
            </span>
            <nav className="flex flex-wrap gap-1">
              {(allowedTabs).map((t) => (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  className={`px-3 py-1.5 rounded-md text-sm capitalize ${activeTab === t ? "bg-white text-gray-900 font-semibold" : "text-gray-300 hover:text-white"}`}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-300">{userName}</span>
            <a href="/home.html" className="text-gray-300 hover:text-white">
              Storefront
            </a>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-gray-300 hover:text-red-300 disabled:opacity-50"
            >
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === "dashboard" && <DashboardTab />}
        {activeTab === "products" && <ProductsTab onDirtyChange={handleProductsDirty} />}
        {activeTab === "orders" && <OrdersTab />}
        {activeTab === "master-data" && <MasterDataTab />}
        {activeTab === "customers" && <CustomersTab readOnly={role !== "ADMIN"} />}
        {activeTab === "staff" && <StaffTab />}
        {activeTab === "audit-log" && <AuditLogTab />}
      </main>
      {/* Leaving Products with unsaved form changes asks first. */}
      <ConfirmDialog
        open={pendingTab !== null}
        title="Leave with unsaved changes?"
        body="The product form has unsaved changes. Leaving now will lose them."
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        danger
        onConfirm={() => {
          const next = pendingTab;
          setPendingTab(null);
          setProductsDirty(false);
          if (next) setTab(next);
        }}
        onCancel={() => setPendingTab(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard Tab — operational metrics                                 */
/* ------------------------------------------------------------------ */

function DashboardTab() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState("");
  // Low-stock alerts: active products whose online stock is at or below their
  // per-product "Minimum Stock" threshold (see /api/admin/low-stock).
  const [lowStock, setLowStock] = useState<LowStockData | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setStats(data.data);
        else setError(data.error || "Failed to load stats");
      })
      .catch(() => setError("Failed to load stats"));
    fetch("/api/admin/low-stock", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setLowStock(data.data);
      })
      .catch(() => {/* low-stock panel simply stays empty on failure */});
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!stats) return <p className="text-gray-500">Loading…</p>;

  const op = stats.operational;
  const operationalCards = [
    { label: "Awaiting Review", value: op.pendingReview, color: "text-yellow-600" },
    { label: "Waiting Confirmation", value: op.waitingConfirmation, color: "text-indigo-600" },
    { label: "Ready to Pack (Confirmed)", value: op.readyForPacking, color: "text-green-600" },
    { label: "Currently Packing", value: op.currentlyPacking, color: "text-orange-600" },
    { label: "Ready for Delivery", value: op.readyForDelivery, color: "text-cyan-600" },
    { label: "Delivered Today", value: op.deliveredToday, color: "text-teal-600" },
    { label: "Completed Today", value: op.completedToday, color: "text-gray-700" },
    { label: "Cancelled Today", value: op.cancelledToday, color: "text-red-600" },
    { label: "Unread Notifications", value: op.unreadNotifications, color: "text-blue-600" },
    {
      label: "Low Stock Alerts",
      value: lowStock ? lowStock.counts.total : "…",
      color: lowStock && lowStock.counts.total > 0 ? "text-amber-600" : "text-gray-700",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {operationalCards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {/* min-w-0 lets every section shrink inside the mobile grid track;
             without it the widest non-shrinkable row (a long product name)
             forces the whole track past the viewport. */}
        <section className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 min-w-0">
          <h2 className="font-semibold text-gray-900 mb-3">Orders by Status</h2>
          <ul className="space-y-2">
            {stats.ordersByStatus.map((s) => (
              <li key={s.status} className="flex justify-between items-center text-sm gap-2 min-w-0">
                <StatusBadge status={s.status} />
                <span className="font-semibold">{s.count}</span>
              </li>
            ))}
            {stats.ordersByStatus.length === 0 && <li className="text-sm text-gray-500">No orders yet</li>}
          </ul>
        </section>
        <section className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 min-w-0">
          <h2 className="font-semibold text-gray-900 mb-1">Most Ordered Products</h2>
          <ul className="space-y-2">
            {stats.topProducts.map((p) => (
              <li key={p.slug} className="flex justify-between text-sm gap-2 min-w-0">
                <span className="truncate mr-3 flex-1 min-w-0">{p.name}</span>
                <span className="font-semibold whitespace-nowrap">{p.sold} ordered</span>
              </li>
            ))}
            {stats.topProducts.length === 0 && <li className="text-sm text-gray-500">No orders yet</li>}
          </ul>
        </section>
        {/* Low-stock replenishment list — active products at or below their
            per-product Minimum Stock threshold, worst first. */}
        <section className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 md:col-span-2 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="font-semibold text-gray-900">Low Stock — Replenishment Needed</h2>
            {lowStock && (
              <span className="text-xs text-gray-500">
                {lowStock.counts.total} product{lowStock.counts.total === 1 ? "" : "s"} at or below minimum stock
                {lowStock.counts.outOfStock > 0 && ` (${lowStock.counts.outOfStock} out of stock)`}
              </span>
            )}
          </div>
          {lowStock === null ? (
            <p className="text-sm text-gray-500">Loading low-stock data…</p>
          ) : lowStock.items.length === 0 ? (
            <p className="text-sm text-gray-500">No low-stock products — every active product is above its minimum stock level.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase tracking-wide">
                    <th className="py-1 pr-4">Product</th>
                    <th className="py-1 pr-4">SKU</th>
                    <th className="py-1 pr-4">Stock</th>
                    <th className="py-1 pr-4">Threshold</th>
                    <th className="py-1 pr-4">Category</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.items.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4">
                        <span className="font-medium text-gray-900">{p.name}</span>
                        <span className="block text-xs text-gray-400 font-mono">{p.slug}</span>
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{p.sku}</td>
                      <td className={`py-1.5 pr-4 font-semibold ${p.status === "OUT_OF_STOCK" ? "text-red-600" : "text-amber-600"}`}>{p.stock}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{p.threshold}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{p.category}</td>
                      <td className="py-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${p.status === "OUT_OF_STOCK" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                          {p.status === "OUT_OF_STOCK" ? "Out of Stock" : "Low Stock"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">
            Threshold is each product&apos;s &quot;Minimum Stock&quot; field (product form). Only active products are listed.
          </p>
        </section>
        <section className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 md:col-span-2 min-w-0">
          <h2 className="font-semibold text-gray-900 mb-3">Recent Orders</h2>
          <ul className="space-y-2">
            {stats.recentOrders.map((o) => (
              <li key={o.orderNumber} className="flex flex-wrap justify-between items-center text-sm gap-x-2 gap-y-1 min-w-0">
                <span className="font-mono text-xs">{o.orderNumber}</span>
                <span className="text-gray-600 truncate flex-1 min-w-0">{o.customerName}</span>
                <StatusBadge status={o.status} />
                <span className="font-semibold whitespace-nowrap">{fmt(o.total)} {o.currency}</span>
              </li>
            ))}
            {stats.recentOrders.length === 0 && <li className="text-sm text-gray-500">No orders yet</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orders Tab — verification workflow                                  */
/* ------------------------------------------------------------------ */

function OrdersTab() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  // Invoice-number search (e.g. ORD-42). Retrieves historical orders
  // even after the original customer account has been deleted.
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Server-side pagination (the API no longer returns everything at once).
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  // Id of the order whose workflow action is in flight — its action buttons
  // disable until the response lands (duplicate-click prevention).
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  // High-impact actions are confirmed in a dialog before being sent.
  const [confirming, setConfirming] = useState<{ kind: "cancel" | "complete"; order: AdminOrder } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (search) params.set("q", search);
    params.set("page", String(page));
    params.set("limit", "20");
    fetch(`/api/admin/orders?${params.toString()}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setOrders(data.data.orders);
          setTotal(data.data.pagination.total);
          setTotalPages(data.data.pagination.totalPages);
        } else setError(data.error || "Failed to load orders");
      })
      .catch(() => setError("Failed to load orders"))
      .finally(() => setLoading(false));
  }, [filter, search, page]);

  useEffect(load, [load]);

  // Changing the filter or search starts over from page 1 of the new result set.
  function changeFilter(next: string) {
    setFilter(next);
    setPage(1);
  }
  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  async function patchStatus(id: number, status: string) {
    setError("");
    setMessage("");
    setBusyOrderId(id);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (data.success) {
        setOrders((prev) => prev.map((o) => (o.id === id ? data.data.order : o)));
        setMessage(`Order moved to ${statusLabel(status)}.`);
      } else {
        setError(data.error || "Status update failed");
      }
    } catch {
      setError("Network error while updating status");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function verifyItems(orderId: number, items: { itemId: number; itemStatus: string }[], notes: string) {
    setError("");
    setMessage("");
    setBusyOrderId(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ items, staffNotes: notes }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("Item availability updated. Order is under review.");
        load();
      } else {
        setError(data.error || "Verification failed");
      }
    } catch {
      setError("Network error while verifying items");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function sendForConfirmation(id: number) {
    await patchStatus(id, "READY_FOR_CONFIRMATION");
  }

  async function packOrder(id: number, action: string, posStatus?: string) {
    setError("");
    setMessage("");
    setBusyOrderId(id);
    try {
      const res = await fetch(`/api/admin/orders/${id}/pack`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, posStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Order updated: ${data.data.statusLabel}`);
        load();
      } else {
        setError(data.error || "Action failed");
      }
    } catch {
      setError("Network error while updating order");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function cancelOrder(id: number) {
    await patchStatus(id, "CANCELLED_BY_STAFF");
  }

  async function runConfirmedAction() {
    if (!confirming) return;
    const { kind, order } = confirming;
    setConfirming(null);
    if (kind === "cancel") await cancelOrder(order.id);
    else await patchStatus(order.id, "COMPLETED");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filter}
          onChange={(e) => changeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            changeSearch(searchInput.trim());
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoice no. or customer…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72"
          />
          <button
            type="submit"
            className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm hover:bg-gray-700"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                changeSearch("");
                setSearchInput("");
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Clear
            </button>
          )}
        </form>
        <span className="text-sm text-gray-500">
          {total} order{total === 1 ? "" : "s"}
          {totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}
        </span>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {message && <p className="text-green-600 text-sm">{message}</p>}
      <div className="space-y-3">
        {orders.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            expanded={expanded === o.id}
            busy={busyOrderId === o.id}
            onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
            onVerify={verifyItems}
            onSendConfirmation={sendForConfirmation}
            onPack={packOrder}
            onRequestCancel={(order) => setConfirming({ kind: "cancel", order })}
            onRequestComplete={(order) => setConfirming({ kind: "complete", order })}
          />
        ))}
        {loading && <p className="text-gray-500 text-sm">Loading orders…</p>}
        {!loading && orders.length === 0 && <p className="text-gray-500 text-sm">No orders found.</p>}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center pt-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 disabled:opacity-50 hover:bg-gray-100"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages} ({total} orders)
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 disabled:opacity-50 hover:bg-gray-100"
          >
            Next →
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.kind === "cancel" ? "Cancel this order?" : "Complete this order?"}
        body={
          confirming?.kind === "cancel"
            ? `Order ${confirming.order.orderNumber} will be marked Cancelled By Staff.\n\nReserved stock is restored and the customer is notified. This cannot be undone.`
            : `Order ${confirming?.order.orderNumber ?? ""} will be marked Completed.\n\nThis closes the order permanently.`
        }
        confirmLabel={confirming?.kind === "cancel" ? "Cancel Order" : "Complete Order"}
        danger={confirming?.kind === "cancel"}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Order Card — expandable with verification workflow                   */
/* ------------------------------------------------------------------ */

interface OrderCardProps {
  order: AdminOrder;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onVerify: (orderId: number, items: { itemId: number; itemStatus: string }[], notes: string) => void;
  onSendConfirmation: (id: number) => void;
  onPack: (id: number, action: string, posStatus?: string) => void;
  onRequestCancel: (order: AdminOrder) => void;
  onRequestComplete: (order: AdminOrder) => void;
}

function OrderCard({ order, expanded, busy, onToggle, onVerify, onSendConfirmation, onPack, onRequestCancel, onRequestComplete }: OrderCardProps) {
  const [itemStatusOverrides, setItemStatusOverrides] = useState<Record<number, string>>({});
  const [staffNotes, setStaffNotes] = useState(order.staffNotes || "");

  // Determine available workflow actions based on current status.
  const canVerify = order.status === "PENDING" || order.status === "UNDER_REVIEW";
  const canSendConfirmation = order.status === "UNDER_REVIEW";
  const canStartPacking = order.status === "CONFIRMED";
  const canReadyDelivery = order.status === "PACKING";
  const canDispatch = order.status === "READY_FOR_DELIVERY";
  const canMarkDelivered = order.status === "OUT_FOR_DELIVERY";
  const canComplete = order.status === "DELIVERED";
  const canCancel = !["COMPLETED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_STAFF"].includes(order.status);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      <button
        onClick={onToggle}
        className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
          <span className="text-sm text-gray-600 ml-3">{order.customerName}</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} />
          <span className="font-semibold text-sm">{fmt(order.total)} {order.currency}</span>
          <span className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString()}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t px-4 py-3 grid md:grid-cols-2 gap-4 text-sm">
          {/* Left column: customer info + workflow actions */}
          <div className="space-y-2">
            <p><span className="text-gray-500">Email:</span> {order.customerEmail}</p>
            {/* Display-only spacing after the calling code; the stored value is unchanged. */}
            <p><span className="text-gray-500">Phone:</span> {formatPhoneDisplay(order.customerPhone)}</p>
            <p><span className="text-gray-500">Address:</span> {order.address}, {order.city}</p>
            {order.notes && <p><span className="text-gray-500">Customer Notes:</span> {order.notes}</p>}
            {order.staffNotes && <p><span className="text-gray-500">Staff Notes:</span> {order.staffNotes}</p>}
            <p><span className="text-gray-500">POS Status:</span> <span className="font-medium">{statusLabel(order.posStatus)}</span></p>

            {/* Workflow actions */}
            <div className="pt-2 space-y-2">
              {canVerify && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase">Mark Item Availability:</p>
                  {order.items.map((item) => {
                    const current = itemStatusOverrides[item.id] ?? item.itemStatus;
                    const isPending = current === "PENDING";
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span className="truncate flex-1 text-xs">{item.name} (×{item.quantity})</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setItemStatusOverrides((p) => ({ ...p, [item.id]: "AVAILABLE" }))}
                            className={`px-2 py-0.5 rounded text-xs ${current === "AVAILABLE" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-green-100"}`}
                          >
                            ✓ Available
                          </button>
                          <button
                            onClick={() => setItemStatusOverrides((p) => ({ ...p, [item.id]: "UNAVAILABLE" }))}
                            className={`px-2 py-0.5 rounded text-xs ${current === "UNAVAILABLE" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-red-100"}`}
                          >
                            ✗ Unavailable
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <textarea
                    value={staffNotes}
                    onChange={(e) => setStaffNotes(e.target.value)}
                    placeholder="Staff notes (optional)..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs"
                    rows={2}
                  />
                  <button
                    onClick={() => {
                      const items = order.items
                        .filter((i) => itemStatusOverrides[i.id])
                        .map((i) => ({ itemId: i.id, itemStatus: itemStatusOverrides[i.id] }));
                      if (items.length === 0) return;
                      onVerify(order.id, items, staffNotes);
                    }}
                    disabled={busy}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save Availability
                  </button>
                </div>
              )}
              {canSendConfirmation && (
                <button
                  onClick={() => onSendConfirmation(order.id)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  → Send for Customer Confirmation
                </button>
              )}
              {canStartPacking && (
                <button
                  onClick={() => onPack(order.id, "pack")}
                  disabled={busy}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 disabled:opacity-50"
                >
                  → Start Packing
                </button>
              )}
              {canReadyDelivery && (
                <button
                  onClick={() => onPack(order.id, "ready", "INVOICED")}
                  disabled={busy}
                  className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-xs font-semibold hover:bg-cyan-700 disabled:opacity-50"
                >
                  → Ready for Delivery (Mark POS Invoiced)
                </button>
              )}
              {canDispatch && (
                <button
                  onClick={() => onPack(order.id, "deliver", "HANDED_TO_DELIVERY")}
                  disabled={busy}
                  className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-semibold hover:bg-orange-700 disabled:opacity-50"
                >
                  → Out for Delivery
                </button>
              )}
              {canMarkDelivered && (
                <button
                  onClick={() => onPack(order.id, "complete")}
                  disabled={busy}
                  className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-semibold hover:bg-teal-700 disabled:opacity-50"
                >
                  → Mark Delivered
                </button>
              )}
              {canComplete && (
                <button
                  onClick={() => onRequestComplete(order)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-gray-700 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 disabled:opacity-50"
                >
                  → Complete Order
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => onRequestCancel(order)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-200 ml-2 disabled:opacity-50"
                >
                  Cancel (Staff)
                </button>
              )}
            </div>
          </div>

          {/* Right column: items table with statuses */}
          <div className="min-w-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1">Item</th>
                  <th className="py-1">Qty</th>
                  <th className="py-1">Status</th>
                  <th className="py-1 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1">{i.name}</td>
                    <td className="py-1">{i.quantity}</td>
                    <td className="py-1"><ItemStatusBadge status={i.itemStatus} /></td>
                    <td className="py-1 text-right">{fmt(i.price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan={3} className="py-1 text-gray-500">Shipping</td>
                  <td className="py-1 text-right">{fmt(order.shipping)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="py-1 font-semibold">Total (indicative)</td>
                  <td className="py-1 text-right font-semibold">{fmt(order.total)} {order.currency}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit Log Tab                                                       */
/* ------------------------------------------------------------------ */

interface AuditLogEntry {
  id: number;
  actorId: number | null;
  actorName: string;
  actorEmail: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (entityFilter) params.set("entity", entityFilter);
    params.set("page", String(page));
    params.set("limit", "50");
    fetch(`/api/admin/audit-log?${params}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setLogs(data.data.logs);
          setEntities(data.data.entities);
          setTotalPages(data.data.pagination.totalPages);
          setTotal(data.data.pagination.total);
        } else {
          setError(data.error || "Failed to load audit log");
        }
      })
      .catch(() => setError("Failed to load audit log"))
      .finally(() => setLoading(false));
  }, [search, entityFilter, page]);

  useEffect(load, [load]);

  function exportCsv() {
    const headers = ["ID", "Actor", "Email", "Action", "Entity", "Entity ID", "Detail", "Timestamp"];
    const rows = logs.map((l) => [l.id, l.actorName, l.actorEmail, l.action, l.entity, l.entityId, `"${l.detail.replace(/"/g, '""')}"`, new Date(l.createdAt).toISOString()]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search audit log…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <select
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All entities</option>
          {entities.map((en) => <option key={en} value={en}>{en}</option>)}
        </select>
        <button onClick={exportCsv} className="px-3 py-2 bg-gray-700 text-white rounded-lg text-sm font-semibold hover:bg-gray-800">
          Export CSV
        </button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-gray-500">{total} entries (page {page} of {totalPages})</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Actor</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                  <th className="px-4 py-3 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      <span className="font-medium">{l.actorName}</span>
                      {l.actorEmail && <span className="text-xs text-gray-400 block">{l.actorEmail}</span>}
                    </td>
                    <td className="px-4 py-2"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono">{l.action}</span></td>
                    <td className="px-4 py-2">{l.entity} {l.entityId && <span className="text-xs text-gray-400">#{l.entityId}</span>}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{l.detail}</td>
                    <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No audit entries found.</td></tr>}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 justify-center pt-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 disabled:opacity-50 hover:bg-gray-100">← Prev</button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 disabled:opacity-50 hover:bg-gray-100">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

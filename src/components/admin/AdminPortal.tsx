"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { SecurityPanel } from "@/components/admin/SecurityPanel";
import { ToastProvider } from "@/components/admin/Toast";
import type { InventoryResponse, SessionSummary } from "@/components/admin/types";
import { VehicleEditor } from "@/components/admin/VehicleEditor";
import { AdminApiError, adminFetch, clearClientSecurityState } from "@/lib/client/admin-api";
import { lockDraftVault } from "@/lib/client/draft-vault";
import type { VehicleRecord, VehicleStatus } from "@/lib/domain/vehicle";

type AdminPortalProps = {
  encryptedDraftsEnabled: boolean;
  maximumImageBytes: number;
  maximumImageDimension: number;
};

type AdminView = "inventory" | "editor" | "security";
type SessionResponse = { ok: true; authenticated: true } & SessionSummary;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const statusNames: Record<VehicleStatus, string> = {
  draft: "Draft",
  published: "Published",
  pending: "Pending",
  sold: "Sold",
  archived: "Archived",
};

export function AdminPortal(props: AdminPortalProps) {
  return (
    <ToastProvider>
      <AdminPortalWorkspace {...props} />
    </ToastProvider>
  );
}

function AdminPortalWorkspace({
  encryptedDraftsEnabled,
  maximumImageBytes,
  maximumImageDimension,
}: AdminPortalProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<AdminView>("inventory");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  function redirectToLogin() {
    lockDraftVault();
    clearClientSecurityState();
    router.replace("/admin/login");
    router.refresh();
  }

  async function refreshSession() {
    const result = await adminFetch<SessionResponse>("/api/admin/auth/session");
    setSession({
      administrator: result.administrator,
      absoluteExpiresAt: result.absoluteExpiresAt,
      passkeyCount: result.passkeyCount,
      needsBackupPasskey: result.needsBackupPasskey,
      stepUpValid: result.stepUpValid,
    });
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      adminFetch<SessionResponse>("/api/admin/auth/session"),
      adminFetch<InventoryResponse>("/api/admin/inventory"),
    ])
      .then(([sessionResult, inventoryResult]) => {
        if (!active) return;
        setSession({
          administrator: sessionResult.administrator,
          absoluteExpiresAt: sessionResult.absoluteExpiresAt,
          passkeyCount: sessionResult.passkeyCount,
          needsBackupPasskey: sessionResult.needsBackupPasskey,
          stepUpValid: sessionResult.stepUpValid,
        });
        setVehicles(inventoryResult.vehicles);
        setRevision(inventoryResult.revision);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof AdminApiError && cause.status === 401) {
          redirectToLogin();
          return;
        }
        setError(cause instanceof Error ? cause.message : "The admin portal could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The router object is stable. This should run once per mounted portal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...vehicles]
      .filter((vehicle) => statusFilter === "all" || vehicle.status === statusFilter)
      .filter((vehicle) => {
        if (!query) return true;
        return [
          vehicle.stockNumber,
          vehicle.vin,
          vehicle.year,
          vehicle.make,
          vehicle.model,
          vehicle.trim,
          vehicle.slug,
        ].some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [search, statusFilter, vehicles]);

  const counts = useMemo(() => {
    const next: Record<VehicleStatus, number> = { draft: 0, published: 0, pending: 0, sold: 0, archived: 0 };
    for (const vehicle of vehicles) next[vehicle.status] += 1;
    return next;
  }, [vehicles]);

  function openNewVehicle() {
    setSelectedId(null);
    setView("editor");
  }

  function openVehicle(id: string) {
    setSelectedId(id);
    setView("editor");
  }

  function mergeSavedVehicle(saved: VehicleRecord) {
    setVehicles((current) => {
      const exists = current.some((vehicle) => vehicle.id === saved.id);
      return exists
        ? current.map((vehicle) => vehicle.id === saved.id ? saved : vehicle)
        : [saved, ...current];
    });
    setRevision((current) => current + 1);
  }

  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await adminFetch<{ ok: true }>("/api/admin/auth/session/logout", { method: "POST", json: {} });
    } catch (cause) {
      if (!(cause instanceof AdminApiError && cause.status === 401)) {
        setError(cause instanceof Error ? cause.message : "Sign out could not be confirmed.");
        setLoggingOut(false);
        return;
      }
    }
    redirectToLogin();
  }

  if (loading) {
    return (
      <main className="admin-loading" aria-busy="true">
        <span className="admin-spinner" aria-hidden="true" />
        <p>Opening protected inventory…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="admin-loading">
        <p className="admin-alert admin-alert-error" role="alert">{error || "Administrator session required."}</p>
        <Link className="admin-button admin-button-primary" href="/admin/login">Return to sign in</Link>
      </main>
    );
  }

  const selectedVehicle = selectedId
    ? vehicles.find((vehicle) => vehicle.id === selectedId) ?? null
    : null;

  return (
    <div className="admin-app-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <button
            className="admin-topbar-brand"
            type="button"
            onClick={() => setView("inventory")}
            aria-label="SpeedZone inventory dashboard"
          >
            <span className="admin-brand-mark" aria-hidden="true">SZ</span>
            <span><strong>SpeedZone</strong><small>Inventory admin</small></span>
          </button>
          <div className="admin-topbar-actions">
            <Link className="admin-site-link" href="/" target="_blank">View site <span aria-hidden="true">↗</span></Link>
            <button className="admin-button admin-button-quiet" type="button" disabled={loggingOut} onClick={logout}>
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <nav className="admin-mobile-nav" aria-label="Administrator navigation">
        <button className={view === "inventory" || view === "editor" ? "is-active" : ""} type="button" onClick={() => setView("inventory")}>
          <span aria-hidden="true">▦</span> Inventory
        </button>
        <button className={view === "security" ? "is-active" : ""} type="button" onClick={() => setView("security")}>
          <span aria-hidden="true">◆</span> Security
        </button>
      </nav>

      <div className="admin-workspace">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-user">
            <span aria-hidden="true">A</span>
            <div><strong>{session.administrator}</strong><small>Administrator</small></div>
          </div>
          <nav aria-label="Administrator navigation">
            <button className={view === "inventory" || view === "editor" ? "is-active" : ""} type="button" onClick={() => setView("inventory")}><span aria-hidden="true">▦</span>Inventory</button>
            <button className={view === "security" ? "is-active" : ""} type="button" onClick={() => setView("security")}><span aria-hidden="true">◆</span>Security</button>
          </nav>
          <div className="admin-session-note">
            <strong>Session limit</strong>
            <span>Expires by {new Date(session.absoluteExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
        </aside>

        <main className="admin-main" id="admin-main">
          {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}

          {view === "editor" ? (
            <VehicleEditor
              key={selectedId ?? "new-vehicle"}
              vehicle={selectedVehicle}
              encryptedDraftsEnabled={encryptedDraftsEnabled}
              maximumImageBytes={maximumImageBytes}
              maximumImageDimension={maximumImageDimension}
              onSaved={mergeSavedVehicle}
              onClose={() => setView("inventory")}
            />
          ) : null}

          {view === "security" ? (
            <SecurityPanel
              session={session}
              onSessionRefresh={refreshSession}
              onSignedOut={redirectToLogin}
            />
          ) : null}

          {view === "inventory" ? (
            <div className="admin-inventory-page">
              <header className="admin-page-heading admin-page-heading-row">
                <div>
                  <p className="admin-eyebrow">Inventory revision {revision}</p>
                  <h1>Inventory</h1>
                  <p>Create, publish, and maintain every vehicle from one mobile-ready workspace.</p>
                </div>
                <button className="admin-button admin-button-primary" type="button" onClick={openNewVehicle}>+ Add vehicle</button>
              </header>

              {session.needsBackupPasskey ? (
                <button className="admin-backup-warning" type="button" onClick={() => setView("security")}>
                  <strong>Register a backup passkey</strong>
                  <span>This account has fewer than two authenticators. Add another before one is lost. →</span>
                </button>
              ) : null}

              <section className="admin-metric-grid" aria-label="Inventory summary">
                <button type="button" onClick={() => setStatusFilter("all")}><span>All vehicles</span><strong>{vehicles.length}</strong></button>
                <button type="button" onClick={() => setStatusFilter("published")}><span>Published</span><strong>{counts.published}</strong></button>
                <button type="button" onClick={() => setStatusFilter("draft")}><span>Drafts</span><strong>{counts.draft}</strong></button>
                <button type="button" onClick={() => setStatusFilter("pending")}><span>Pending</span><strong>{counts.pending}</strong></button>
              </section>

              <section className="admin-inventory-panel" aria-labelledby="vehicle-list-title">
                <div className="admin-inventory-toolbar">
                  <div>
                    <h2 id="vehicle-list-title">Vehicles</h2>
                    <p>{filteredVehicles.length} of {vehicles.length} shown</p>
                  </div>
                  <div className="admin-filter-controls">
                    <label className="admin-search">
                      <span className="admin-sr-only">Search inventory</span>
                      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock, VIN, make…" />
                    </label>
                    <label>
                      <span className="admin-sr-only">Filter by status</span>
                      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as VehicleStatus | "all")}>
                        <option value="all">All statuses</option>
                        {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                {filteredVehicles.length ? (
                  <ul className="admin-vehicle-list">
                    {filteredVehicles.map((vehicle) => {
                      const photo = vehicle.photographs[0];
                      return (
                        <li key={vehicle.id}>
                          <button className="admin-vehicle-card" type="button" onClick={() => openVehicle(vehicle.id)}>
                            <span className="admin-vehicle-thumb">
                              {photo ? (
                                <Image src={photo.url} alt="" width={photo.width} height={photo.height} sizes="7rem" />
                              ) : <span aria-hidden="true">No photo</span>}
                            </span>
                            <span className="admin-vehicle-summary">
                              <span className="admin-vehicle-title">{vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}</span>
                              <span className="admin-vehicle-meta">Stock {vehicle.stockNumber} · {integer.format(vehicle.mileage)} mi</span>
                              <span className="admin-vehicle-price">{money.format(vehicle.price)}</span>
                            </span>
                            <span className={`admin-status admin-status-${vehicle.status}`}>{statusNames[vehicle.status]}</span>
                            <span className="admin-chevron" aria-hidden="true">›</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="admin-empty-state">
                    <span aria-hidden="true">▦</span>
                    <h3>{vehicles.length ? "No matching vehicles" : "No vehicles yet"}</h3>
                    <p>{vehicles.length ? "Change the search or status filter." : "Create the first inventory record as a draft."}</p>
                    {!vehicles.length ? <button className="admin-button admin-button-primary" type="button" onClick={openNewVehicle}>Add first vehicle</button> : null}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

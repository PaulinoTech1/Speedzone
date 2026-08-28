"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/admin/Toast";
import type {
  PhotoLibraryEntry,
  PhotoLibraryResponse,
  PhotoLibraryState,
  PhotoLibraryTotals,
} from "@/components/admin/types";
import { adminFetch } from "@/lib/client/admin-api";
import type { VehicleStatus } from "@/lib/domain/vehicle";

type PhotoLibraryPanelProps = {
  onOpenVehicle: (vehicleId: string) => void;
};

type Filter = "all" | PhotoLibraryState;

const emptyTotals: PhotoLibraryTotals = {
  objects: 0,
  bytes: 0,
  linked: 0,
  unlinked: 0,
  unlinkedBytes: 0,
  staging: 0,
  stagingBytes: 0,
};

const stateLabels: Record<PhotoLibraryState, string> = {
  linked: "In use",
  unlinked: "Unlinked",
  staging: "Staging leftover",
};

const statusNames: Record<VehicleStatus, string> = {
  draft: "Draft",
  published: "Published",
  pending: "Pending",
  sold: "Sold",
  archived: "Archived",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function PhotoLibraryPanel({ onOpenVehicle }: PhotoLibraryPanelProps) {
  const notify = useToast();
  const [entries, setEntries] = useState<PhotoLibraryEntry[]>([]);
  const [missing, setMissing] = useState<PhotoLibraryResponse["missing"]>([]);
  const [totals, setTotals] = useState<PhotoLibraryTotals>(emptyTotals);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const applyLibrary = useCallback((result: PhotoLibraryResponse) => {
    setEntries(result.entries);
    setMissing(result.missing);
    setTotals(result.totals);
    setTruncated(result.truncated);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applyLibrary(await adminFetch<PhotoLibraryResponse>("/api/admin/photos"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Photo storage could not be read.");
    } finally {
      setLoading(false);
    }
  }, [applyLibrary]);

  useEffect(() => {
    let active = true;
    adminFetch<PhotoLibraryResponse>("/api/admin/photos")
      .then((result) => {
        if (active) applyLibrary(result);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Photo storage could not be read.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyLibrary]);

  async function remove(entry: PhotoLibraryEntry) {
    const confirmed = window.confirm(
      entry.state === "staging"
        ? `Delete the abandoned upload ${entry.pathname}? This cannot be undone.`
        : `Delete ${entry.pathname}? It is not used by any vehicle, and this cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleting(entry.pathname);
    setError("");
    try {
      const result = await adminFetch<PhotoLibraryResponse & { removed: string }>(
        "/api/admin/photos",
        { method: "DELETE", json: { pathname: entry.pathname } },
      );
      applyLibrary(result);
      notify("success", `Deleted ${formatBytes(entry.size)} from Blob storage`);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The photograph could not be deleted.";
      setError(message);
      notify("error", message);
    } finally {
      setDeleting(null);
    }
  }

  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.state === filter)),
    [entries, filter],
  );

  const reclaimable = totals.unlinkedBytes + totals.stagingBytes;

  return (
    <div className="admin-photolib-page">
      <header className="admin-page-heading admin-page-heading-row">
        <div>
          <p className="admin-eyebrow">Vercel Blob</p>
          <h1>Photo storage</h1>
          <p>
            Every object actually held in the photo and staging stores, reconciled against the
            inventory record.
          </p>
        </div>
        <button
          className="admin-button admin-button-secondary"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Reading…" : "Refresh"}
        </button>
      </header>

      {error ? <p className="admin-alert admin-alert-error" role="alert">{error}</p> : null}

      {truncated ? (
        <p className="admin-alert admin-alert-warning">
          The store holds more objects than this view lists. Delete what you no longer need, then
          refresh to see the rest.
        </p>
      ) : null}

      <section className="admin-metric-grid" aria-label="Photo storage summary">
        <button type="button" onClick={() => setFilter("all")}>
          <span>Objects</span>
          <strong>{totals.objects}</strong>
        </button>
        <button type="button" onClick={() => setFilter("linked")}>
          <span>In use</span>
          <strong>{totals.linked}</strong>
        </button>
        <button type="button" onClick={() => setFilter("unlinked")}>
          <span>Unlinked</span>
          <strong>{totals.unlinked}</strong>
        </button>
        <button type="button" onClick={() => setFilter("staging")}>
          <span>Staging leftovers</span>
          <strong>{totals.staging}</strong>
        </button>
      </section>

      <p className="admin-photolib-usage">
        {formatBytes(totals.bytes)} stored
        {reclaimable > 0 ? (
          <>
            {" · "}
            <strong>{formatBytes(reclaimable)} reclaimable</strong>
          </>
        ) : null}
      </p>

      {missing.length ? (
        <section className="admin-panel admin-photolib-missing" aria-labelledby="missing-photos-title">
          <div className="admin-panel-heading">
            <h2 id="missing-photos-title">
              {missing.length} broken {missing.length === 1 ? "reference" : "references"}
            </h2>
            <p>
              These vehicles point at a photograph that is no longer in the store. Re-upload it, or
              remove it from the vehicle.
            </p>
          </div>
          <ul className="admin-photolib-missing-list">
            {missing.map((item) => (
              <li key={item.pathname}>
                <button type="button" onClick={() => onOpenVehicle(item.vehicleId)}>
                  <strong>{item.vehicleTitle}</strong>
                  <span>{item.pathname}</span>
                </button>
                <span className={`admin-status admin-status-${item.vehicleStatus}`}>
                  {statusNames[item.vehicleStatus]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="admin-panel" aria-labelledby="photo-objects-title">
        <div className="admin-inventory-toolbar">
          <div>
            <h2 id="photo-objects-title">Stored objects</h2>
            <p>
              {visible.length} of {entries.length} shown
            </p>
          </div>
          <div className="admin-photolib-filters" role="group" aria-label="Filter by state">
            {(["all", "linked", "unlinked", "staging"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : stateLabels[value]}
              </button>
            ))}
          </div>
        </div>

        {loading && !entries.length ? (
          <p className="admin-photolib-empty">Reading Blob storage…</p>
        ) : null}

        {!loading && !visible.length ? (
          <p className="admin-photolib-empty">
            {entries.length ? "Nothing matches this filter." : "The photo stores are empty."}
          </p>
        ) : null}

        <ul className="admin-photolib-list">
          {visible.map((entry) => {
            const vehicleId = entry.vehicleId;
            return (
              <li key={entry.pathname} className="admin-photolib-row">
                <span className="admin-photolib-thumb">
                  {entry.state === "staging" ? (
                    <span aria-hidden="true">Private</span>
                  ) : (
                    <Image src={entry.url} alt={entry.alt ?? ""} fill sizes="7rem" />
                  )}
                </span>
                <span className="admin-photolib-summary">
                  <span className="admin-photolib-path">{entry.pathname}</span>
                  <span className="admin-photolib-meta">
                    {formatBytes(entry.size)}
                    {entry.width && entry.height ? ` · ${entry.width}×${entry.height}` : ""}
                    {` · uploaded ${relativeDay(entry.uploadedAt)}`}
                  </span>
                  {vehicleId ? (
                    <button
                      className="admin-photolib-vehicle"
                      type="button"
                      onClick={() => onOpenVehicle(vehicleId)}
                    >
                      {entry.vehicleTitle ?? "Open vehicle"}
                      {entry.vehicleStatus ? ` · ${statusNames[entry.vehicleStatus]}` : ""}
                    </button>
                  ) : (
                    <span className="admin-photolib-meta">No matching vehicle record</span>
                  )}
                </span>
                <span className="admin-photolib-actions">
                  <span className={`admin-photolib-state admin-photolib-state-${entry.state}`}>
                    {stateLabels[entry.state]}
                  </span>
                  {entry.state === "linked" ? null : (
                    <button
                      className="admin-button admin-button-danger admin-button-small"
                      type="button"
                      disabled={deleting === entry.pathname}
                      onClick={() => void remove(entry)}
                    >
                      {deleting === entry.pathname ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

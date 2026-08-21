"use client";

import { upload } from "@vercel/blob/client";
import Image from "next/image";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";

import { DraftVaultPanel } from "@/components/admin/DraftVaultPanel";
import { useToast, type ToastTone } from "@/components/admin/Toast";
import {
  blankVehicleForm,
  formToVehicleInput,
  vehicleToForm,
  type VehicleFormValues,
  type VehicleResponse,
} from "@/components/admin/types";
import {
  canTransitionVehicle,
  vehicleInputSchema,
  vehicleStatuses,
  type VehiclePhoto,
  type VehicleRecord,
  type VehicleStatus,
} from "@/lib/domain/vehicle";
import { AdminApiError, adminFetch, getCsrfToken } from "@/lib/client/admin-api";
import { deleteEncryptedDraft, isDraftVaultUnlocked } from "@/lib/client/draft-vault";
import { processVehiclePhoto } from "@/lib/client/image-processing";

/**
 * Classifies a caught action error for toast display. A 401 always means an
 * expired or revoked session (the passkey-verified cookie, not a password),
 * so it is reported as an authorization failure rather than a generic one.
 */
function describeActionError(error: unknown, fallback: string): { tone: ToastTone; message: string } {
  if (error instanceof AdminApiError) {
    if (error.status === 401) {
      return { tone: "error", message: "Your session expired. Sign in again to continue." };
    }
    return { tone: "error", message: error.message || fallback };
  }
  if (error instanceof TypeError) {
    return { tone: "error", message: "Network error. Check your connection and try again." };
  }
  return { tone: "error", message: error instanceof Error ? error.message : fallback };
}

type VehicleEditorProps = {
  vehicle: VehicleRecord | null;
  encryptedDraftsEnabled: boolean;
  maximumImageBytes: number;
  maximumImageDimension: number;
  onSaved: (vehicle: VehicleRecord) => void;
  onClose: () => void;
};

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength?: number;
  inputMode?: "numeric" | "decimal" | "text";
  autoCapitalize?: "none" | "characters" | "sentences" | "words";
  help?: string;
  placeholder?: string;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const statusLabel: Record<VehicleStatus, string> = {
  draft: "Draft",
  published: "Published",
  pending: "Pending",
  sold: "Sold",
  archived: "Archived",
};

function TextField({
  label,
  value,
  onChange,
  required,
  maxLength = 120,
  inputMode = "text",
  autoCapitalize,
  help,
  placeholder,
}: TextFieldProps) {
  return (
    <label className="admin-field">
      <span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        maxLength={maxLength}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
      />
      {help ? <small>{help}</small> : null}
    </label>
  );
}

function VehiclePreview({ form }: { form: VehicleFormValues }) {
  const price = Number(form.price);
  const mileage = Number(form.mileage);
  const features = form.featuresText.split("\n").map((feature) => feature.trim()).filter(Boolean);
  const hero = form.photographs[0];

  return (
    <section className="admin-preview" aria-labelledby="vehicle-preview-title">
      <div className="admin-preview-media">
        {hero ? (
          <Image
            src={hero.url}
            alt={hero.alt || `${form.year} ${form.make} ${form.model}`}
            width={hero.width}
            height={hero.height}
            sizes="(max-width: 760px) 100vw, 48rem"
            priority={false}
          />
        ) : (
          <div className="admin-photo-placeholder">Add a photograph before publishing</div>
        )}
      </div>
      <div className="admin-preview-body">
        <div className={`admin-status admin-status-${form.status}`}>{statusLabel[form.status]}</div>
        <p className="admin-preview-stock">Stock {form.stockNumber || "not assigned"}</p>
        <h2 id="vehicle-preview-title">{[form.year, form.make, form.model, form.trim].filter(Boolean).join(" ") || "Untitled vehicle"}</h2>
        <div className="admin-preview-facts">
          <strong>{Number.isFinite(price) ? money.format(price) : "Price not set"}</strong>
          <span>{Number.isFinite(mileage) ? `${integer.format(mileage)} miles` : "Mileage not set"}</span>
        </div>
        <p className="admin-preview-description">{form.description || "No description yet."}</p>
        {features.length ? (
          <ul className="admin-preview-features">
            {features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        ) : null}
        <dl className="admin-preview-specs">
          <div><dt>Engine</dt><dd>{form.engine || "—"}</dd></div>
          <div><dt>Transmission</dt><dd>{form.transmission || "—"}</dd></div>
          <div><dt>Drivetrain</dt><dd>{form.drivetrain || "—"}</dd></div>
          <div><dt>Fuel</dt><dd>{form.fuelType || "—"}</dd></div>
          <div><dt>Exterior</dt><dd>{form.exteriorColor || "—"}</dd></div>
          <div><dt>Interior</dt><dd>{form.interiorColor || "—"}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function reorderPhoto(photographs: VehiclePhoto[], from: number, to: number): VehiclePhoto[] {
  if (to < 0 || to >= photographs.length) return photographs;
  const copy = [...photographs];
  const [photo] = copy.splice(from, 1);
  if (!photo) return photographs;
  copy.splice(to, 0, photo);
  return copy;
}

export function VehicleEditor({
  vehicle,
  encryptedDraftsEnabled,
  maximumImageBytes,
  maximumImageDimension,
  onSaved,
  onClose,
}: VehicleEditorProps) {
  const [record, setRecord] = useState<VehicleRecord | null>(vehicle);
  const [form, setForm] = useState<VehicleFormValues>(() => vehicle ? vehicleToForm(vehicle) : blankVehicleForm());
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadAlt, setUploadAlt] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const notify = useToast();

  const recordKey = record?.id ?? "new-vehicle";
  const startingStatus = record?.status ?? "draft";
  const allowedActions = useMemo(
    () => vehicleStatuses.filter((next) => canTransitionVehicle(startingStatus, next)),
    [startingStatus],
  );

  function update<K extends keyof VehicleFormValues>(key: K, value: VehicleFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function suggestedSlug(): string {
    return [form.year, form.make, form.model, form.trim, form.stockNumber]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100);
  }

  function validatedInput(candidate: VehicleFormValues, existing: VehicleRecord | null) {
    let unparsed;
    try {
      unparsed = formToVehicleInput(candidate, existing?.version);
    } catch {
      setErrors(["This form or local draft is incomplete. Review every required field."]);
      return null;
    }
    const result = vehicleInputSchema.safeParse(unparsed);
    if (!result.success) {
      setErrors(result.error.issues.map((issue) => {
        const field = issue.path[0] ? `${String(issue.path[0])}: ` : "";
        return `${field}${issue.message}`;
      }));
      return null;
    }
    setErrors([]);
    return result.data;
  }

  async function persistCandidate(
    candidate: VehicleFormValues,
    existing: VehicleRecord | null,
    successMessage = "Vehicle saved.",
  ): Promise<VehicleRecord> {
    const input = validatedInput(candidate, existing);
    if (!input) throw new Error("Review the highlighted validation messages.");
    const result = existing
      ? await adminFetch<VehicleResponse>(`/api/admin/inventory/${encodeURIComponent(existing.id)}`, {
          method: "PUT",
          json: input,
        })
      : await adminFetch<VehicleResponse>("/api/admin/inventory", { method: "POST", json: input });

    const wasNew = !existing;
    setRecord(result.vehicle);
    setForm(vehicleToForm(result.vehicle));
    setStatus(successMessage);
    onSaved(result.vehicle);
    if (wasNew && encryptedDraftsEnabled && isDraftVaultUnlocked()) {
      deleteEncryptedDraft("new-vehicle").catch(() => undefined);
    }
    return result.vehicle;
  }

  async function saveVehicle(nextStatus?: VehicleStatus) {
    const candidate = nextStatus ? { ...form, status: nextStatus } : form;
    const wasNew = !record;
    setBusy(true);
    setStatus("");
    try {
      await persistCandidate(candidate, record, `${statusLabel[candidate.status]} vehicle saved.`);
      notify("success", wasNew ? "Vehicle created." : `${statusLabel[candidate.status]} vehicle saved.`);
    } catch (error) {
      const described = describeActionError(error, "The vehicle could not be saved.");
      setStatus(described.message);
      notify(described.tone, described.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveVehicle();
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const selected = Array.from(inputElement.files ?? []);
    inputElement.value = "";
    if (!selected.length) return;
    if (form.photographs.length + selected.length > 12) {
      setErrors([`Choose no more than ${12 - form.photographs.length} additional photograph(s).`]);
      return;
    }

    setUploading(true);
    setErrors([]);
    setStatus("Saving the vehicle before uploading photographs…");
    try {
      let savedRecord = await persistCandidate(form, record, "Vehicle saved. Processing photographs…");
      let workingForm = vehicleToForm(savedRecord);

      for (let index = 0; index < selected.length; index += 1) {
        const source = selected[index];
        if (!source) continue;
        setStatus(`Processing photograph ${index + 1} of ${selected.length}…`);
        const processed = await processVehiclePhoto(
          source,
          maximumImageDimension,
          maximumImageBytes,
        );
        // Blob's client-upload helper performs its own request rather than
        // using adminFetch, so renew the HttpOnly-bound token before each
        // upload instead of risking a stale long-lived editor session.
        const csrfToken = await getCsrfToken(true);
        const blob = await upload(
          `staging/vehicles/${savedRecord.id}/photo.webp`,
          processed.file,
          {
            access: "private",
            contentType: "image/webp",
            multipart: false,
            handleUploadUrl: "/api/admin/uploads",
            clientPayload: JSON.stringify({ vehicleId: savedRecord.id }),
            headers: { "x-csrf-token": csrfToken },
            onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
          },
        );
        const defaultAlt = [workingForm.year, workingForm.make, workingForm.model, workingForm.trim]
          .filter(Boolean)
          .join(" ");
        const finalized = await adminFetch<{ ok: true; photograph: VehiclePhoto }>(
          "/api/admin/uploads/finalize",
          {
            method: "POST",
            json: {
              stagingUrl: blob.url,
              vehicleId: savedRecord.id,
              alt: uploadAlt.trim() || defaultAlt,
            },
          },
        );
        workingForm = {
          ...workingForm,
          photographs: [...workingForm.photographs, finalized.photograph],
        };
        savedRecord = await persistCandidate(
          workingForm,
          savedRecord,
          `Attached photograph ${index + 1} of ${selected.length}.`,
        );
        workingForm = vehicleToForm(savedRecord);
      }
      setUploadProgress(100);
      const summary = `${selected.length} photograph${selected.length === 1 ? "" : "s"} processed, uploaded, and attached.`;
      setStatus(summary);
      notify("success", summary);
    } catch (error) {
      const described = describeActionError(error, "Photograph upload failed.");
      setStatus(described.message);
      notify(described.tone, described.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function loadLocalDraft(draft: VehicleFormValues, basedOnVersion: number | null) {
    const parsed = validatedInput(draft, record);
    if (!parsed) {
      setStatus("The decrypted draft does not match the current vehicle form schema.");
      return;
    }
    setForm(draft);
    setStatus(
      record && basedOnVersion !== record.version
        ? `Local draft loaded from vehicle version ${basedOnVersion ?? "unknown"}; the server is now version ${record.version}. Review carefully before saving.`
        : "Encrypted local draft loaded. Review it before saving.",
    );
  }

  return (
    <div className="admin-editor">
      <div className="admin-editor-heading">
        <div>
          <button className="admin-back-button" type="button" onClick={onClose}>← Inventory</button>
          <p className="admin-eyebrow">{record ? `Stock ${record.stockNumber}` : "New inventory record"}</p>
          <h1>{record ? `Edit ${record.year} ${record.make} ${record.model}` : "Add a vehicle"}</h1>
          {record ? <p className="admin-record-meta">Version {record.version} · Updated {new Date(record.updatedAt).toLocaleString()}</p> : null}
        </div>
        <button
          className="admin-button admin-button-secondary"
          type="button"
          aria-pressed={previewing}
          onClick={() => setPreviewing((current) => !current)}
        >
          {previewing ? "Return to editor" : "Preview listing"}
        </button>
      </div>

      {previewing ? <VehiclePreview form={form} /> : (
        <form className="admin-vehicle-form" onSubmit={submit} noValidate>
          <section className="admin-form-section" aria-labelledby="identity-heading">
            <div className="admin-form-section-heading">
              <span>01</span><div><h2 id="identity-heading">Identity</h2><p>Unique identifiers and public URL.</p></div>
            </div>
            <div className="admin-field-grid">
              <TextField label="Stock number" value={form.stockNumber} onChange={(value) => update("stockNumber", value)} required maxLength={40} autoCapitalize="characters" />
              <TextField label="VIN" value={form.vin} onChange={(value) => update("vin", value)} required maxLength={17} autoCapitalize="characters" help="Exactly 17 characters; I, O, and Q are not valid." />
              <TextField label="Year" value={form.year} onChange={(value) => update("year", value.replace(/\D/g, ""))} required maxLength={4} inputMode="numeric" />
              <div className="admin-field admin-field-wide">
                <span>URL slug <b aria-hidden="true">*</b></span>
                <div className="admin-input-action">
                  <input
                    value={form.slug}
                    onChange={(event) => update("slug", event.target.value.toLowerCase())}
                    required
                    maxLength={100}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => update("slug", suggestedSlug())}>Generate</button>
                </div>
                <small>Lowercase letters, numbers, and single hyphens.</small>
              </div>
            </div>
          </section>

          <section className="admin-form-section" aria-labelledby="vehicle-heading">
            <div className="admin-form-section-heading">
              <span>02</span><div><h2 id="vehicle-heading">Vehicle</h2><p>Core details shown to shoppers.</p></div>
            </div>
            <div className="admin-field-grid">
              <TextField label="Make" value={form.make} onChange={(value) => update("make", value)} required maxLength={80} autoCapitalize="words" />
              <TextField label="Model" value={form.model} onChange={(value) => update("model", value)} required maxLength={80} autoCapitalize="words" />
              <TextField label="Trim" value={form.trim} onChange={(value) => update("trim", value)} maxLength={80} />
              <TextField label="Body style" value={form.bodyStyle} onChange={(value) => update("bodyStyle", value)} maxLength={80} placeholder="SUV, sedan, pickup…" />
              <TextField label="Price (USD)" value={form.price} onChange={(value) => update("price", value.replace(/\D/g, ""))} required inputMode="numeric" maxLength={9} />
              <TextField label="Mileage" value={form.mileage} onChange={(value) => update("mileage", value.replace(/\D/g, ""))} required inputMode="numeric" maxLength={8} />
              <TextField label="Exterior color" value={form.exteriorColor} onChange={(value) => update("exteriorColor", value)} maxLength={80} />
              <TextField label="Interior color" value={form.interiorColor} onChange={(value) => update("interiorColor", value)} maxLength={80} />
            </div>
          </section>

          <section className="admin-form-section" aria-labelledby="mechanical-heading">
            <div className="admin-form-section-heading">
              <span>03</span><div><h2 id="mechanical-heading">Mechanical</h2><p>Powertrain and equipment.</p></div>
            </div>
            <div className="admin-field-grid">
              <TextField label="Transmission" value={form.transmission} onChange={(value) => update("transmission", value)} maxLength={80} />
              <TextField label="Drivetrain" value={form.drivetrain} onChange={(value) => update("drivetrain", value)} maxLength={80} placeholder="FWD, AWD, 4WD…" />
              <TextField label="Fuel type" value={form.fuelType} onChange={(value) => update("fuelType", value)} maxLength={80} />
              <TextField label="Engine" value={form.engine} onChange={(value) => update("engine", value)} maxLength={120} />
            </div>
          </section>

          <section className="admin-form-section" aria-labelledby="story-heading">
            <div className="admin-form-section-heading">
              <span>04</span><div><h2 id="story-heading">Listing copy</h2><p>Plain text only; the public site escapes markup.</p></div>
            </div>
            <label className="admin-field">
              <span>Description</span>
              <textarea value={form.description} onChange={(event) => update("description", event.target.value)} maxLength={5000} rows={8} />
              <small>{form.description.length.toLocaleString()} / 5,000 characters</small>
            </label>
            <label className="admin-field">
              <span>Features</span>
              <textarea value={form.featuresText} onChange={(event) => update("featuresText", event.target.value)} rows={7} placeholder={"Bluetooth\nBackup camera\nHeated seats"} />
              <small>One feature per line, up to 50.</small>
            </label>
          </section>

          <section className="admin-form-section" aria-labelledby="photos-heading">
            <div className="admin-form-section-heading">
              <span>05</span><div><h2 id="photos-heading">Photographs</h2><p>Up to 12; the first is the listing cover.</p></div>
            </div>
            <div className="admin-upload-panel">
              <label className="admin-field">
                <span>Alt text for new photographs</span>
                <input value={uploadAlt} onChange={(event) => setUploadAlt(event.target.value)} maxLength={180} placeholder="Defaults to year, make, model, and trim" />
              </label>
              <label className={`admin-file-button ${uploading || form.photographs.length >= 12 ? "is-disabled" : ""}`}>
                <span>{uploading ? `Uploading ${uploadProgress}%` : "Choose photographs"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={uploading || form.photographs.length >= 12}
                  onChange={addPhotos}
                />
              </label>
              <p>
                JPEG, PNG, or WebP. Your browser corrects orientation, redraws pixels to remove
                EXIF/location metadata, resizes to {maximumImageDimension.toLocaleString()} px,
                converts to WebP, and enforces a post-compression limit of {Math.ceil(maximumImageBytes / (1024 * 1024))} MiB before upload.
                Choosing files saves current form changes first.
              </p>
              {uploading ? <progress value={uploadProgress} max="100">{uploadProgress}%</progress> : null}
            </div>

            {form.photographs.length ? (
              <ol className="admin-photo-list">
                {form.photographs.map((photo, index) => (
                  <li key={photo.pathname}>
                    <Image src={photo.url} alt="" width={photo.width} height={photo.height} sizes="7rem" />
                    <div className="admin-photo-detail">
                      <strong>{index === 0 ? "Cover photograph" : `Photograph ${index + 1}`}</strong>
                      <label className="admin-field">
                        <span>Alt text</span>
                        <input
                          value={photo.alt}
                          maxLength={180}
                          onChange={(event) => {
                            const photographs = [...form.photographs];
                            const current = photographs[index];
                            if (!current) return;
                            photographs[index] = { ...current, alt: event.target.value };
                            update("photographs", photographs);
                          }}
                        />
                      </label>
                    </div>
                    <div className="admin-photo-actions" aria-label={`Reorder photograph ${index + 1}`}>
                      <button type="button" disabled={index === 0} onClick={() => update("photographs", reorderPhoto(form.photographs, index, index - 1))}>↑<span className="admin-sr-only">Move earlier</span></button>
                      <button type="button" disabled={index === form.photographs.length - 1} onClick={() => update("photographs", reorderPhoto(form.photographs, index, index + 1))}>↓<span className="admin-sr-only">Move later</span></button>
                      <button className="admin-remove-button" type="button" onClick={() => update("photographs", form.photographs.filter((_, photoIndex) => photoIndex !== index))}>Remove</button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="admin-empty-inline">No photographs attached.</p>}
          </section>

          <section className="admin-form-section" aria-labelledby="status-heading">
            <div className="admin-form-section-heading">
              <span>06</span><div><h2 id="status-heading">Status</h2><p>Only published vehicles appear on the public website.</p></div>
            </div>
            <label className="admin-field admin-status-select">
              <span>Current form status</span>
              <select value={form.status} onChange={(event) => update("status", event.target.value as VehicleStatus)}>
                {vehicleStatuses.map((candidate) => <option key={candidate} value={candidate}>{statusLabel[candidate]}</option>)}
              </select>
            </label>
            <div className="admin-status-actions" aria-label="Save with status">
              {allowedActions.map((candidate) => {
                const label = candidate === "draft" && startingStatus === "published"
                  ? "Unpublish"
                  : candidate === "draft" && startingStatus === "archived"
                    ? "Restore as draft"
                    : candidate === "published" && startingStatus === "sold"
                      ? "Return to inventory"
                      : candidate === "draft"
                        ? "Save as draft"
                        : candidate === "published"
                          ? "Publish"
                          : candidate === "pending"
                            ? "Mark pending"
                            : candidate === "sold"
                              ? "Mark sold"
                              : "Archive";
                return (
                  <button
                    key={candidate}
                    className={`admin-button ${candidate === "published" ? "admin-button-primary" : candidate === "archived" ? "admin-button-danger" : "admin-button-secondary"}`}
                    type="button"
                    disabled={busy || uploading}
                    onClick={() => void saveVehicle(candidate)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          {encryptedDraftsEnabled ? (
            <DraftVaultPanel
              recordKey={recordKey}
              baseVersion={record?.version ?? null}
              form={form}
              onLoad={loadLocalDraft}
            />
          ) : null}

          {errors.length ? (
            <div className="admin-alert admin-alert-error" role="alert">
              <strong>Review this vehicle:</strong>
              <ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul>
            </div>
          ) : null}
          {status ? <p className="admin-alert admin-alert-info" role="status">{status}</p> : null}

          <div className="admin-editor-savebar">
            <button className="admin-button admin-button-primary" disabled={busy || uploading}>
              {busy ? "Saving…" : record ? "Save changes" : "Create vehicle"}
            </button>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => setPreviewing(true)}>Preview</button>
            <button className="admin-button admin-button-quiet" type="button" onClick={onClose}>Close</button>
          </div>
        </form>
      )}
    </div>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element */
import { FormEvent, useEffect, useRef, useState } from "react";
import { put } from "@vercel/blob/client";
import type { Vehicle } from "@/lib/inventory";
import AdminPasskey from "@/components/admin/AdminPasskey";
import {
  createInventoryPhotoPath,
  inventoryPhotoContentTypes,
  maxInventoryPhotoCount,
  maxInventoryPhotoSize,
} from "@/lib/inventory-photos";

const empty = { year: "", make: "", model: "", price: "", mileage: "", condition: "Used", status: "available", description: "" };
const maxPhotoDimension = 2400;
const webpQuality = 0.82;

function isSupportedPhoto(file: File) {
  if (inventoryPhotoContentTypes.includes(file.type) || file.type === "image/jpg") return true;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return !file.type && ["jpg", "jpeg", "png", "webp"].includes(extension ?? "");
}

async function compressPhoto(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => {
        console.error("[inventory] browser could not decode selected photo", {
          name: file.name,
          type: file.type,
          size: file.size,
        });
        reject(new Error(`Unable to read ${file.name}. The image may be damaged or use an unsupported format.`));
      };
      image.src = sourceUrl;
    });

    const scale = Math.min(1, maxPhotoDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error(`Unable to read ${file.name}.`);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", webpQuality));
    if (!blob) throw new Error(`Unable to compress ${file.name}.`);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "vehicle-photo";
    if (!inventoryPhotoContentTypes.includes(blob.type)) throw new Error(`Unable to optimize ${file.name} in a supported format.`);
    const outputType = blob.type;
    const extension = outputType === "image/webp" ? "webp" : outputType === "image/jpeg" ? "jpg" : "png";
    return new File([blob], `${baseName}.${extension}`, { type: outputType, lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function photoSelectionError(selected: File[], existingCount: number) {
  if (existingCount + selected.length > maxInventoryPhotoCount) return `Add no more than ${maxInventoryPhotoCount} photos to one listing.`;
  if (selected.some((file) => !isSupportedPhoto(file))) return "Use JPG, PNG, or WebP photos. HEIC files need to be converted before uploading.";
  if (selected.some((file) => file.size > maxInventoryPhotoSize)) return "Each photo must be under 8MB before compression.";
  return null;
}

async function preparePhotos(selected: File[]) {
  const compressed: File[] = [];
  for (const photo of selected) compressed.push(await compressPhoto(photo));
  if (compressed.some((file) => file.size > maxInventoryPhotoSize)) throw new Error("A compressed photo is still over 8MB. Try a smaller original.");
  const originalBytes = selected.reduce((total, file) => total + file.size, 0);
  const compressedBytes = compressed.reduce((total, file) => total + file.size, 0);
  const savedPercent = originalBytes ? Math.max(0, Math.round((1 - compressedBytes / originalBytes) * 100)) : 0;
  return { compressed, savedPercent };
}

async function uploadPhotosSequentially(
  photos: File[],
  onProgress: (current: number, total: number) => void,
) {
  const readinessResponse = await fetch("/api/inventory/upload", {
    credentials: "include",
    cache: "no-store",
  });
  const readiness = await readinessResponse.json().catch(() => ({}));
  if (!readinessResponse.ok) {
    throw new Error(readiness.error || "Inventory photo storage is not ready. Check the Blob environment variables and redeploy.");
  }

  const photoUrls: string[] = [];
  for (const [index, photo] of photos.entries()) {
    onProgress(index + 1, photos.length);
    const pathname = createInventoryPhotoPath(photo.name);
    const tokenResponse = await fetch("/api/inventory/upload", {
      credentials: "include",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          pathname,
          multipart: false,
          clientPayload: null,
        },
      }),
    });
    const tokenResult = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenResult.clientToken !== "string") {
      throw new Error(tokenResult.error || "Unable to authorize photo upload.");
    }
    const blob = await put(pathname, photo, {
      access: "public",
      contentType: photo.type,
      token: tokenResult.clientToken,
    });
    photoUrls.push(blob.url);
  }
  return photoUrls;
}

export default function AdminInventory({ onAuthChange }: { onAuthChange?: (authenticated: boolean) => void }) {
  const [loggedIn, setLoggedIn] = useState(false); const [password, setPassword] = useState(""); const [recoveryEmailInput, setRecoveryEmailInput] = useState(""); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [form, setForm] = useState(empty); const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null); const [editForms, setEditForms] = useState<Record<string, Record<string, string>>>({}); const [photos, setPhotos] = useState<File[]>([]); const [photoPreviews, setPhotoPreviews] = useState<string[]>([]); const [selectedPhotos, setSelectedPhotos] = useState<Record<string, string[]>>({}); const [message, setMessage] = useState(""); const [inventoryMessage, setInventoryMessage] = useState(""); const [preparingPhotos, setPreparingPhotos] = useState(false); const [submitting, setSubmitting] = useState(false); const [updatingVehicleId, setUpdatingVehicleId] = useState<string | null>(null); const [deletingPhotosVehicleId, setDeletingPhotosVehicleId] = useState<string | null>(null); const [recoveryToken, setRecoveryToken] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("recovery") || ""); const [recoveryPassword, setRecoveryPassword] = useState(""); const [recoveryMessage, setRecoveryMessage] = useState(""); const [recoverySent, setRecoverySent] = useState(false); const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const previewUrls = useRef<string[]>([]);
  const inventoryOperation = useRef(false);
  const recoveryOperation = useRef<{ token: string; password: string; operationId: string } | null>(null);
  const recoveryPending = useRef(false);
  useEffect(() => {
    const urls = previewUrls;
    return () => urls.current.forEach((preview) => URL.revokeObjectURL(preview));
  }, []);
  function clearPhotoSelection() {
    previewUrls.current.forEach((preview) => URL.revokeObjectURL(preview));
    previewUrls.current = [];
    setPhotos([]);
    setPhotoPreviews([]);
  }
  function removePhoto(index: number) {
    const preview = photoPreviews[index];
    if (preview) URL.revokeObjectURL(preview);
    previewUrls.current = previewUrls.current.filter((url) => url !== preview);
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
    setPhotoPreviews((current) => current.filter((_, photoIndex) => photoIndex !== index));
  }
  async function selectPhotos(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length || inventoryOperation.current) return;
    inventoryOperation.current = true;

    setPreparingPhotos(true);
    try {
      const selectionError = photoSelectionError(selected, photos.length);
      if (selectionError) { setMessage(selectionError); return; }
      setMessage("Optimizing photos…");
      const { compressed, savedPercent } = await preparePhotos(selected);
      const previews = compressed.map((file) => URL.createObjectURL(file));
      previewUrls.current.push(...previews);
      setPhotos((current) => [...current, ...compressed]);
      setPhotoPreviews((current) => [...current, ...previews]);
      setMessage(`${compressed.length} photo${compressed.length === 1 ? "" : "s"} added. Reduced by ${savedPercent}%.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to compress photos.");
    } finally {
      setPreparingPhotos(false);
      inventoryOperation.current = false;
    }
  }
  const load = async () => {
    const response = await fetch("/api/inventory", { credentials: "include", cache: "no-store" });
    if (response.ok) setVehicles(await response.json());
  };
  async function login(event: FormEvent) { event.preventDefault(); const response = await fetch("/api/admin/login", { credentials: "include", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }); if (response.ok) { setLoggedIn(true); onAuthChange?.(true); await load(); setMessage(""); } else { const result = await response.json().catch(() => ({})); setMessage(result.error || "Unable to sign in."); } }
  async function requestRecovery(event: FormEvent) { event.preventDefault(); setRecoveryMessage("Processing request…"); const response = await fetch("/api/admin/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: recoveryEmailInput }) }); const result = await response.json().catch(() => ({})); setRecoveryMessage(result.message || result.error || "Unable to request recovery."); if (response.ok) setRecoverySent(true); }
  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (recoveryPending.current || !recoveryToken || !recoveryPassword) return;
    const existing = recoveryOperation.current;
    const operation = existing?.token === recoveryToken && existing.password === recoveryPassword
      ? existing
      : { token: recoveryToken, password: recoveryPassword, operationId: crypto.randomUUID() };
    recoveryOperation.current = operation;
    recoveryPending.current = true;
    setRecoverySubmitting(true);
    setRecoveryMessage("Updating password…");
    try {
      const response = await fetch("/api/admin/recovery/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: operation.token, password: operation.password, operationId: operation.operationId }) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        recoveryOperation.current = null;
        setRecoveryToken("");
        setRecoveryPassword("");
        window.history.replaceState({}, "", "/admin");
        setRecoveryMessage("Password updated. You can now sign in.");
      } else if (response.status === 400 && /invalid or expired/i.test(result.error || "")) {
        setRecoveryMessage(result.error);
      } else if (response.status === 409) {
        setRecoveryMessage(result.error || "This recovery operation conflicts with an earlier attempt. Use the same password or restart deliberately.");
      } else if (response.status >= 500 || response.status === 429) {
        setRecoveryMessage("The result is uncertain. Retry this same password to reconcile the recovery attempt.");
      } else {
        setRecoveryMessage(result.error || "Unable to update password. Check the request and try again.");
      }
    } catch {
      setRecoveryMessage("The result is uncertain because the connection was lost. Retry this same password to reconcile the recovery attempt.");
    } finally {
      recoveryPending.current = false;
      setRecoverySubmitting(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inventoryOperation.current) return;
    inventoryOperation.current = true;
    setSubmitting(true);
    let uploadingPhotos = photos.length > 0;
    try {
      const photoUrls = await uploadPhotosSequentially(
        photos,
        (current, total) => setMessage(`Uploading photo ${current} of ${total}…`),
      );

      uploadingPhotos = false;
      setMessage("Saving listing…");
      const response = await fetch("/api/inventory", {
        credentials: "include",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicle: form, photos: photoUrls }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to save listing.");
      setVehicles((current) => [result, ...current]);
      setForm(empty);
      clearPhotoSelection();
      setMessage("Listing published.");
    } catch (error) {
      setMessage(uploadingPhotos
        ? `Unable to upload photos${error instanceof Error ? `: ${error.message}` : "."}`
        : error instanceof Error ? error.message : "Unable to save listing.");
    } finally {
      setSubmitting(false);
      inventoryOperation.current = false;
    }
  }
  async function addPhotosToVehicle(vehicle: Vehicle, files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length || inventoryOperation.current) return;
    inventoryOperation.current = true;

    setUpdatingVehicleId(vehicle.id);
    let stage: "compress" | "upload" | "save" = "compress";
    try {
      const selectionError = photoSelectionError(selected, vehicle.photos.length);
      if (selectionError) { setInventoryMessage(selectionError); return; }
      setInventoryMessage(`Optimizing ${selected.length} photo${selected.length === 1 ? "" : "s"} for ${vehicle.year} ${vehicle.make} ${vehicle.model}…`);
      const { compressed } = await preparePhotos(selected);
      stage = "upload";
      const photoUrls = await uploadPhotosSequentially(
        compressed,
        (current, total) => setInventoryMessage(`Uploading photo ${current} of ${total} for ${vehicle.year} ${vehicle.make} ${vehicle.model}…`),
      );

      stage = "save";
      setInventoryMessage("Updating listing…");
      const response = await fetch("/api/inventory", {
        credentials: "include",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: vehicle.id, photos: photoUrls }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to update listing.");
      setVehicles((current) => current.map((item) => item.id === vehicle.id ? result : item));
      setInventoryMessage(`${photoUrls.length} photo${photoUrls.length === 1 ? "" : "s"} added to ${vehicle.year} ${vehicle.make} ${vehicle.model}.`);
    } catch (error) {
      setInventoryMessage(stage === "upload"
        ? `Unable to upload photos${error instanceof Error ? `: ${error.message}` : "."}`
        : error instanceof Error ? error.message : "Unable to update listing.");
    } finally {
      setUpdatingVehicleId(null);
      inventoryOperation.current = false;
    }
  }
  function togglePhoto(vehicleId: string, photoUrl: string) {
    setSelectedPhotos((current) => {
      const selected = current[vehicleId] || [];
      const next = selected.includes(photoUrl)
        ? selected.filter((photo) => photo !== photoUrl)
        : [...selected, photoUrl];
      if (next.length === 0) {
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== vehicleId));
      }
      return { ...current, [vehicleId]: next };
    });
  }
  async function deleteSelectedPhotos(vehicle: Vehicle) {
    const photosToDelete = selectedPhotos[vehicle.id] || [];
    if (!photosToDelete.length || !confirm(`Delete ${photosToDelete.length} selected photo${photosToDelete.length === 1 ? "" : "s"} from this listing?`)) return;
    setDeletingPhotosVehicleId(vehicle.id);
    setInventoryMessage("Deleting selected photos…");
    try {
      const response = await fetch("/api/inventory", {
        credentials: "include",
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: vehicle.id, photos: photosToDelete }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to delete selected photos.");
      setVehicles((current) => current.map((item) => item.id === vehicle.id ? result : item));
      setSelectedPhotos((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== vehicle.id)));
      setInventoryMessage("Selected photos deleted.");
    } catch (error) {
      setInventoryMessage(error instanceof Error ? error.message : "Unable to delete selected photos.");
    } finally {
      setDeletingPhotosVehicleId(null);
    }
  }
  function startEditing(vehicle: Vehicle) {
    setEditingVehicleId(vehicle.id);
    setEditForms((current) => ({ ...current, [vehicle.id]: { year: String(vehicle.year), make: vehicle.make, model: vehicle.model, price: String(vehicle.price), mileage: String(vehicle.mileage), condition: vehicle.condition, status: vehicle.status, description: vehicle.description } }));
  }
  function updateEditField(vehicleId: string, field: string, value: string) {
    setEditForms((current) => ({ ...current, [vehicleId]: { ...(current[vehicleId] || {}), [field]: value } }));
  }
  async function saveVehicle(vehicle: Vehicle) {
    const editForm = editForms[vehicle.id];
    if (!editForm || inventoryOperation.current) return;
    inventoryOperation.current = true;
    setUpdatingVehicleId(vehicle.id);
    setInventoryMessage(`Saving ${vehicle.year} ${vehicle.make} ${vehicle.model}…`);
    try {
      const response = await fetch("/api/inventory", { credentials: "include", method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: vehicle.id, ...editForm, createdAt: vehicle.createdAt }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to update listing.");
      setVehicles((current) => current.map((item) => item.id === vehicle.id ? result : item));
      setEditingVehicleId(null);
      setInventoryMessage("Listing updated.");
    } catch (error) {
      setInventoryMessage(error instanceof Error ? error.message : "Unable to update listing.");
    } finally {
      setUpdatingVehicleId(null);
      inventoryOperation.current = false;
    }
  }
  function cancelEditing(vehicleId: string) {
    setEditingVehicleId(null);
    setEditForms((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== vehicleId)));
  }
  async function remove(id: string) {
    if (!confirm("Remove this vehicle from inventory?")) return;
    setInventoryMessage("Removing listing…");
    const response = await fetch("/api/inventory", {
      credentials: "include",
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setInventoryMessage(result.error || "Unable to remove listing.");
      return;
    }
    setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
    setInventoryMessage("Listing removed.");
  }
  const inventoryBusy = preparingPhotos || submitting || updatingVehicleId !== null;
  if (!loggedIn) return <main className="admin-shell"><div className="admin-card admin-login"><p className="eyebrow">SpeedZone Motorsports</p><h1>Inventory admin</h1><p>Sign in to manage current vehicle listings.</p>{recoveryToken ? <form onSubmit={resetPassword}><label>New password<input type="password" minLength={12} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required autoFocus /></label><button className="button button-primary" type="submit" disabled={recoverySubmitting}>Set new password</button><p>Use at least 12 characters.</p></form> : <><form onSubmit={login}><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></label><button className="button button-primary" type="submit">Sign in</button></form><form onSubmit={requestRecovery}><label>Admin email<input type="email" value={recoveryEmailInput} onChange={(event) => setRecoveryEmailInput(event.target.value)} required autoComplete="email" /></label><button className="button button-secondary" type="submit" disabled={recoverySent}>{recoverySent ? "Request processed" : "Forgot password?"}</button><p>Enter the email address associated with this admin account. For security, the response will be the same whether the address is eligible or not.</p></form></>}<AdminPasskey authenticated={false} onAuthenticated={() => { setLoggedIn(true); onAuthChange?.(true); void load(); }} /><p role="status" className="form-message">{message || recoveryMessage}</p></div></main>;
  return (
    <main className="admin-shell">
      <div className="admin-heading">
        <div><p className="eyebrow">SpeedZone Motorsports</p><h1>Inventory admin</h1></div>
        <button className="button button-secondary" onClick={async () => { await fetch("/api/admin/login", { credentials: "include", method: "DELETE" }); setLoggedIn(false); onAuthChange?.(false); }}>Sign out</button>
      </div>
      {photoPreviews.length > 0 && (
        <section className="photo-selection admin-card">
          <div className="photo-selection-heading">
            <div><h2>Selected photos</h2><p>{photoPreviews.length} photo{photoPreviews.length === 1 ? "" : "s"} ready for this listing.</p></div>
            <button type="button" className="button button-secondary" disabled={inventoryBusy} onClick={() => document.getElementById("inventory-photo-picker")?.click()}>Add more photos</button>
          </div>
          <div className="photo-selection-grid">
            {photoPreviews.map((preview, index) => (
              <div className="photo-selection-item" key={`${preview}-${index}`}>
                <img src={preview} alt={`Selected vehicle photo ${index + 1}`} />
                <button type="button" className="text-button" disabled={inventoryBusy} onClick={() => removePhoto(index)}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      )}
      <AdminPasskey authenticated={true} />
      <section className="admin-grid">
        <div className="admin-card">
          <h2>Add vehicle</h2>
          <form onSubmit={submit} className="vehicle-form">
            <div className="form-row">
              <label>Year<input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} required /></label>
              <label>Make<input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} required /></label>
              <label>Model<input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></label>
            </div>
            <div className="form-row">
              <label>Price<input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
              <label>Mileage<input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} required /></label>
              <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="available">Available</option><option value="pending">Pending</option><option value="sold">Sold</option></select></label>
            </div>
            <label>Condition<input value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} /></label>
            <label>Description<textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>
              Photos
              <input id="inventory-photo-picker" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple disabled={inventoryBusy} onChange={(e) => { void selectPhotos(e.target.files); e.currentTarget.value = ""; }} />
              <span className="field-help">Select one or several JPG, PNG, or WebP photos. They are resized, optimized, and uploaded one at a time. Keep each original under 8MB.</span>
            </label>
            {photos.length > 0 && (
              <div className="photo-selection" aria-live="polite">
                <p>{photos.length} photo{photos.length === 1 ? "" : "s"} selected</p>
                <div className="photo-selection-grid">{photoPreviews.map((preview, index) => <img key={`${`Selected photo ${index + 1}`}-${index}`} src={preview} alt={`Selected photo ${index + 1}`} />)}</div>
              </div>
            )}
            <button className="button button-primary" type="submit" disabled={inventoryBusy}>{submitting ? "Publishing…" : "Publish vehicle"}</button>
            <p role="status" className="form-message">{message}</p>
          </form>
        </div>
        <div>
          <h2>Published listings <span className="count">{vehicles.length}</span></h2>
          <p role="status" className="form-message">{inventoryMessage}</p>
          <div className="admin-list">
            {vehicles.map((vehicle) => {
              const atPhotoLimit = vehicle.photos.length >= maxInventoryPhotoCount;
              const updatingThisVehicle = updatingVehicleId === vehicle.id;
              const photoPickerId = `inventory-photo-picker-${vehicle.id}`;
              return (
                <article className="admin-listing" key={vehicle.id}>
                  <div>
                    {vehicle.photos[0] && <img src={vehicle.photos[0]} alt="" />}
                    <div>
                      <strong>{vehicle.year} {vehicle.make} {vehicle.model}</strong>
                      <span>{vehicle.status} · ${vehicle.price.toLocaleString()} · {vehicle.photos.length} photo{vehicle.photos.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {editingVehicleId === vehicle.id && editForms[vehicle.id] && (
                    <div className="admin-edit-form" aria-label={`Edit ${vehicle.year} ${vehicle.make} ${vehicle.model}`}>
                      <div className="form-row">
                        {(["year", "make", "model"] as const).map((field) => <label key={field}>{field.slice(0, 1).toUpperCase() + field.slice(1)}<input type={field === "year" ? "number" : "text"} value={editForms[vehicle.id]?.[field] || ""} onChange={(event) => updateEditField(vehicle.id, field, event.target.value)} required /></label>)}
                      </div>
                      <div className="form-row">
                        <label>Price<input type="number" min="0" value={editForms[vehicle.id]?.price || ""} onChange={(event) => updateEditField(vehicle.id, "price", event.target.value)} required /></label>
                        <label>Mileage<input type="number" min="0" value={editForms[vehicle.id]?.mileage || ""} onChange={(event) => updateEditField(vehicle.id, "mileage", event.target.value)} required /></label>
                        <label>Status<select value={editForms[vehicle.id]?.status || "available"} onChange={(event) => updateEditField(vehicle.id, "status", event.target.value)}><option value="available">Available</option><option value="pending">Pending</option><option value="sold">Sold</option></select></label>
                      </div>
                      <label>Condition<input value={editForms[vehicle.id]?.condition || ""} onChange={(event) => updateEditField(vehicle.id, "condition", event.target.value)} /></label>
                      <label>Description<textarea rows={4} value={editForms[vehicle.id]?.description || ""} onChange={(event) => updateEditField(vehicle.id, "description", event.target.value)} /></label>
                      <div className="admin-listing-actions"><button type="button" className="button button-primary" disabled={updatingThisVehicle} onClick={() => void saveVehicle(vehicle)}>{updatingThisVehicle ? "Saving…" : "Save changes"}</button><button type="button" className="button button-secondary" disabled={updatingThisVehicle} onClick={() => cancelEditing(vehicle.id)}>Cancel</button></div>
                    </div>
                  )}
                  {vehicle.photos.length > 0 && (
                    <div className="admin-photo-management">
                      <p>Select uploaded photos to remove from this listing.</p>
                      <div className="admin-photo-grid">
                        {vehicle.photos.map((photo, index) => {
                          const selected = (selectedPhotos[vehicle.id] || []).includes(photo);
                          return (
                            <label className={`admin-photo-option${selected ? " is-selected" : ""}`} key={photo}>
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={inventoryBusy || deletingPhotosVehicleId === vehicle.id}
                                onChange={() => togglePhoto(vehicle.id, photo)}
                                aria-label={`Select photo ${index + 1} for ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                              />
                              <img src={photo} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}, photo ${index + 1}`} />
                            </label>
                          );
                        })}
                      </div>
                      {(selectedPhotos[vehicle.id] || []).length > 0 && (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={inventoryBusy || deletingPhotosVehicleId === vehicle.id}
                          onClick={() => void deleteSelectedPhotos(vehicle)}
                        >
                          {deletingPhotosVehicleId === vehicle.id ? "Deleting…" : `Delete selected photos (${(selectedPhotos[vehicle.id] || []).length})`}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="admin-listing-actions">
                    {editingVehicleId !== vehicle.id && <button type="button" className="button button-secondary" disabled={inventoryBusy} onClick={() => startEditing(vehicle)}>Edit listing</button>}
                    <button
                      type="button"
                      className="button button-secondary admin-upload-button"
                      disabled={inventoryBusy || atPhotoLimit}
                      aria-label={`Add photos to ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      onClick={() => document.getElementById(photoPickerId)?.click()}
                    >
                      {atPhotoLimit ? "Photo limit reached" : updatingThisVehicle ? "Uploading…" : "Add photos"}
                    </button>
                    <input
                      id={photoPickerId}
                      className="visually-hidden"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      multiple
                      tabIndex={-1}
                      disabled={inventoryBusy || atPhotoLimit}
                      aria-label={`Select photos for ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      onChange={(event) => { void addPhotosToVehicle(vehicle, event.target.files); event.currentTarget.value = ""; }}
                    />
                    <button type="button" className="text-button" disabled={inventoryBusy} onClick={() => remove(vehicle.id)}>Remove</button>
                  </div>
                </article>
              );
            })}
            {vehicles.length === 0 && <p className="muted">No vehicles published yet.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

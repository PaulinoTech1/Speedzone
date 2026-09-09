"use client";
/* eslint-disable @next/next/no-img-element */
import { FormEvent, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
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
  if (selected.some((file) => !inventoryPhotoContentTypes.includes(file.type))) return "Use JPG, PNG, or WebP photos. HEIC files need to be converted before uploading.";
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
  const photoUrls: string[] = [];
  for (const [index, photo] of photos.entries()) {
    onProgress(index + 1, photos.length);
    const blob = await upload(createInventoryPhotoPath(photo.name), photo, {
      access: "public",
      contentType: photo.type,
      handleUploadUrl: "/api/inventory/upload",
    });
    photoUrls.push(blob.url);
  }
  return photoUrls;
}

export default function AdminInventory({ onAuthChange }: { onAuthChange?: (authenticated: boolean) => void }) {
  const [loggedIn, setLoggedIn] = useState(false); const [password, setPassword] = useState(""); const [recoveryEmailInput, setRecoveryEmailInput] = useState(""); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [form, setForm] = useState(empty); const [photos, setPhotos] = useState<File[]>([]); const [photoPreviews, setPhotoPreviews] = useState<string[]>([]); const [message, setMessage] = useState(""); const [inventoryMessage, setInventoryMessage] = useState(""); const [preparingPhotos, setPreparingPhotos] = useState(false); const [submitting, setSubmitting] = useState(false); const [updatingVehicleId, setUpdatingVehicleId] = useState<string | null>(null); const [recoveryToken, setRecoveryToken] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("recovery") || ""); const [recoveryPassword, setRecoveryPassword] = useState(""); const [recoveryMessage, setRecoveryMessage] = useState(""); const [recoverySent, setRecoverySent] = useState(false);
  const previewUrls = useRef<string[]>([]);
  const inventoryOperation = useRef(false);
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
  async function resetPassword(event: FormEvent) { event.preventDefault(); setRecoveryMessage("Updating password…"); const response = await fetch("/api/admin/recovery/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: recoveryToken, password: recoveryPassword }) }); const result = await response.json().catch(() => ({})); setRecoveryMessage(response.ok ? "Password updated. You can now sign in." : result.error || "Unable to update password."); if (response.ok) { setRecoveryToken(""); setRecoveryPassword(""); window.history.replaceState({}, "", "/admin"); } }
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
  if (!loggedIn) return <main className="admin-shell"><div className="admin-card admin-login"><p className="eyebrow">SpeedZone Motorsports</p><h1>Inventory admin</h1><p>Sign in to manage current vehicle listings.</p>{recoveryToken ? <form onSubmit={resetPassword}><label>New password<input type="password" minLength={12} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required autoFocus /></label><button className="button button-primary" type="submit">Set new password</button><p>Use at least 12 characters.</p></form> : <><form onSubmit={login}><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></label><button className="button button-primary" type="submit">Sign in</button></form><form onSubmit={requestRecovery}><label>Admin email<input type="email" value={recoveryEmailInput} onChange={(event) => setRecoveryEmailInput(event.target.value)} required autoComplete="email" /></label><button className="button button-secondary" type="submit" disabled={recoverySent}>{recoverySent ? "Request processed" : "Forgot password?"}</button><p>Enter the email address associated with this admin account. For security, the response will be the same whether the address is eligible or not.</p></form></>}<AdminPasskey authenticated={false} onAuthenticated={() => { setLoggedIn(true); onAuthChange?.(true); void load(); }} /><p role="status" className="form-message">{message || recoveryMessage}</p></div></main>;
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
                  <div className="admin-listing-actions">
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

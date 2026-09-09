"use client";
/* eslint-disable @next/next/no-img-element */
import { FormEvent, useEffect, useState } from "react";
import type { Vehicle } from "@/lib/inventory";
import AdminPasskey from "@/components/admin/AdminPasskey";

const empty = { year: "", make: "", model: "", price: "", mileage: "", condition: "Used", status: "available", description: "" };
const supportedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const maxPhotoSize = 8 * 1024 * 1024;
const maxPhotoDimension = 2400;
const webpQuality = 0.82;

async function compressPhoto(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
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
    return new File([blob], `${file.name.replace(/\\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function AdminInventory({ onAuthChange }: { onAuthChange?: (authenticated: boolean) => void }) {
  const [loggedIn, setLoggedIn] = useState(false); const [password, setPassword] = useState(""); const [recoveryEmailInput, setRecoveryEmailInput] = useState(""); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [form, setForm] = useState(empty); const [photos, setPhotos] = useState<File[]>([]); const [photoPreviews, setPhotoPreviews] = useState<string[]>([]); const [message, setMessage] = useState(""); const [recoveryToken, setRecoveryToken] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("recovery") || ""); const [recoveryPassword, setRecoveryPassword] = useState(""); const [recoveryMessage, setRecoveryMessage] = useState(""); const [recoverySent, setRecoverySent] = useState(false);
  useEffect(() => () => photoPreviews.forEach((preview) => URL.revokeObjectURL(preview)), [photoPreviews]);
  async function selectPhotos(files: FileList | null) {
    const selected = Array.from(files || []);
    if (selected.some((file) => !supportedPhotoTypes.includes(file.type))) { setMessage("Use JPG, PNG, or WebP photos. HEIC files need to be converted before uploading."); return; }
    if (selected.some((file) => file.size > maxPhotoSize)) { setMessage("Each photo must be under 8MB before compression."); return; }

    setMessage("Compressing photos to WebP…");
    try {
      const compressed = await Promise.all(selected.map(compressPhoto));
      const originalBytes = selected.reduce((total, file) => total + file.size, 0);
      const compressedBytes = compressed.reduce((total, file) => total + file.size, 0);
      const savedPercent = originalBytes ? Math.max(0, Math.round((1 - compressedBytes / originalBytes) * 100)) : 0;
      setPhotos(compressed);
      setPhotoPreviews(compressed.map((file) => URL.createObjectURL(file)));
      setMessage(`${compressed.length} WebP photo${compressed.length === 1 ? "" : "s"} ready. Reduced by ${savedPercent}%.`);
    } catch (error) {
      setPhotos([]);
      setPhotoPreviews([]);
      setMessage(error instanceof Error ? error.message : "Unable to compress photos.");
    }
  }
  const load = async () => { const response = await fetch("/api/inventory", { credentials: "include" }); if (response.ok) setVehicles(await response.json()); };
  async function login(event: FormEvent) { event.preventDefault(); const response = await fetch("/api/admin/login", { credentials: "include", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }); if (response.ok) { setLoggedIn(true); onAuthChange?.(true); await load(); setMessage(""); } else { const result = await response.json().catch(() => ({})); setMessage(result.error || "Unable to sign in."); } }
  async function requestRecovery(event: FormEvent) { event.preventDefault(); setRecoveryMessage("Processing request…"); const response = await fetch("/api/admin/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: recoveryEmailInput }) }); const result = await response.json().catch(() => ({})); setRecoveryMessage(result.message || result.error || "Unable to request recovery."); if (response.ok) setRecoverySent(true); }
  async function resetPassword(event: FormEvent) { event.preventDefault(); setRecoveryMessage("Updating password…"); const response = await fetch("/api/admin/recovery/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: recoveryToken, password: recoveryPassword }) }); const result = await response.json().catch(() => ({})); setRecoveryMessage(response.ok ? "Password updated. You can now sign in." : result.error || "Unable to update password."); if (response.ok) { setRecoveryToken(""); setRecoveryPassword(""); window.history.replaceState({}, "", "/admin"); } }
  async function submit(event: FormEvent) { event.preventDefault(); setMessage("Saving listing…"); const data = new FormData(); data.set("vehicle", JSON.stringify(form)); photos.forEach((file) => data.append("photos", file)); const response = await fetch("/api/inventory", { credentials: "include", method: "POST", body: data }); const result = await response.json(); if (!response.ok) return setMessage(result.error || "Unable to save listing."); setVehicles((current) => [result, ...current]); setForm(empty); setPhotos([]); setMessage("Listing published."); }
  async function remove(id: string) { if (!confirm("Remove this vehicle from inventory?")) return; await fetch("/api/inventory", { credentials: "include", method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); setVehicles((current) => current.filter((vehicle) => vehicle.id !== id)); }
  if (!loggedIn) return <main className="admin-shell"><div className="admin-card admin-login"><p className="eyebrow">SpeedZone Motorsports</p><h1>Inventory admin</h1><p>Sign in to manage current vehicle listings.</p>{recoveryToken ? <form onSubmit={resetPassword}><label>New password<input type="password" minLength={12} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required autoFocus /></label><button className="button button-primary" type="submit">Set new password</button><p>Use at least 12 characters.</p></form> : <><form onSubmit={login}><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></label><button className="button button-primary" type="submit">Sign in</button></form><form onSubmit={requestRecovery}><label>Admin email<input type="email" value={recoveryEmailInput} onChange={(event) => setRecoveryEmailInput(event.target.value)} required autoComplete="email" /></label><button className="button button-secondary" type="submit" disabled={recoverySent}>{recoverySent ? "Request processed" : "Forgot password?"}</button><p>Enter the email address associated with this admin account. For security, the response will be the same whether the address is eligible or not.</p></form></>}<AdminPasskey authenticated={false} onAuthenticated={() => { setLoggedIn(true); onAuthChange?.(true); void load(); }} /><p role="status" className="form-message">{message || recoveryMessage}</p></div></main>;
  return <main className="admin-shell"><div className="admin-heading"><div><p className="eyebrow">SpeedZone Motorsports</p><h1>Inventory admin</h1></div><button className="button button-secondary" onClick={async () => { await fetch("/api/admin/login", { credentials: "include", method: "DELETE" }); setLoggedIn(false); onAuthChange?.(false); }}>Sign out</button></div><AdminPasskey authenticated={true} /><section className="admin-grid"><div className="admin-card"><h2>Add vehicle</h2><form onSubmit={submit} className="vehicle-form"><div className="form-row"><label>Year<input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} required /></label><label>Make<input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} required /></label><label>Model<input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></label></div><div className="form-row"><label>Price<input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label><label>Mileage<input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} required /></label><label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="available">Available</option><option value="pending">Pending</option><option value="sold">Sold</option></select></label></div><label>Condition<input value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} /></label><label>Description<textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><label>Photos<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={(e) => selectPhotos(e.target.files)} /><span className="field-help">Photos are automatically resized and converted to WebP before upload. Keep each original under 8MB for faster processing.</span></label>{photos.length > 0 && <div className="photo-selection" aria-live="polite"><p>{photos.length} photo{photos.length === 1 ? "" : "s"} selected</p><div className="photo-selection-grid">{photoPreviews.map((preview, index) => <img key={`${`Selected photo ${index + 1}`}-${index}`} src={preview} alt={`Selected photo ${index + 1}`} />)}</div></div>}<button className="button button-primary" type="submit">Publish vehicle</button><p role="status" className="form-message">{message}</p></form></div><div><h2>Published listings <span className="count">{vehicles.length}</span></h2><div className="admin-list">{vehicles.map((vehicle) => <article className="admin-listing" key={vehicle.id}><div>{vehicle.photos[0] && <img src={vehicle.photos[0]} alt="" />}<div><strong>{vehicle.year} {vehicle.make} {vehicle.model}</strong><span>{vehicle.status} · ${vehicle.price.toLocaleString()}</span></div></div><button className="text-button" onClick={() => remove(vehicle.id)}>Remove</button></article>)}{vehicles.length === 0 && <p className="muted">No vehicles published yet.</p>}</div></div></section></main>;
}

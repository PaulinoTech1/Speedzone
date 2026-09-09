"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";

const maxDimension = 1600;
const jpegQuality = 0.78;

type OptimizedPhoto = {
  id: string;
  originalName: string;
  originalSize: number;
  file: File;
  previewUrl: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function optimizePhoto(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      image.src = sourceUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`Unable to optimize ${file.name}.`);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", jpegQuality));
    if (!blob) throw new Error(`Unable to create a JPEG for ${file.name}.`);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "vehicle-photo";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function InventoryPhotoOptimizer() {
  const [photos, setPhotos] = useState<OptimizedPhoto[]>([]);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const previewUrls = useRef<string[]>([]);

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function handleSelection(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length || processing) return;
    setProcessing(true);
    setMessage(`Optimizing ${selected.length} photo${selected.length === 1 ? "" : "s"}…`);
    try {
      const optimized = await Promise.all(selected.map(async (file) => {
        const output = await optimizePhoto(file);
        const previewUrl = URL.createObjectURL(output);
        previewUrls.current.push(previewUrl);
        return { id: `${file.name}-${file.lastModified}-${Math.random()}`, originalName: file.name, originalSize: file.size, file: output, previewUrl };
      }));
      setPhotos((current) => [...current, ...optimized]);
      const saved = optimized.reduce((total, photo) => total + photo.originalSize - photo.file.size, 0);
      setMessage(`${optimized.length} photo${optimized.length === 1 ? "" : "s"} ready. Saved ${formatBytes(Math.max(0, saved))}. Nothing was uploaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to optimize photos.");
    } finally {
      setProcessing(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
  }

  function clearPhotos() {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
    setPhotos([]);
    setMessage("");
  }

  return (
    <section className="admin-card inventory-photo-optimizer">
      <div className="photo-selection-heading">
        <div>
          <p className="eyebrow">Separate tool</p>
          <h2>Mobile photo optimizer</h2>
          <p>Convert copies to JPEG, sized for fast mobile inventory browsing. This tool never uploads or changes listing photos.</p>
        </div>
        <label className="button button-secondary optimizer-picker">
          {processing ? "Optimizing…" : "Choose photos"}
          <input type="file" accept="image/*" multiple disabled={processing} onChange={(event) => { void handleSelection(event.target.files); event.currentTarget.value = ""; }} />
        </label>
      </div>
      {photos.length > 0 && (
        <>
          <div className="optimizer-actions">
            <span>{photos.length} optimized</span>
            <button type="button" className="button button-secondary" onClick={clearPhotos}>Clear all</button>
          </div>
          <div className="optimizer-grid">
            {photos.map((photo) => (
              <article className="optimizer-item" key={photo.id}>
                <img src={photo.previewUrl} alt={`Optimized ${photo.originalName}`} />
                <strong>{photo.file.name}</strong>
                <span>{formatBytes(photo.originalSize)} → {formatBytes(photo.file.size)}</span>
                <div className="optimizer-item-actions">
                  <a className="button button-primary" href={photo.previewUrl} download={photo.file.name}>Download JPEG</a>
                  <button type="button" className="text-button" onClick={() => removePhoto(photo.id)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <p role="status" className="form-message">{message}</p>
    </section>
  );
}

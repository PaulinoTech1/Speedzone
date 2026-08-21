"use client";

const acceptedInputTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProcessedPhoto = {
  file: File;
  width: number;
  height: number;
};

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolvePromise, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolvePromise(blob) : reject(new Error("This browser could not encode WebP"))),
      "image/webp",
      0.84,
    );
  });
}

function validWebPMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

export async function processVehiclePhoto(
  source: File,
  maximumDimension = 1600,
  maximumBytes = 4 * 1024 * 1024,
): Promise<ProcessedPhoto> {
  if (!acceptedInputTypes.has(source.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP photograph");
  }
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("The photograph has invalid dimensions");
    const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot process the photograph");
    context.drawImage(bitmap, 0, 0, width, height);
    // Drawing decoded pixels to a new canvas intentionally drops EXIF,
    // including embedded GPS data, before a new WebP file is created.
    const blob = await canvasBlob(canvas);
    if (blob.size > maximumBytes) throw new Error("The compressed photograph is still too large");
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (blob.type !== "image/webp" || !validWebPMagic(header)) {
      throw new Error("The browser did not produce a valid WebP photograph");
    }
    const baseName = source.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "vehicle";
    return {
      file: new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: Date.now() }),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

export const inventoryPhotoContentTypes = ["image/jpeg", "image/png", "image/webp"];
export const maxInventoryPhotoSize = 8 * 1024 * 1024;
export const maxInventoryPhotoCount = 24;

const inventoryPhotoPrefix = "inventory/photos/";
const publicBlobHostSuffix = ".public.blob.vercel-storage.com";

export function createInventoryPhotoPath(fileName: string) {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "") || "vehicle-photo.webp";
  return `${inventoryPhotoPrefix}${crypto.randomUUID()}-${safeFileName}`;
}

export function isInventoryPhotoPath(pathname: string) {
  return (
    pathname.startsWith(inventoryPhotoPrefix) &&
    pathname.length > inventoryPhotoPrefix.length &&
    pathname.length <= 300 &&
    !pathname.includes("..")
  );
}

export function isInventoryPhotoUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(publicBlobHostSuffix) &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      isInventoryPhotoPath(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

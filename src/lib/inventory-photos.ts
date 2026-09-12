export const inventoryPhotoContentTypes = ["image/jpeg", "image/png", "image/webp"];
export const maxInventoryPhotoSize = 8 * 1024 * 1024;
export const maxInventoryPhotoCount = 24;

const inventoryPhotoPrefix = "inventory/photos/";
const publicBlobHostSuffix = ".public.blob.vercel-storage.com";

export function getInventoryBlobOrigin() {
  const configuredOrigin = process.env.INVENTORY_BLOB_ORIGIN;
  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname)
      ) return url.origin;
    } catch {
      return null;
    }
  }

  const storeId = process.env.BLOB_STORE_ID?.trim().replace(/^store_/, "");
  return storeId && /^[a-z0-9-]+$/i.test(storeId)
    ? `https://${storeId}.public.blob.vercel-storage.com`
    : null;
}

export function createInventoryPhotoPath(fileName: string) {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "") || "vehicle-photo.webp";
  return `${inventoryPhotoPrefix}${crypto.randomUUID()}-${safeFileName}`;
}

export function isInventoryPhotoPath(pathname: string) {
  if (
    !pathname.startsWith(inventoryPhotoPrefix) ||
    pathname.length <= inventoryPhotoPrefix.length ||
    pathname.length > 300 ||
    /[\\\u0000-\u001f\u007f]/.test(pathname)
  ) return false;

  try {
    const decoded = decodeURIComponent(pathname);
    return (
      decoded === pathname &&
      !decoded.includes("..") &&
      !decoded.includes("\\")
    );
  } catch {
    return false;
  }
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
      url.search === "" &&
      url.hash === "" &&
      isInventoryPhotoPath(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

export function isInventoryPhotoBlobOriginUrl(value: string) {
  const configuredOrigin = getInventoryBlobOrigin();
  if (!configuredOrigin || !isInventoryPhotoUrl(value)) return false;

  try {
    return new URL(value).origin === configuredOrigin;
  } catch {
    return false;
  }
}

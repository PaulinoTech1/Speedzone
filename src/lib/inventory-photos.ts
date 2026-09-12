export const inventoryPhotoContentTypes = ["image/jpeg", "image/png", "image/webp"];
export const maxInventoryPhotoSize = 8 * 1024 * 1024;
export const maxInventoryPhotoCount = 24;

const inventoryPhotoPrefix = "inventory/photos/";
const publicBlobHostSuffix = ".public.blob.vercel-storage.com";

function storeIdFromReadWriteToken(token: string | undefined) {
  // Read-write tokens are formatted as `vercel_blob_rw_<storeId>_<secret>`.
  // The storeId segment is the authoritative source for the store's public
  // hostname — it can drift out of sync with a separately-set BLOB_STORE_ID
  // env var after the integration is reconnected or the store is rotated.
  const parts = token?.trim().split("_");
  const storeId = parts && parts.length >= 5 && parts[0] === "vercel" && parts[1] === "blob" && parts[2] === "rw"
    ? parts[3]
    : undefined;
  return storeId && /^[a-z0-9-]+$/i.test(storeId) ? storeId : null;
}

export function getInventoryBlobOrigin() {
  // The upload token controls the store that Blob actually writes to. Prefer
  // its embedded store id so a stale INVENTORY_BLOB_ORIGIN cannot reject a
  // valid upload after the Blob store or token has been rotated.
  const tokenStoreId = storeIdFromReadWriteToken(process.env.BLOB_READ_WRITE_TOKEN);
  if (tokenStoreId) return `https://${tokenStoreId}.public.blob.vercel-storage.com`;

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

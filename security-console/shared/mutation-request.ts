export function validMutationOrigin(request: Request, allowedOrigins: string[]) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return !!origin && allowedOrigins.includes(origin) && origin === new URL(request.url).origin
    && (!site || site === "same-origin");
}

export class RequestBodyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readBoundedJson(request: Request, limit = 64 * 1024): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new RequestBodyError(415, "JSON request required");
  }
  const length = Number(request.headers.get("content-length"));
  if (length > limit) throw new RequestBodyError(413, "Request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, "Invalid request");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new RequestBodyError(408, "Request timed out")); }, 5000);
  });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new RequestBodyError(413, "Request is too large"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "Invalid JSON request");
  } finally { clearTimeout(timer); }
}

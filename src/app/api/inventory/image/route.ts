import { NextRequest, NextResponse } from "next/server";

const allowedBlobHost = ".public.blob.vercel-storage.com";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return new NextResponse("Missing image URL", { status: 400 });

  let imageUrl: URL;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return new NextResponse("Invalid image URL", { status: 400 });
  }

  if (imageUrl.protocol !== "https:" || !imageUrl.hostname.endsWith(allowedBlobHost)) {
    return new NextResponse("Image host not allowed", { status: 403 });
  }

  const response = await fetch(imageUrl, { next: { revalidate: 300 } });
  if (!response.ok || !response.body) {
    return new NextResponse("Image unavailable", { status: 404 });
  }

  return new NextResponse(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") || "image/*",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

describe("proxy content security policy", () => {
  it("allows local blob image previews and Vercel Blob uploads", () => {
    const response = proxy(
      new NextRequest("https://speedzone.example/admin"),
    );
    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).not.toBeNull();

    const directives = csp!.split("; ");
    const imageSources = directives.find((value) =>
      value.startsWith("img-src "),
    );
    const connectionSources = directives.find((value) =>
      value.startsWith("connect-src "),
    );

    expect(imageSources?.split(" ")).toContain("blob:");
    expect(connectionSources?.split(" ")).toContain("https://vercel.com");
  });
});

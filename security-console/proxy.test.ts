import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
describe("console route boundary",()=>{
  it("does not accept the inventory admin cookie",()=>{const request=new NextRequest("https://logs.speedzonems.com/",{headers:{cookie:"speedzone_admin=fake"}});expect(proxy(request).headers.get("location")).toBe("https://logs.speedzonems.com/login")});
  it("allows the console cookie through the optimistic guard",()=>{const request=new NextRequest("https://logs.speedzonems.com/",{headers:{cookie:"__Host-speedzone_security=fake"}});expect(proxy(request).headers.get("location")).toBeNull()});
});
describe("standalone security headers",()=>{
  it("sets a nonce CSP without unsafe-inline scripts on console pages",()=>{
    const response=proxy(new NextRequest("https://console.example/login"));
    const csp=response.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[0-9a-f]{32}' 'strict-dynamic'/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it("uses a fresh nonce per request",()=>{
    const a=proxy(new NextRequest("https://console.example/login")).headers.get("content-security-policy");
    const b=proxy(new NextRequest("https://console.example/login")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });
});

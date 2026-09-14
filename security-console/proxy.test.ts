import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
describe("console route boundary",()=>{
  it("does not accept the inventory admin cookie",()=>{const request=new NextRequest("https://logs.speedzonems.com/",{headers:{cookie:"speedzone_admin=fake"}});expect(proxy(request).headers.get("location")).toBe("https://logs.speedzonems.com/login")});
  it("allows the console cookie through the optimistic guard",()=>{const request=new NextRequest("https://logs.speedzonems.com/",{headers:{cookie:"__Host-speedzone_security=fake"}});expect(proxy(request).headers.get("location")).toBeNull()});
});

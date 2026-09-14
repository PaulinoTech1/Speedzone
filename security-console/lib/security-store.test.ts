import { describe, expect, it } from "vitest";
import { isSecurityEvent, parseProviderEvents } from "@/lib/security-store";

const event={id:"56dd8be6-9ba3-4e35-9b4c-153feb510c40",occurredAt:"2026-09-13T12:00:00.000Z",event:"admin.login",outcome:"allowed",actor:"admin",route:"/api/admin/login",requestId:"req_12345678",hash:"a".repeat(64)};
describe("provider event parsing",()=>{
  it("unwraps Axiom legacy matches and rejects malformed rows",()=>{expect(parseProviderEvents({matches:[{data:event},{data:{id:"bad"}}]})).toEqual([event])});
  it("requires the safe event envelope",()=>{expect(isSecurityEvent({...event,hash:undefined})).toBe(false)});
});

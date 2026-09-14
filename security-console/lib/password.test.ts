import { describe, expect, it } from "vitest";
import { validPassword } from "@/lib/password";
describe("security password policy",()=>{
  it("requires length and mixed character classes",()=>{expect(validPassword("weak-password")).toBe(false);expect(validPassword("Correct-Horse-42!Battery")).toBe(true)});
});

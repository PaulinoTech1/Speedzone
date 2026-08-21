import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  administratorIdentifierSchema,
  administratorPasswordSchema,
  newAdministratorPasswordSchema,
  passwordAuthenticationBodySchema,
  unicodeCodePointLength,
  utf8ByteLength,
} from "@/lib/domain/auth";

describe("administrator login schemas", () => {
  it("canonicalizes usernames and email addresses consistently", () => {
    expect(administratorIdentifierSchema.parse("  AdMiN.User_Name-1  ")).toBe(
      "admin.user_name-1",
    );
    expect(administratorIdentifierSchema.parse("  ＡＤＭＩＮ  ")).toBe("admin");
    expect(administratorIdentifierSchema.parse("  Admin.User+Ops@Example.COM  ")).toBe(
      "admin.user+ops@example.com",
    );
  });

  it.each([
    ["too short", "ab"],
    ["invalid username character", "admin/name"],
    ["invalid email", "admin@@example.com"],
    ["too long", "a".repeat(255)],
  ])("rejects an identifier with %s", (_name, value) => {
    expect(administratorIdentifierSchema.safeParse(value).success).toBe(false);
  });

  it("does not transform special, Unicode, or space-containing passwords", () => {
    const password = `  d'Artagnan said "<keep-this>" — 密碼 😀  `;
    expect(administratorPasswordSchema.parse(password)).toBe(password);
    expect(passwordAuthenticationBodySchema.parse({
      adminId: " ADMINISTRATOR ",
      password,
    })).toEqual({ adminId: "administrator", password });
  });

  it("enforces 128 Unicode code points and 512 UTF-8 bytes without truncation", () => {
    const boundary = "😀".repeat(128);
    expect(unicodeCodePointLength(boundary)).toBe(128);
    expect(utf8ByteLength(boundary)).toBe(512);
    expect(administratorPasswordSchema.safeParse(boundary).success).toBe(true);
    expect(administratorPasswordSchema.safeParse(`${boundary}a`).success).toBe(false);
  });

  it("applies the 16-character minimum only to newly created passwords", () => {
    expect(administratorPasswordSchema.safeParse("").success).toBe(true);
    expect(newAdministratorPasswordSchema.safeParse("a".repeat(15)).success).toBe(false);
    expect(newAdministratorPasswordSchema.safeParse("a".repeat(16)).success).toBe(true);
    expect(newAdministratorPasswordSchema.safeParse("a".repeat(128)).success).toBe(true);
    expect(newAdministratorPasswordSchema.safeParse("a".repeat(129)).success).toBe(false);
    expect(newAdministratorPasswordSchema.safeParse("😀".repeat(128)).success).toBe(true);
    expect(newAdministratorPasswordSchema.safeParse(`${"😀".repeat(128)}a`).success).toBe(false);
  });

  it("keeps script-like identifiers inert in a React text sink", () => {
    const scriptLike = `<img src=x onerror=alert(1)><script>alert("x")</script>`;
    expect(administratorIdentifierSchema.safeParse(scriptLike).success).toBe(false);
    const markup = renderToStaticMarkup(<strong>{scriptLike}</strong>);
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;img");
  });
});

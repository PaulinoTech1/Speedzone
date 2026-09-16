import { consolePath } from "./paths";
import { redirect } from "next/navigation";
import { enterPasskeyPage, validateSecuritySession } from "./auth";

export async function requireMfa() { if (!await validateSecuritySession()) redirect(consolePath("/login")); }
export async function requirePasswordSession() { if (!await enterPasskeyPage()) redirect(consolePath("/login")); }

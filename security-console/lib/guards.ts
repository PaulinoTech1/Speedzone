import { consolePath } from "./paths";
import { redirect } from "next/navigation";
import { validateSecuritySession } from "./auth";

export async function requireMfa() { if (!await validateSecuritySession()) redirect(consolePath("/login")); }
export async function requirePasswordSession() { if (!await validateSecuritySession(undefined, "password")) redirect(consolePath("/login")); }

import { redirect } from "next/navigation";
import { validateSecuritySession } from "@/lib/security-console/auth";

export async function requireMfa() { if (!await validateSecuritySession()) redirect("/Security_Console/login"); }
export async function requirePasswordSession() { if (!await validateSecuritySession(undefined, "password")) redirect("/Security_Console/login"); }

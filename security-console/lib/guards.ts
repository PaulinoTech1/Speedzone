import { redirect } from "next/navigation";
import { validateSecuritySession } from "@/lib/auth";

export async function requireMfa() { if (!await validateSecuritySession()) redirect("/login"); }
export async function requirePasswordSession() { if (!await validateSecuritySession(undefined, "password")) redirect("/login"); }

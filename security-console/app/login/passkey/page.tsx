import { consolePath } from "../../../lib/paths";
import Link from "next/link";
import { PasskeyLogin } from "../../auth-client";
import { requirePasswordSession } from "../../../lib/guards";
export default async function PasskeyLoginPage(){await requirePasswordSession();return <main><header><div><p className="eyebrow">Second factor</p><h1>Verify security passkey</h1></div><Link href={consolePath("/login")}>Start over</Link></header><section className="panel"><p>Your password was accepted. Complete passkey verification to open the console.</p><PasskeyLogin/></section></main>}

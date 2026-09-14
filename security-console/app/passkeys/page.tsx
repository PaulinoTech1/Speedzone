import { consolePath } from "../../lib/paths";
import Link from "next/link"; import { PasskeyManager } from "../auth-client"; import { requireMfa } from "../../lib/guards";
export default async function PasskeysPage(){await requireMfa();return <main><header><div><p className="eyebrow">Credential management</p><h1>Passkeys</h1><p className="muted">The final active passkey cannot be removed.</p></div><Link href={consolePath("/")}>Back to dashboard</Link></header><section className="panel"><PasskeyManager/></section></main>}

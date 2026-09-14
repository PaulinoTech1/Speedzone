import Link from "next/link";
import { requireMfa } from "@/lib/security-console/guards";
import { DeliveryTest } from "@/app/Security_Console/auth-client";
export default async function IntegrityPage(){await requireMfa();return <main><header><div><p className="eyebrow">Verification</p><h1>Integrity status</h1><p className="muted">Provider delivery is tested with a fixed synthetic event.</p></div><Link href="/Security_Console">Back to events</Link></header><section className="panel"><h2>Provider acceptance</h2><p className="muted">Limited to two attempts per 15 minutes. No ingest token reaches the browser.</p><DeliveryTest/></section></main>}

import Link from "next/link";
import { LogoutButton } from "@/app/auth-client";
import { requireMfa } from "@/lib/guards";
import { readEvents, type SecurityEvent } from "@/lib/security-store";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireMfa(); let events: SecurityEvent[]=[]; let unavailable=false;
  try { events=await readEvents(); } catch { unavailable=true; }
  return <main><header><div><p className="eyebrow">SpeedZone / security operations</p><h1>Security console</h1><p className="muted">Read-only provider visibility.</p></div><nav><Link href="/integrity">Integrity</Link><Link href="/passkeys">Passkeys</Link><LogoutButton/></nav></header><section className="grid"><div className="panel"><span className="muted">Events loaded</span><div className="value">{events.length}</div></div><div className="panel"><span className="muted">Provider</span><div className="value">{unavailable?"Offline":"Ready"}</div></div><div className="panel"><span className="muted">Mode</span><div className="value">Read-only</div></div></section><section className="panel"><h2>Recent events</h2>{unavailable?<p className="danger">Security provider unavailable.</p>:<div className="events">{events.map(event=><Link className="panel event" key={event.id} href={`/events/${event.id}`}><span><strong>{event.event}</strong><br/><span className="muted">{event.occurredAt} · {event.requestId}</span></span><span className={`badge ${event.outcome==="allowed"?"":"danger"}`}>{event.outcome}</span></Link>)}</div>}</section></main>;
}

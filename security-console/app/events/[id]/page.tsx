import Link from "next/link";
import { readEvent } from "../../../lib/security-store";
import { isSecurityAuthenticated } from "../../../lib/security-auth";
export const dynamic = "force-dynamic";
export default async function EventPage({ params }: { params: Promise<{ id:string }> }) { if(!(await isSecurityAuthenticated()))return <main><p className="danger">Sign in is required.</p><Link href="/login">Go to login</Link></main>;const {id}=await params; let event=null; let unavailable=false; try{event=await readEvent(id)}catch{unavailable=true} return <main><header><div><p className="eyebrow">Event detail</p><h1>{event?.event || "Event unavailable"}</h1></div><Link href="/">Back to events</Link></header><section className="panel">{unavailable?<p className="danger">Security store unavailable.</p>:event?<pre>{JSON.stringify(event,null,2)}</pre>:<p className="danger">This event does not exist or is not readable.</p>}</section></main>}

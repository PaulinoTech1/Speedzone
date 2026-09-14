import { consolePath } from "../../../lib/paths";
import Link from "next/link";
import { requireMfa } from "../../../lib/guards";
import { readEvent } from "../../../lib/security-store";
export const dynamic="force-dynamic";
export default async function EventPage({params}:{params:Promise<{id:string}>}){await requireMfa();const{id}=await params;let event=null;let unavailable=false;try{event=await readEvent(id)}catch{unavailable=true}return <main><header><div><p className="eyebrow">Event detail</p><h1>{event?.event||"Event unavailable"}</h1></div><Link href={consolePath("/")}>Back to events</Link></header><section className="panel">{unavailable?<p className="danger">Security provider unavailable.</p>:event?<pre>{JSON.stringify(event,null,2)}</pre>:<p className="danger">This event does not exist or is not readable.</p>}</section></main>}

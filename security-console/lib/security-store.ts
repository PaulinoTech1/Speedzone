export type SecurityEvent = { version?:number; id:string; occurredAt:string; event:string; outcome:string; actor:string; route:string; method?:string; requestId:string; hash:string; reason?:string; metadata?:Record<string,unknown> };

export interface SecurityEventProvider { list(limit: number): Promise<SecurityEvent[]>; find(id: string): Promise<SecurityEvent | null>; }

export function isSecurityEvent(value: unknown): value is SecurityEvent {
  if (!value || typeof value !== "object") return false;
  const event=value as Record<string,unknown>;
  return typeof event.id==="string"&&typeof event.occurredAt==="string"&&typeof event.event==="string"&&typeof event.outcome==="string"&&typeof event.actor==="string"&&typeof event.route==="string"&&typeof event.requestId==="string"&&typeof event.hash==="string";
}

export function parseProviderEvents(payload: unknown): SecurityEvent[] {
  const root=payload as { matches?:unknown[]; events?:unknown[] };
  const rows=Array.isArray(payload)?payload:Array.isArray(root?.events)?root.events:Array.isArray(root?.matches)?root.matches:[];
  return rows.map(row=>{const record=row as {data?:unknown};return record?.data??row}).filter(isSecurityEvent).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
}

class AxiomProvider implements SecurityEventProvider {
  async list(limit: number) {
    const url=process.env.SECURITY_LOG_QUERY_URL?.trim(); const token=process.env.SECURITY_LOG_QUERY_TOKEN?.trim();
    if(!url||!token) throw new Error("Security provider query configuration is incomplete");
    const end=new Date(); const start=new Date(end.getTime()-30*24*60*60*1000);
    const response=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({startTime:start.toISOString(),endTime:end.toISOString(),limit:Math.min(Math.max(limit,1),500),order:[{field:"occurredAt",desc:true}]}),cache:"no-store",signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error(`Security provider query rejected (${response.status})`);
    return parseProviderEvents(await response.json());
  }
  async find(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))return null;return (await this.list(500)).find(event=>event.id===id)??null;}
}

export function securityEventProvider(): SecurityEventProvider {
  const provider=process.env.SECURITY_LOG_PROVIDER?.trim().toLowerCase();
  if(provider==="axiom") return new AxiomProvider();
  throw new Error("Unsupported security event provider");
}
export function readEvents(){return securityEventProvider().list(100)}
export function readEvent(id:string){return securityEventProvider().find(id)}

import { getSecurityRedis } from "./redis";

export type SecurityEvent = { version?:number; id:string; occurredAt:string; event:string; outcome:string; actor:string; route:string; method?:string; requestId:string; hash:string; reason?:string; client?:{networkFingerprint?:string;country?:string;region?:string;userAgentFamily?:string};metadata?:Record<string,unknown> };

export const securityRedis = getSecurityRedis;

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

export class SecurityProviderError extends Error {
  constructor(public readonly code: "configuration" | "endpoint" | "network" | "response" | "http", public readonly status?: number) {
    super("Security provider query failed");
    this.name = "SecurityProviderError";
  }
}

export function securityProviderErrorMessage(error: unknown): string {
  if (!(error instanceof SecurityProviderError)) return "Event retrieval failed. Check provider configuration and try again.";
  if (error.code === "configuration") return "Set SECURITY_LOG_PROVIDER to axiom and configure SECURITY_LOG_QUERY_URL and SECURITY_LOG_QUERY_TOKEN, then redeploy.";
  if (error.code === "endpoint") return "The query URL must use HTTPS and the dataset query path /v1/datasets/DATASET_NAME/query.";
  if (error.code === "network") return "The query service could not be reached or timed out. Check the query hostname and provider availability.";
  if (error.code === "response") return "The query service returned an unexpected response. Check that the URL is an Axiom dataset query endpoint.";
  if (error.status === 401) return "Axiom rejected the query token (HTTP 401). Check that the token is valid, then redeploy.";
  if (error.status === 403) return "Axiom denied query access (HTTP 403). Grant the query token read access to the configured dataset, then redeploy.";
  if (error.status === 404) return "The query endpoint or dataset was not found (HTTP 404). Check the URL and dataset name.";
  if (error.status === 400 || error.status === 422) return `Axiom rejected the query (HTTP ${error.status}). Check the dataset endpoint and query format.`;
  if (error.status === 429) return "Axiom query rate limit reached (HTTP 429). Wait before refreshing.";
  return `The query service returned HTTP ${error.status}. Try again or check provider availability.`;
}

class AxiomProvider implements SecurityEventProvider {
  async list(limit: number) {
    const url=process.env.SECURITY_LOG_QUERY_URL?.trim(); const token=process.env.SECURITY_LOG_QUERY_TOKEN?.trim();
    if(!url||!token) throw new SecurityProviderError("configuration");
    let endpoint: URL;
    try {
      endpoint = new URL(url);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || !/^\/v1\/datasets\/[^/]+\/query$/.test(endpoint.pathname)) throw new Error();
    } catch { throw new SecurityProviderError("endpoint"); }
    const end=new Date(); const start=new Date(end.getTime()-30*24*60*60*1000);
    let response: Response;
    try { response=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({startTime:start.toISOString(),endTime:end.toISOString(),limit:Math.min(Math.max(limit,1),500),order:[{field:"occurredAt",desc:true}]}),cache:"no-store",signal:AbortSignal.timeout(5000),redirect:"error"}); } catch { throw new SecurityProviderError("network"); }
    if(!response.ok) throw new SecurityProviderError("http", response.status);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new SecurityProviderError("response"); }
    const root = payload as { matches?: unknown; events?: unknown } | null;
    if (!Array.isArray(payload) && !Array.isArray(root?.matches) && !Array.isArray(root?.events)) throw new SecurityProviderError("response");
    return parseProviderEvents(payload);
  }
  async find(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))return null;return (await this.list(500)).find(event=>event.id===id)??null;}
}

export function securityEventProvider(): SecurityEventProvider {
  const provider=process.env.SECURITY_LOG_PROVIDER?.trim().toLowerCase();
  if(provider==="axiom") return new AxiomProvider();
  throw new SecurityProviderError("configuration");
}
export function readEvents(limit=500){return securityEventProvider().list(limit)}
export function readEvent(id:string){return securityEventProvider().find(id)}

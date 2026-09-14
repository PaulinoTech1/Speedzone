import { readBugReportsPage } from "@/lib/bug-reports";
import { authorizeSecurityConsoleRequest } from "@/lib/security-console-service-auth";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!authorizeSecurityConsoleRequest(request))return Response.json({error:"Unauthorized"},{status:401,headers:{"Cache-Control":"private, no-store"}});
  const raw=new URL(request.url).searchParams.get("cursor")||"0";if(!/^\d{1,4}$/.test(raw))return Response.json({error:"Invalid cursor"},{status:400,headers:{"Cache-Control":"private, no-store"}});
  try{const page=await readBugReportsPage(Number(raw),50);return Response.json({reports:page.reports.map(report=>"unreadable" in report?report:{...report,status:"new",severity:report.category==="security"?"high":report.category==="accessibility"?"medium":"low",expiresAt:new Date(Date.parse(report.createdAt)+30*24*60*60*1000).toISOString()}),nextCursor:page.nextCursor},{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})}catch{return Response.json({error:"Report storage unavailable"},{status:503,headers:{"Cache-Control":"private, no-store"}})}
}

import Link from "next/link"; import { SetupForm } from "@/app/Security_Console/auth-client";
export default function SetupPage(){return <main><header><div><p className="eyebrow">One-time bootstrap</p><h1>Initialize security credentials</h1></div><Link href="/Security_Console/login">Back to login</Link></header><section className="panel"><SetupForm/></section></main>}

import { consolePath } from "../../lib/paths";
import Link from "next/link"; import { SetupForm } from "../auth-client";
export default function SetupPage(){return <main><header><div><p className="eyebrow">One-time bootstrap</p><h1>Initialize security credentials</h1></div><Link href={consolePath("/login")}>Back to login</Link></header><section className="panel"><SetupForm/></section></main>}

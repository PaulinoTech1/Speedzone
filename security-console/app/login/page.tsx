import { consolePath } from "../../lib/paths";
import Link from "next/link"; import { PasswordLogin } from "../auth-client";
export default function LoginPage(){return <main><header><div><p className="eyebrow">Independent trust boundary</p><h1>Security console</h1><p className="muted">Inventory admin credentials and cookies are never accepted here.</p></div><Link href={consolePath("/setup")}>First-time setup</Link></header><section className="panel"><h2>Operator sign in</h2><PasswordLogin/></section></main>}

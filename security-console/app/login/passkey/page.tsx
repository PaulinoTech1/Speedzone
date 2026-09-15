import { consolePath } from "../../../lib/paths";
import Link from "next/link";
import { PasskeyLogin } from "../../auth-client";
import { requirePasswordSession } from "../../../lib/guards";
import { establishedPasskeyCount, NO_ESTABLISHED_PASSKEY } from "../../../lib/passkeys";
export default async function PasskeyLoginPage(){
  await requirePasswordSession();
  const count = await establishedPasskeyCount();
  return <main><header><div><p className="eyebrow">Second factor</p><h1>Verify security passkey</h1></div><Link href={consolePath("/login")}>Start over</Link></header><section className="panel">
    <p>Password verified. Security passkey required.</p>
    {count === null ? <p role="alert">Security passkey storage is unavailable. Please try again later.</p>
      : count === 0 ? <p role="alert">{NO_ESTABLISHED_PASSKEY}</p>
      : <><p>Established security passkeys: {count}</p><PasskeyLogin/></>}
  </section></main>
}

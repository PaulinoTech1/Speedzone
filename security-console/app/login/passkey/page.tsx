import { consolePath } from "../../../lib/paths";
import Link from "next/link";
import { PasskeyLogin } from "../../auth-client";
import { requirePasswordSession } from "../../../lib/guards";
import { establishedPasskeyCount, firstPasskeyAvailable, NO_ESTABLISHED_PASSKEY } from "../../../lib/passkeys";
import { PasskeyBootstrap } from "../../passkey-bootstrap-client";
import { passkeyRecoveryAvailable } from "../../../lib/passkey-recovery";
import { PasskeyRecovery } from "../../passkey-recovery-client";
export default async function PasskeyLoginPage(){
  await requirePasswordSession();
  const [count, bootstrapAvailable, recoveryAvailable] = await Promise.all([establishedPasskeyCount(), firstPasskeyAvailable(), passkeyRecoveryAvailable()]);
  return <main><header><div><p className="eyebrow">Second factor</p><h1>Verify security passkey</h1></div><Link href={consolePath("/login")}>Start over</Link></header><section className="panel">
    <p>Password verified. Security passkey required.</p>
    {count === null ? <p role="alert">Security passkey storage is unavailable. Please try again later.</p>
      : count === 0 ? bootstrapAvailable ? <PasskeyBootstrap/> : <p role="alert">{NO_ESTABLISHED_PASSKEY}</p>
      : <><p>Established security passkeys: {count}</p><PasskeyLogin/></>}
  </section>{count !== null && !bootstrapAvailable && recoveryAvailable && <PasskeyRecovery/>}</main>
}

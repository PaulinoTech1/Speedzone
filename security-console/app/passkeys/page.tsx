import Link from "next/link";

import { isSecurityAuthenticated } from "../../lib/security-auth";
import PasskeyManager from "./PasskeyManager";

export default async function PasskeysPage() {
	if (!(await isSecurityAuthenticated())) return <main><p className="danger">Sign in is required.</p><Link href="/login">Go to login</Link></main>;
	return (
		<main>
			<header>
				<div>
					<p className="eyebrow">Credential management</p>
					<h1>Passkeys</h1>
					<p className="muted">These passkeys belong only to the security console. Inventory admin passkeys are not accepted.</p>
				</div>
				<Link href="/">Back to events</Link>
			</header>
			<PasskeyManager />
		</main>
	);
}

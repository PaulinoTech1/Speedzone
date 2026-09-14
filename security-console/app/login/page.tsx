import Link from "next/link";

import LoginForm from "./LoginForm";

export default function LoginPage() {
	return (
		<main>
			<header>
				<div>
					<p className="eyebrow">Independent trust boundary</p>
					<h1>Security console</h1>
					<p className="muted">This login uses a security-console password and passkeys, separate from inventory admin credentials.</p>
				</div>
				<Link href="/setup">Initial setup</Link>
			</header>
			<LoginForm />
		</main>
	);
}

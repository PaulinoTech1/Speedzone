import Link from "next/link";

import SetupForm from "./SetupForm";

export default function SetupPage() {
	return (
		<main>
			<header>
				<div>
					<p className="eyebrow">One-time bootstrap</p>
					<h1>Initialize security access</h1>
					<p className="muted">The bootstrap token is accepted once and is never stored as a password.</p>
				</div>
				<Link href="/login">Back to login</Link>
			</header>
			<SetupForm />
		</main>
	);
}

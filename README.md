# log-anchors (data branch)

Append-only hourly fingerprints of SpeedZone security events in Axiom. The `log-anchors` workflow on `main` writes them. See `scripts/log-anchors/` on main for the format and the verify script.

Only `anchors/*.jsonl` changes here. The `vercel.json` files stop both Vercel projects from building this branch. Don't edit or rewrite this branch.

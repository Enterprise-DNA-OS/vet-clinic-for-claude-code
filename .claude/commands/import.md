---
description: Bring the clinic across from ezyVet (or any CSV in its shape) - clients then animals, dry-run first. The import is the first audit.
---

1. Read `docs/replace-ezyvet.md` for what exports from ezyVet, what maps, and what deliberately starts fresh.
2. Dry run first: `node scripts/vet.mjs import ezyvet --clients=clients.csv --patients=animals.csv --dry-run --json`. Read the skips out loud: an animal whose owner is missing is a question about the old data, not a rounding error.
3. Run it for real, then re-run it: the second pass must create nothing new (it updates instead). That is the idempotency check.
4. After import, run the honesty sweep: `patients --json` (microchips missing?), `reminders --all --json` (vaccination history carried?), `register check` (controlled drugs never import blind: count the shelf and open the register with received entries).
5. Present: created, updated, skipped-and-why, and the three commands the operator should run next.

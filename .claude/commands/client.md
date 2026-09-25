---
description: One owner's whole card before any conversation - their animals, their money, their appointments, the file notes.
---

1. Run `node scripts/vet.mjs client "<name>" --json`. A partial name is fine; if it is ambiguous the CLI lists the candidates, ask which.
2. Present the card: the patients with last-seen and vaccination-due dates loud, anything owing with its age, upcoming appointments, and the most recent file notes.
3. If money is owed past 30 days, say so plainly with the amount and the age; the account conversation goes better before the consult than after.
4. Read the card before drafting anything to this owner. The notes are the history.

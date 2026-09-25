---
description: A file note on a patient or an owner - calls, promises to pay, decisions, changes. In a complaint to the Council, this is the record.
---

1. Run `node scripts/vet.mjs note add PATIENT "the note" [--staff=]`, or `note add --client="NAME" "the note"` for owner-level notes (accounts, contact changes).
2. Write the note in plain past tense with names and dates in it. What was said, what was agreed, who agreed it.
3. `notes PATIENT --json` reads the trail back before any difficult conversation.

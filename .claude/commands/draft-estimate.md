---
description: Draft a written estimate for a procedure - the items, the price each, the total, and what is not included - to drafts/, in the clinic's brand voice.
---

1. Read the patient's card first: `node scripts/vet.mjs patient "NAME" --json`. Price from the real list: `items --json`.
2. Draft to `drafts/estimate-<patient>-<procedure>.md`: the procedure in plain words, each line item with its price, the total, what is excluded (histology, complications, overnight care), and how long the estimate holds.
3. Note consent on the estimate: the signed form comes back before the procedure, and the consult will not complete without it.
4. A person sends it. When it is accepted, book it (`appt add ... --type=surgery`) and log the acceptance with `/log`.

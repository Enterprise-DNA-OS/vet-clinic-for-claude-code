---
description: Completed consults with charges and no invoice - the write-off queue if nobody acts. Build the invoices before the memory of the visit fades.
---

1. Run `node scripts/vet.mjs unbilled --json`.
2. Present oldest first with the value. For each: `invoice build CN-ref` (it refuses open consults and double-invoicing, so what builds is safe).
3. An open consult that should be finished first shows in `consults --open`; complete it with notes, then bill it.

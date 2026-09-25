---
description: Everything that wants a decision this morning, worst first. A controlled drug register discrepancy outranks everything, then a vet in the book without a current practising certificate, then unfinished records, missing consent, unbilled work and overdue recalls.
---

1. Run `node scripts/vet.mjs attention --json`.
2. Present it worst first, grouped by reason, in the clinic's words. Lead with anything rank 1 or 2 (a register discrepancy, a vet booked with an expired certificate): those are today's first conversations, say so plainly.
3. For each group, say the one action that clears it: count the drug and record the correcting entry, reassign the appointments, `consult done CN-xx --notes=`, chase the consent form, `invoice build CN-xx`, ring the recall list.
4. If the list is empty, say so in one line and stop.

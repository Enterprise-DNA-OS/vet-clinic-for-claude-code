---
description: A new owner and animal, set up in the order the gates expect - client, patient, first appointment, vaccination history if they brought it.
---

1. If the owner is new, add them first (a quick insert through `scripts/lib/db.mjs` is fine, or take the details and use the import shape); confirm name, phone, suburb.
2. Add the patient with everything the first visit needs: species, breed, sex, date of birth, microchip number. A dog with no chip gets that said out loud and a `MICROCHIP` line at the first consult.
3. Book the first appointment: `node scripts/vet.mjs appt add PATIENT --vet= --on= --at= --reason=`.
4. If they brought a vaccination history from the old clinic, record it: `vacc add PATIENT --vaccine= --vet= --given= --due=` per line, so the recall engine starts honest.
5. Read back the card (`patient NAME --json`) as confirmation.

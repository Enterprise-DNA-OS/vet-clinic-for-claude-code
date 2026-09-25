---
description: The consult ritual - open it, add what was done and dispensed, complete it with notes (and consent for procedures). The gates live here and there are no force flags.
---

1. Open: `node scripts/vet.mjs consult open PATIENT --vet= [--appt=AP-ref] [--type=] [--reason=]`. The gate refuses a vet without a current practising certificate.
2. Charge as you go: `consult add CN-ref ITEM [--qty=] [--price=]`. Restricted medicines dispense only inside a vet's consult; a controlled drug writes its register entry in the same breath; an expired batch or an empty shelf refuses.
3. Complete: `consult done CN-ref --notes="what you found and what you did" [--weight=] [--recheck=] [--consent]`. No notes, no completion: the record is the evidence of care. A surgery or dental also refuses without consent on record.
4. Then `invoice build CN-ref` while the owner is still at the desk. `consults --open --json` shows anything left unfinished; an open consult from yesterday is a compliance problem, not a style choice.

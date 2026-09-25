---
description: The appointment book - today by default, the week with --week - plus anything from the past nobody resolved. Booking, cancelling and no-shows go through the gates.
---

1. Run `node scripts/vet.mjs book --json` (or `book --week --json` for the week, `--vet=` for one vet's column).
2. Present it as the day sheet: time order, patient, owner, vet, reason. Anything UNCONFIRMED (a past appointment never completed, cancelled or marked a no-show) goes first with the question: what happened?
3. To book: `appt add PATIENT --vet= --on= --at= [--minutes=] [--type=] [--reason=]`. The gate refuses a vet whose practising certificate is missing or expired on the day, and a vet booked twice at once; if it refuses, say why and offer another vet, never a workaround.
4. To resolve: `appt cancel REF --reason=` or `appt noshow REF`. A completed appointment resolves through its consult (`consult open PATIENT --appt=REF`).

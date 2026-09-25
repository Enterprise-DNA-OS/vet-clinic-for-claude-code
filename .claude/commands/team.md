---
description: The staff list with the practising certificate state loud, next week's load, and what each vet billed in the last 28 days.
---

1. Run `node scripts/vet.mjs staff --json`.
2. Present vets first: registration number, certificate expiry and state (EXPIRED or NONE in capitals, with how many appointments they hold - that is a today problem), then consults and billing over the last 28 days.
3. An expiring certificate inside 30 days gets a named action: renew with the Council now, the booking gate refuses the day it lapses.

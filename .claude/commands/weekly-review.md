---
description: The Monday review, written from three commands - what needs a decision, how the money sits, and whether the week's book is covered and compliant.
---

1. Run three commands, `--json` each: `node scripts/vet.mjs attention`, `node scripts/vet.mjs book --week`, `node scripts/vet.mjs debtors`. Add `reminders` if the recall run is this week.
2. Write the review in four short sections, prose plus small tables, nothing invented:
   - **Today's decisions.** The attention list, worst first, one action each. A register discrepancy or a vet booked on an expired certificate is the first line of the whole review.
   - **The money.** Unbilled total and oldest days, debtors by age, and which invoices to build or chase this week.
   - **The book.** The week's load by vet, gaps, anything UNCONFIRMED from last week to resolve, certificates expiring inside 30 days.
   - **The recalls.** Overdue with nothing booked, oldest first, and who is ringing them.
3. End with at most five actions for the week, each one doable with a single command or phone call.
4. If the operator wants it on paper, `npm run view` renders the week and money pages in the clinic's brand.

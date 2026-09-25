# The rule book /compliance checks

Nine rules, each with its source, what a breach looks like in the data, and where the CLI already refuses at the gate. `node scripts/vet.mjs compliance` runs them all; add a rule key to run one.

Nothing here is legal advice. It is the rule book the operator has pointed the system at, with sources, and the operator changes it to match their practice. When the law moves, update the rule and the check together.

## 1. `apc` - current practising certificates

Every vet practising holds a current annual practising certificate. **Source: Veterinarians Act 2005 s 18** (a person must not practise as a veterinarian without a current practising certificate); certificates issued by the Veterinary Council of New Zealand, renewed annually.

Breach in the data: an active vet whose `apc_expires_on` is past or missing, worse if they hold upcoming appointments. **Gate: `appt add` and `consult open` refuse a vet without a current certificate on the day. No force flag.**

## 2. `register` - the controlled drug register reconciles

Every controlled drug movement is recorded and the register balance matches the shelf. **Source: Misuse of Drugs Regulations 1977** (registers of controlled drugs: form, entries, and retention).

Breach in the data: `v_register_balances.discrepancy` is not zero for any controlled item. **Gate: dispensing a controlled drug happens only inside a consult and writes its register entry in the same transaction of work; the register is append-only; the balance never goes negative; disposals require a witness.**

## 3. `records` - clinical notes, finished the day they happened

Every consult carries clear, accurate clinical notes. **Source: Veterinary Council of New Zealand Code of Professional Conduct** (a veterinarian must keep clear, accurate and legible patient records).

Breach in the data: a completed consult with empty notes (only possible via import), or a consult still open from a past day. **Gate: `consult done` refuses without `--notes=`. No force flag.**

## 4. `consent` - informed consent for procedures

Every surgery and dental carries informed consent, on record. **Source: VCNZ Code of Professional Conduct** (informed consent obtained and recorded before significant procedures).

Breach in the data: a completed consult of type surgery or dental with no `consent_on`. **Gate: `consult done` refuses a surgery or dental without `--consent`. No force flag.**

## 5. `rvm` - restricted veterinary medicines under authorisation

Restricted veterinary medicines are dispensed only under a registered vet's authorisation. **Source: Agricultural Compounds and Veterinary Medicines Act 1997** and the conditions of registration on each RVM.

Breach in the data: a consult line for an RVM or controlled item under a non-vet's consult (only possible via import). **Gate: `consult open` requires a vet; `consult add` re-checks the flags.**

## 6. `expired-stock` - no expired batch on the shelf

Expired medicine batches are quarantined, not dispensed. **Source: ACVM Act 1997** (conditions of registration and label directions); plain good practice either way.

Breach in the data: a tracked item whose batch expiry is past with stock on hand. **Gate: `consult add` refuses to dispense from an expired batch. No force flag.**

## 7. `microchip` - dogs carry a microchip on record

Dogs (other than working farm dogs) must be microchipped within two months of first registration. **Source: Dog Control Act 1996 s 36A**; the chip goes on the New Zealand Companion Animal Register (NZCAR) in practice.

Breach in the data: an active canine patient with no microchip recorded. The fix is a `MICROCHIP` line at the next visit, and the chip number on the card.

## 8. `vaccination` - recalls do not drift

No core vaccination drifts more than 90 days overdue without a booking or a recorded decline. **Source: WSAVA vaccination guidelines, and your own clinical standard** - this one is the operator's rule, not statute, and the threshold is theirs to change.

Breach in the data: a `v_reminders` row LONG OVERDUE with nothing booked. The fix is the recall run: `/reminders`, then `/draft-reminder-letters`.

## 9. `retention` - records are never deleted

Clinical records are retained; a minimum of three years is the working floor, longer is normal. **Source: VCNZ Code of Professional Conduct** (records retention).

Held by design: this CLI has no delete path. Patients become deceased, clients and staff become former, consults and invoices stay, and the register only ever gains entries. The check exists so an auditor can see the rule stated, not because it can fail here.

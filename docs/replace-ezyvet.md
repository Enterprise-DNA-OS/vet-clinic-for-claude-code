# Moving off ezyVet

The promise: export from ezyVet, run one command, and the operating record comes with you in a morning. Here is exactly what carries, what starts fresh, and why.

## What to export from ezyVet

ezyVet's list screens and reports export to CSV. You need two files:

1. **Clients.** The client list export: code, first name, last name, email, mobile, physical address, suburb.
2. **Animals.** The animal (patient) list export: code, name, species, breed, sex, date of birth, microchip number, owner.

Column names vary a little between ezyVet versions and report layouts; the importer matches the common variants case-insensitively (`Owner`, `Owner Name`, `Client Code` all work). Dates in DD/MM/YYYY are read as New Zealand dates.

## Run it

```bash
node scripts/vet.mjs import ezyvet --clients=clients.csv --patients=animals.csv --dry-run
node scripts/vet.mjs import ezyvet --clients=clients.csv --patients=animals.csv
```

Dry run first, always. The importer is idempotent: it matches on the ezyVet code (kept in `external_ref`) and then on name, so running it twice updates instead of duplicating, and a weekly re-run during a transition period is safe.

## What maps

| ezyVet | Here |
|---|---|
| Client (code, name, contact details) | `clients`, code kept in `external_ref` |
| Animal (code, name, species, breed, sex, DOB, microchip) | `patients`, ref minted (`PT-...`), code kept in `external_ref` |

## What deliberately does not carry over

- **Clinical history.** ezyVet's consult records export as reports, not as a clean relational file, and a clinical record re-keyed by machine is a record nobody signed. Keep the ezyVet export as the archive it is (you are entitled to your records), and start new consults here. For patients mid-treatment, write a one-paragraph summary into a file note (`/log`) on day one.
- **Vaccination history.** Enter the current state, not the archive: one `vacc add` per patient per vaccine with the last given date and the next due date. That is usually an hour with the ezyVet reminders report open, and afterwards the recall engine is honest. Skip it and `/reminders` is blind.
- **Open invoices.** Bring balances across as one line each in your accounting system, or re-issue from here. Money history stays in the old system's export.
- **Controlled drug registers never import blind.** Count the shelf, rule off the old register, and open the register here with `stock receive` entries for what is physically on hand. The first `register check` after that is your opening reconciliation, on the record.
- **Bookings.** Rebook the forward book by hand (`appt add`); it is usually days, not months, and every booking passes the certificate gate on the way in.

## The import is the first audit

Every skip is named and every skip is a question about the old data: an animal whose owner is not in the client export, a row with no name. Do not silence them; answer them. Then run the honesty sweep:

```bash
node scripts/vet.mjs patients --json        # which dogs have no microchip on record
node scripts/vet.mjs reminders --all --json # is the vaccination state believable
node scripts/vet.mjs register check         # does the register open reconciled
node scripts/vet.mjs compliance             # the whole rule book, day one
```

A clean system on day one is the point of moving.

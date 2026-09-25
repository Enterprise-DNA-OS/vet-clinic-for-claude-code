#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'vet-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the clinic -----------------------------------------------------------

  const stats = run('stats', ['vet.mjs', 'stats']);
  assert(n(stats.active_clients) === 7, `seven active clients (${stats.active_clients})`);
  assert(n(stats.active_patients) === 10, `ten active patients (${stats.active_patients})`);
  assert(n(stats.vets) === 3, `three active vets (${stats.vets})`);
  assert(n(stats.unbilled_cents) === 46100, `$461 unbilled (${stats.unbilled_cents})`);
  assert(n(stats.outstanding_cents) === 68840, `$688.40 outstanding (${stats.outstanding_cents})`);
  assert(n(stats.recalls_overdue) === 6, `six overdue recalls (${stats.recalls_overdue})`);
  assert(n(stats.register_discrepancies) === 1, `one register discrepancy (${stats.register_discrepancies})`);

  const book = run('book (today + unresolved)', ['vet.mjs', 'book']);
  assert(book.length === 4, `three today plus the unconfirmed one (${book.length})`);
  assert(book.some((b) => b.state === 'UNCONFIRMED' && b.ref === 'AP-1008'), 'the unresolved past appointment surfaces');

  const week = run('book --week', ['vet.mjs', 'book', '--week']);
  assert(week.length === 8, `the week's book (${week.length})`);
  assert(week.filter((b) => b.vet === 'Dr Priya Nair').length === 3, 'Dr Nair holds three (with an expired certificate)');

  const staffRows = run('staff', ['vet.mjs', 'staff']);
  assert(staffRows.length === 5, `five active staff (${staffRows.length})`);
  const nair = staffRows.find((s) => s.name === 'Dr Priya Nair');
  assert(nair.apc === 'EXPIRED' && n(nair.appts_next_7d) === 3, 'Nair: expired certificate, three appointments');
  assert(staffRows.find((s) => s.name === 'Dr Sione Tuala').apc === 'expiring', 'Tuala is expiring');

  const clients = run('clients', ['vet.mjs', 'clients']);
  assert(clients.length === 7, `seven active clients (${clients.length})`);
  const trish = clients.find((c) => c.name === 'Trish Cavanagh');
  assert(n(trish.owing_cents) === 46840, 'Trish owes the dental');

  const allClients = run('clients --all includes the former', ['vet.mjs', 'clients', '--all']);
  assert(allClients.length === 8, `all clients (${allClients.length})`);

  const petrie = run('client card by partial name', ['vet.mjs', 'client', 'petrie']);
  assert(petrie.client.name === 'Alan Petrie', 'resolved by partial name');
  assert(petrie.patients.length === 2, 'Alan owns Baxter and Juno');

  const noClient = run('an unknown client exits 1', ['vet.mjs', 'client', 'nobody at all'], { json: false, expectFail: true });
  assert(/No client matches/.test(noClient.stderr), 'and says so plainly');

  const patients = run('patients', ['vet.mjs', 'patients']);
  assert(patients.length === 10, `ten active patients (${patients.length})`);
  const dogs = run('patients --species=dog', ['vet.mjs', 'patients', '--species=dog']);
  assert(dogs.length === 6 && dogs.every((p) => p.species === 'dog'), 'six active dogs');

  const baxter = run('patient card by ref', ['vet.mjs', 'patient', 'PT-101']);
  assert(baxter.patient.name === 'Baxter', 'PT-101 is Baxter');
  assert(baxter.weights.length === 3 && n(baxter.weights[2].weight_kg) > n(baxter.weights[0].weight_kg), 'the weight trend is visible, and rising');

  const byChip = run('patient card by microchip', ['vet.mjs', 'patient', '985113004417203']);
  assert(byChip.patient.name === 'Banjo', 'the microchip resolves');

  const ambiguous = run('an ambiguous patient name exits 1', ['vet.mjs', 'patient', 'b'], { json: false, expectFail: true });
  assert(/matches \d+ patient/.test(ambiguous.stderr), 'and lists the candidates');

  // ---- attention and compliance ---------------------------------------------

  const attention = run('attention', ['vet.mjs', 'attention']);
  assert(attention.length >= 20, `the attention list is loud (${attention.length})`);
  assert(attention[0].reason === 'register_discrepancy', 'the controlled drug discrepancy outranks everything');
  for (const reason of ['register_discrepancy', 'apc_expired', 'consult_unfinished', 'consent_missing', 'unbilled',
    'recall_overdue', 'debtor', 'batch_expired', 'batch_expiring', 'stock_low', 'apc_expiring', 'appt_unconfirmed',
    'microchip_missing', 'patient_lapsed']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention.filter((a) => a.reason === 'recall_overdue').length === 4, 'four overdue recalls with nothing booked (Mochi and Banjo are booked)');
  assert(attention.some((a) => a.reason === 'apc_expired' && a.label === 'Dr Priya Nair'), 'the certificate breach names Dr Nair');

  const compliance = run('compliance', ['vet.mjs', 'compliance']);
  assert(compliance.length === 9, `nine rules in the book (${compliance.length})`);
  const failed = compliance.filter((r) => r.breaches.length).map((r) => r.key).sort();
  assert(failed.join(',') === 'apc,consent,expired-stock,microchip,records,register,vaccination',
    `the seeded breaches are exactly the story (${failed.join(',')})`);
  const oneRule = run('one compliance rule', ['vet.mjs', 'compliance', 'consent']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 2, 'two procedures without consent');

  const checkBefore = run('register check', ['vet.mjs', 'register', 'check']);
  const ket = checkBefore.find((r) => r.code === 'KET-100');
  assert(n(ket.register_qty) === 46.5 && n(ket.shelf_qty) === 44 && n(ket.discrepancy) === -2.5, 'the ketamine discrepancy is 2.5 ml');
  assert(n(checkBefore.find((r) => r.code === 'METH-10').discrepancy) === 0, 'methadone reconciles');

  // ---- the booking gates ------------------------------------------------------

  const gateApc = run('booking Dr Nair is refused', ['vet.mjs', 'appt', 'add', 'Baxter', '--vet=Nair', `--on=${addDays(todayIso, 2)}`, '--at=12:00'], { json: false, expectFail: true });
  assert(/Veterinarians Act/.test(gateApc.stderr) && /No force flag/.test(gateApc.stderr), 'and cites the Act');

  const gateNurse = run('booking a nurse as the vet is refused', ['vet.mjs', 'appt', 'add', 'Biscuit', '--vet=Harmon', `--on=${addDays(todayIso, 2)}`, '--at=12:00'], { json: false, expectFail: true });
  assert(/not a vet/.test(gateNurse.stderr), 'a nurse does not hold the consult');

  const gateDeceased = run('booking a deceased patient is refused', ['vet.mjs', 'appt', 'add', 'Pippa', '--vet=Cole', `--on=${addDays(todayIso, 2)}`, '--at=12:00'], { json: false, expectFail: true });
  assert(/deceased/.test(gateDeceased.stderr), 'the record stays, the bookings stop');

  const booked = run('book a valid appointment', ['vet.mjs', 'appt', 'add', 'Baxter', '--vet=Cole', `--on=${addDays(todayIso, 1)}`, '--at=10:00', '--reason=Bloods recheck']);
  assert(/^AP-\d+$/.test(booked.ref), `the ref is minted (${booked.ref})`);

  const clash = run('double-booking the vet is refused', ['vet.mjs', 'appt', 'add', 'Mochi', '--vet=Cole', `--on=${addDays(todayIso, 1)}`, '--at=10:15'], { json: false, expectFail: true });
  assert(/already booked/.test(clash.stderr), 'a vet is not in two rooms at once');

  const noReason = run('cancelling without a reason is refused', ['vet.mjs', 'appt', 'cancel', booked.ref], { json: false, expectFail: true });
  assert(/reason/.test(noReason.stderr), 'the reason goes on the record');
  run('cancel it with a reason', ['vet.mjs', 'appt', 'cancel', booked.ref, '--reason=Owner called, clash with work']);
  run('resolve the stale appointment as a no-show', ['vet.mjs', 'appt', 'noshow', 'AP-1008']);

  // ---- the consult room -------------------------------------------------------

  const opened = run('open a consult', ['vet.mjs', 'consult', 'open', 'Juno', '--vet=Cole', '--reason=Overdue vaccination and check']);
  assert(/^CN-\d+$/.test(opened.ref), `the consult ref is minted (${opened.ref})`);

  run('add the consult fee', ['vet.mjs', 'consult', 'add', opened.ref, 'CONS-STD']);

  const gateExpired = run('dispensing from an expired batch is refused', ['vet.mjs', 'consult', 'add', opened.ref, 'AMOX-250', '--qty=14'], { json: false, expectFail: true });
  assert(/expired/.test(gateExpired.stderr) && /No force flag/.test(gateExpired.stderr), 'the expired batch does not leave the building');

  const gateStock = run('dispensing more than the shelf holds is refused', ['vet.mjs', 'consult', 'add', opened.ref, 'KET-100', '--qty=100'], { json: false, expectFail: true });
  assert(/on the shelf/.test(gateStock.stderr), 'stock is counted, not imagined');

  const ketLine = run('dispense a controlled drug', ['vet.mjs', 'consult', 'add', opened.ref, 'KET-100', '--qty=2']);
  assert(n(ketLine.total_cents) === 1900, 'two ml at $9.50');

  const noNotes = run('completing without notes is refused', ['vet.mjs', 'consult', 'done', opened.ref], { json: false, expectFail: true });
  assert(/clinical notes/.test(noNotes.stderr) && /No force flag/.test(noNotes.stderr), 'the record is not optional');

  const done = run('complete it with notes and a weight', ['vet.mjs', 'consult', 'done', opened.ref, '--notes=Bright, well grown. DHP given after exam. Sedation drawn for radiograph of old tail injury, uneventful.', '--weight=19.4']);
  assert(done.status === 'completed' && n(done.value_cents) === 10800, `completed at $108 (${done.value_cents})`);

  const registerAfter = run('the dispensing wrote the register', ['vet.mjs', 'register', 'KET-100']);
  assert(registerAfter[0].movement === 'dispensed' && n(registerAfter[0].qty) === 2 && n(registerAfter[0].balance_after) === 44.5, 'newest entry first, balance carried');

  const checkAfter = run('register check still shows the old discrepancy', ['vet.mjs', 'register', 'check']);
  const ket2 = checkAfter.find((r) => r.code === 'KET-100');
  assert(n(ket2.register_qty) === 44.5 && n(ket2.shelf_qty) === 42 && n(ket2.discrepancy) === -2.5, 'dispensing moved both sides; the 2.5 ml is still missing');

  // consent: a surgery does not complete without it
  const surgery = run('open a surgery', ['vet.mjs', 'consult', 'open', 'Clover', '--vet=Cole', '--type=surgery', '--reason=Lump removal, left flank']);
  run('add the surgery fee', ['vet.mjs', 'consult', 'add', surgery.ref, 'SURG-SPEY', '--price=310']);
  const noConsent = run('completing a surgery without consent is refused', ['vet.mjs', 'consult', 'done', surgery.ref, '--notes=Lump excised, 8mm margins, to histology.'], { json: false, expectFail: true });
  assert(/consent/.test(noConsent.stderr) && /No force flag/.test(noConsent.stderr), 'consent is on record or the procedure is not done');
  run('complete it with consent', ['vet.mjs', 'consult', 'done', surgery.ref, '--notes=Lump excised, 8mm margins, to histology. Recovered well.', '--consent']);

  const consultsOpen = run('consults --open is now empty', ['vet.mjs', 'consults', '--open']);
  assert(consultsOpen.length === 1 && consultsOpen[0].ref === 'CN-2011', 'only the seeded stale consult remains open');

  // ---- money ------------------------------------------------------------------

  const unbilled = run('unbilled', ['vet.mjs', 'unbilled']);
  assert(unbilled.length === 5, `three seeded plus the two just completed (${unbilled.length})`);

  const gateOpenInvoice = run('invoicing the stale open consult is refused', ['vet.mjs', 'invoice', 'build', 'CN-2011'], { json: false, expectFail: true });
  assert(/still open/.test(gateOpenInvoice.stderr), 'the invoice bills the record, not the plan');

  const inv = run('invoice the consult', ['vet.mjs', 'invoice', 'build', opened.ref]);
  assert(/^INV-\d+$/.test(inv.ref) && n(inv.total_cents) === 10800, `invoice minted (${inv.ref})`);

  const invAgain = run('invoicing it twice is refused', ['vet.mjs', 'invoice', 'build', opened.ref], { json: false, expectFail: true });
  assert(/already invoiced/.test(invAgain.stderr), 'one consult, one invoice');

  run('mark it paid', ['vet.mjs', 'invoice', 'paid', inv.ref]);

  const debtors = run('debtors', ['vet.mjs', 'debtors']);
  assert(debtors.length === 3, `three owing (${debtors.length})`);
  assert(debtors[0].client === 'Trish Cavanagh' && n(debtors[0].oldest_days) === 68, 'Trish is oldest at 68 days');

  const invoices = run('invoices --unpaid', ['vet.mjs', 'invoices', '--unpaid']);
  assert(invoices.length === 3, `three unpaid (${invoices.length})`);

  // ---- recalls ----------------------------------------------------------------

  const remindersBefore = run('reminders', ['vet.mjs', 'reminders']);
  assert(remindersBefore.length === 8, `six overdue plus two due soon (${remindersBefore.length})`);
  assert(remindersBefore.some((r) => r.patient === 'Juno' && r.state === 'LONG OVERDUE'), 'Juno is long overdue');

  run('record the vaccination just given', ['vet.mjs', 'vacc', 'add', 'Juno', '--vaccine=Canine DHP', '--vet=Cole', `--due=${addDays(todayIso, 365)}`]);
  const remindersAfter = run('reminders after the vaccination', ['vet.mjs', 'reminders']);
  assert(!remindersAfter.some((r) => r.patient === 'Juno'), 'Juno has left the recall list');

  const lapsed = run('lapsed', ['vet.mjs', 'lapsed']);
  assert(lapsed.length === 2 && lapsed[0].patient === 'Rusty', 'Rusty and Minka, biggest lifetime first');

  // ---- the shelf and the register ---------------------------------------------

  const stock = run('stock (alerts)', ['vet.mjs', 'stock']);
  assert(stock.some((s) => s.code === 'AMOX-250' && s.state === 'EXPIRED BATCH'), 'the expired batch is loud');
  assert(stock.some((s) => s.code === 'BRAV-L' && s.state === 'low'), 'Bravecto is low');

  const gateCdReceive = run('receiving a controlled drug without a name is refused', ['vet.mjs', 'stock', 'receive', 'METH-10', '--qty=5'], { json: false, expectFail: true });
  assert(/register/.test(gateCdReceive.stderr), 'the register wants to know who');
  const received = run('receive it properly', ['vet.mjs', 'stock', 'receive', 'METH-10', '--qty=5', '--staff=Cole', '--note=Invoice 90210, ProVet wholesale']);
  assert(n(received.stock_qty) === 23, 'shelf is 23');
  const methCheck = run('methadone still reconciles', ['vet.mjs', 'register', 'check']);
  assert(n(methCheck.find((r) => r.code === 'METH-10').discrepancy) === 0, 'both sides moved together');

  run('receive plain stock', ['vet.mjs', 'stock', 'receive', 'BRAV-L', '--qty=10', '--batch=BV-5720', `--expires=${addDays(todayIso, 500)}`]);

  const gateWitness = run('disposal without a witness is refused', ['vet.mjs', 'register', 'dispose', 'KET-100', '--qty=1', '--staff=Cole'], { json: false, expectFail: true });
  assert(/witness/.test(gateWitness.stderr) && /No force flag/.test(gateWitness.stderr), 'destruction is witnessed, always');
  const disposed = run('dispose with a witness', ['vet.mjs', 'register', 'dispose', 'KET-100', '--qty=1', '--staff=Cole', '--witness=Bex Harmon', '--note=Expired draw-up, sharps bin']);
  assert(n(disposed.balance_after) === 43.5, 'the register balance carries');

  // ---- notes ------------------------------------------------------------------

  run('a file note', ['vet.mjs', 'note', 'add', 'Banjo', 'Trish called: will pay the dental account Friday. Third promise on file.', '--staff=Ngata']);
  const notes = run('notes read back', ['vet.mjs', 'notes', 'Banjo']);
  assert(notes.some((x) => /Third promise/.test(x.note)), 'the note landed');

  // ---- import: ezyVet CSVs ----------------------------------------------------

  const clientsCsv = path.join(dataDir, 'clients.csv');
  const patientsCsv = path.join(dataDir, 'animals.csv');
  writeFileSync(clientsCsv, [
    'Code,First Name,Last Name,Email,Mobile,Physical Address,Suburb',
    'EZ-C1,Nina,Vega,nina.vega@example.nz,021 555 0901,7 Grange Road,Otumoetai',
    'EZ-C2,Alan,Petrie,alan.petrie@example.nz,021 555 0101,14 Harbour View Road,Otumoetai',
  ].join('\n'));
  writeFileSync(patientsCsv, [
    'Code,Name,Species,Breed,Sex,Date of Birth,Microchip Number,Owner',
    'EZ-A1,Otis,Dog,Whippet,Male,12/03/2022,985113004419901,Nina Vega',
    'EZ-A2,Ghost,Cat,Domestic Short Hair,Male,,985113004419902,Somebody Unknown',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['vet.mjs', 'import', 'ezyvet', `--clients=${clientsCsv}`, `--patients=${patientsCsv}`, '--dry-run']);
  assert(n(dry.clients) === 1 && n(dry.clients_updated) === 1, 'one new client, Alan matched');
  assert(dry.skips.length === 2, `Otis (owner not written yet) and Ghost are named skips (${dry.skips.length}: ${dry.skips.join(' | ')})`);

  const imported = run('import for real', ['vet.mjs', 'import', 'ezyvet', `--clients=${clientsCsv}`, `--patients=${patientsCsv}`]);
  assert(n(imported.clients) === 1 && n(imported.patients) === 1, 'Nina and Otis are in');
  assert(imported.skips.length === 1 && /Ghost/.test(imported.skips[0]), 'Ghost still skips: his owner is a question for the old data');

  const reimport = run('re-importing updates rather than duplicating', ['vet.mjs', 'import', 'ezyvet', `--clients=${clientsCsv}`, `--patients=${patientsCsv}`]);
  assert(n(reimport.clients) === 0 && n(reimport.clients_updated) === 2 && n(reimport.patients) === 0 && n(reimport.patients_updated) === 1, 'the second run creates nothing new');

  const missingFile = run('a missing import file fails loudly', ['vet.mjs', 'import', 'ezyvet', `--clients=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No clients file/.test(missingFile.stderr), 'rather than importing nothing quietly');

  // ---- export ------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['vet.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.consults.length === n(dump.counts.consults), 'the counts match the file');
  assert(parsed.drug_register.length >= 8, 'the register comes out too');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]week\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const weekHtml = readFileSync(path.join(root, 'views', 'week.html'), 'utf8');
  assert(weekHtml.includes('Needs a decision') && weekHtml.includes('The week ahead'), 'the week view has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/vaccination-certificate/.test(docsOut.stdout), 'vaccination certificates rendered');
  assert(/client-statement/.test(docsOut.stdout), 'client statements rendered');
  assert(/clinical-history/.test(docsOut.stdout), 'clinical histories rendered');
  assert(/drug-register/.test(docsOut.stdout), 'the controlled drug register rendered');

  // ---- the human readable side ------------------------------------------------------

  run('stats (text)', ['vet.mjs', 'stats'], { json: false });
  run('book (text)', ['vet.mjs', 'book'], { json: false });
  run('clients (text)', ['vet.mjs', 'clients'], { json: false });
  run('client (text)', ['vet.mjs', 'client', 'Weir'], { json: false });
  run('patients (text)', ['vet.mjs', 'patients'], { json: false });
  run('patient (text)', ['vet.mjs', 'patient', 'Baxter'], { json: false });
  run('staff (text)', ['vet.mjs', 'staff'], { json: false });
  run('consults (text)', ['vet.mjs', 'consults'], { json: false });
  run('reminders (text)', ['vet.mjs', 'reminders'], { json: false });
  run('lapsed (text)', ['vet.mjs', 'lapsed'], { json: false });
  run('invoices (text)', ['vet.mjs', 'invoices'], { json: false });
  run('debtors (text)', ['vet.mjs', 'debtors'], { json: false });
  run('unbilled (text)', ['vet.mjs', 'unbilled'], { json: false });
  run('items (text)', ['vet.mjs', 'items'], { json: false });
  run('stock (text)', ['vet.mjs', 'stock'], { json: false });
  run('register (text)', ['vet.mjs', 'register'], { json: false });
  run('register check (text)', ['vet.mjs', 'register', 'check'], { json: false });
  run('attention (text)', ['vet.mjs', 'attention'], { json: false });
  run('compliance (text)', ['vet.mjs', 'compliance'], { json: false });
  run('help', ['vet.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['vet.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}

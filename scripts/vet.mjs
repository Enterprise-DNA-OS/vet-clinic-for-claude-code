#!/usr/bin/env node
// vet-clinic-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/vet.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a New Zealand small-animal clinic's operating record the way
// ezyVet sells it: the clients (owners), the patients, the vets with their
// practising certificates, the appointment book, the consults with their
// clinical notes and charges, the vaccination record that drives the recall
// list, the invoices, the stock, and the controlled drug register. It sends
// nothing and connects to nothing: reminder letters and estimates draft to
// drafts/, and a person sends them.
//
// The gates, and there are no force flags:
//   * no booking or consulting under a vet whose practising certificate is
//     missing or expired on the day (Veterinarians Act 2005 s 18)
//   * no completing a consult without clinical notes (VCNZ Code of
//     Professional Conduct: the record is the evidence of care)
//   * no completing a surgery or dental without consent on record
//   * no dispensing a restricted veterinary medicine outside a vet's consult
//     (ACVM Act 1997)
//   * a controlled drug movement IS a register entry, the register is
//     append-only, and the balance never goes negative
//     (Misuse of Drugs Regulations 1977)
//   * no dispensing from an expired batch
//   * no deleting records: patients become deceased, staff become former

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'week', 'open', 'unbilled', 'unpaid', 'check']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates, times, money

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand exports write DD/MM/YYYY: the first number is the day unless
  // the second is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseTime(v, what = 'time') {
  if (!v || v === true) throw new CliError(`A ${what} is required (HH:MM, 24 hour).`);
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) throw new CliError(`"${v}" is not a ${what}. Use HH:MM, 24 hour.`);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) throw new CliError(`"${v}" is not a ${what}.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not a ${what}. Money in dollars: 89.00 means $89.00.`);
  return Math.round(n * 100);
}

function parseQty(v, what = 'quantity') {
  if (v === undefined || v === null || v === '' || v === true) throw new CliError(`A ${what} is required.`);
  const n = Number(v);
  if (Number.isNaN(n) || n <= 0) throw new CliError(`"${v}" is not a ${what}. Use a positive number.`);
  return n;
}

// ---------------------------------------------------------------------------
// Lookups: partial, case-insensitive, loud when ambiguous

async function resolveRow(db, sql, params, label, name) {
  const rows = await db.query(sql, params);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No ${label} matches "${name}".`);
  const list = rows.slice(0, 10).map((r) => `  ${r.ref ? r.ref + '  ' : ''}${r.name || ''}${r.owner ? '  (' + r.owner + ')' : ''}`).join('\n');
  throw new CliError(`"${name}" matches ${rows.length} ${label} records. Which one?\n${list}`);
}

async function resolveClient(db, name) {
  if (!name) throw new CliError('Which client? Give a name (partial is fine).');
  const n = String(name).trim();
  const exact = await db.query('select * from clients where lower(name) = lower($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from clients where name ilike $1 order by name', [`%${n}%`], 'client', n);
}

async function resolvePatient(db, name) {
  if (!name) throw new CliError('Which patient? Give a name (partial is fine), a ref like PT-101, or a microchip number.');
  const n = String(name).trim();
  const exact = await db.query(
    `select p.*, c.name as owner from patients p join clients c on c.id = p.client_id
     where lower(p.name) = lower($1) or upper(p.ref) = upper($1) or p.microchip = $1`, [n]);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return resolveRow(db, `select p.*, c.name as owner from patients p join clients c on c.id = p.client_id where lower(p.name) = lower($1) order by p.name`, [n], 'patient', n);
  return resolveRow(db,
    `select p.*, c.name as owner from patients p join clients c on c.id = p.client_id where p.name ilike $1 order by p.name`,
    [`%${n}%`], 'patient', n);
}

async function resolveStaff(db, name) {
  if (!name) throw new CliError('Which staff member? Give a name (partial is fine).');
  const n = String(name).trim();
  const exact = await db.query('select * from staff where lower(name) = lower($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from staff where name ilike $1 order by name', [`%${n}%`], 'staff', n);
}

async function resolveItem(db, code) {
  if (!code) throw new CliError('Which item? Give a code like CONS-STD or a name (partial is fine).');
  const n = String(code).trim();
  const exact = await db.query('select * from items where upper(code) = upper($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from items where name ilike $1 or code ilike $1 order by code', [`%${n}%`], 'item', n);
}

async function resolveByRef(db, tableName, prefix, ref, label) {
  if (!ref) throw new CliError(`Which ${label}? Give its ref, like ${prefix}-101.`);
  let r = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(r)) r = `${prefix}-${r}`;
  const rows = await db.query(`select * from ${tableName} where upper(ref) = $1`, [r]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No ${label} with ref "${r}".`);
}

async function nextRef(db, tableName, prefix, start) {
  const [row] = await db.query(
    `select coalesce(max(substring(ref from '${prefix}-(\\d+)')::int), $1) + 1 as n from ${tableName} where ref like '${prefix}-%'`,
    [start - 1],
  );
  return `${prefix}-${row.n}`;
}

// ---------------------------------------------------------------------------
// The gates

// A vet consults and books only with a current practising certificate on the
// day. Veterinarians Act 2005 s 18. No force flag.
function gateVet(staffRow, onDate, doing) {
  if (staffRow.status !== 'active') {
    throw new CliError(`${staffRow.name} is marked ${staffRow.status} and cannot ${doing}.`);
  }
  if (staffRow.role !== 'vet') {
    throw new CliError(`${staffRow.name} is a ${staffRow.role}, not a vet, and cannot ${doing}. Consults, procedures and restricted medicines need a vet.`);
  }
  const apc = staffRow.apc_expires_on ? isoDate(staffRow.apc_expires_on) : null;
  if (!apc || apc < onDate) {
    throw new CliError(
      `${staffRow.name}'s practising certificate ${!apc ? 'is not on record' : `expired ${apc}`}, so they cannot ${doing} on ${onDate}. ` +
      `A vet practises only with a current practising certificate (Veterinarians Act 2005 s 18). Renew it with the Council, or use another vet. No force flag.`,
    );
  }
}

async function gateNoOverlap(db, staffId, onDate, startsAt, minutes, staffName) {
  const clash = await db.query(
    `select a.ref, a.starts_at, a.minutes, p.name as patient from appointments a join patients p on p.id = a.patient_id
     where a.staff_id = $1 and a.on_date = $2 and a.status = 'scheduled'
       and a.starts_at < ($3::time + make_interval(mins => $4::int))::time
       and ($3::time < (a.starts_at + make_interval(mins => a.minutes))::time)`,
    [staffId, onDate, startsAt, minutes],
  );
  if (clash.length) {
    const c = clash[0];
    throw new CliError(`${staffName} is already booked at ${String(c.starts_at).slice(0, 5)} that day (${c.ref}, ${c.patient}). A vet is not in two rooms at once.`);
  }
}

// ---------------------------------------------------------------------------
// Output

let asJson = false;

function out(rows, columns) {
  if (asJson) {
    console.log(JSON.stringify(rows, jsonDates, 2));
    return;
  }
  if (Array.isArray(rows)) console.log(table(rows, columns));
  else console.log(rows);
}

function jsonDates(key, value) {
  return value;
}

function plain(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[k] = v instanceof Date ? isoDate(v) : v;
  return o;
}

const plainAll = (rows) => rows.map(plain);

// ---------------------------------------------------------------------------
// Commands

const commands = {};

commands.help = async () => {
  console.log(`vet-clinic-for-claude-code: the clinic as a database and a CLI.

  the day
    book [--on=DATE] [--week] [--vet=NAME]     the appointment book, plus anything unresolved
    appt add PATIENT --vet= --on= --at= [--minutes=30] [--type=consult] [--reason=]
    appt cancel REF --reason=                  appt noshow REF
    attention                                  everything that wants a decision, worst first

  the records
    clients [--all]        client NAME         patients [--all] [--species=]
    patient NAME|REF|CHIP                      the whole card: history, weights, vaccines, money
    patient deceased NAME [--on=]              staff [--all]
    note add PATIENT TEXT [--staff=]           notes PATIENT

  the consult room
    consult open PATIENT --vet= [--appt=REF] [--type=] [--reason=]
    consult add REF ITEM [--qty=1] [--price=] [--note=]
    consult done REF --notes= [--weight=] [--recheck=] [--consent[=DATE]]
    consults [--open] [--unbilled] [--all]
    vacc add PATIENT --vaccine= --vet= [--given=today] [--due=]

  the money
    invoice build CONSULT-REF [--due=]         invoice paid REF [--on=]
    invoices [--unpaid] [--all]                debtors        unbilled

  the shelf
    items                  stock [--all]       stock receive ITEM --qty= [--batch=] [--expires=] [--staff=]
    register [ITEM]        register check      register dispose ITEM --qty= --staff= --witness= [--note=]

  the recalls
    reminders [--days=30] [--all]              lapsed

  the rules
    compliance [RULE]                          the rule book, run against the records

  moving in and out
    import ezyvet --clients=FILE [--patients=FILE] [--dry-run]
    export [--out=FILE]                        stats

Any read command takes --json. Money in NZD. There are no force flags.`);
};

// ---- stats ---------------------------------------------------------------

commands.stats = async (db) => {
  const [s] = await db.query(`
    select
      (select count(*) from clients where status = 'active') as active_clients,
      (select count(*) from patients where status = 'active') as active_patients,
      (select count(*) from staff where status = 'active') as active_staff,
      (select count(*) from staff where status = 'active' and role = 'vet') as vets,
      (select count(*) from appointments where status = 'scheduled' and on_date = current_date) as appts_today,
      (select count(*) from appointments where status = 'scheduled' and on_date between current_date and current_date + 7) as appts_next_7d,
      (select count(*) from consults where status = 'open') as open_consults,
      (select coalesce(sum(value_cents), 0) from v_consults where state = 'unbilled' and status = 'completed')::bigint as unbilled_cents,
      (select coalesce(sum(total_cents), 0) from v_invoices where status = 'issued')::bigint as outstanding_cents,
      (select count(*) from v_reminders where state in ('OVERDUE', 'LONG OVERDUE')) as recalls_overdue,
      (select count(*) from v_register_balances where discrepancy <> 0) as register_discrepancies
  `);
  const r = plain(s);
  if (asJson) return console.log(JSON.stringify(r, null, 2));
  console.log(heading('Harbourview at a glance'));
  console.log(`  clients ${r.active_clients} active  ·  patients ${r.active_patients}  ·  staff ${r.active_staff} (${r.vets} vets)`);
  console.log(`  today ${r.appts_today} appointment(s), next 7 days ${r.appts_next_7d}  ·  open consults ${r.open_consults}`);
  console.log(`  unbilled ${money(r.unbilled_cents)}  ·  outstanding ${money(r.outstanding_cents)}  ·  recalls overdue ${r.recalls_overdue}`);
  if (num(r.register_discrepancies) > 0) console.log(`  CONTROLLED DRUG REGISTER: ${r.register_discrepancies} discrepancy(ies). Run: register check`);
};

// ---- the book ------------------------------------------------------------

commands.book = async (db, args, flags) => {
  const onDate = flags.week ? null : parseDate(flags.on) || today();
  let sql = `select * from v_appointments where 1=1`;
  const params = [];
  if (flags.week) {
    sql += ` and ((on_date between current_date and current_date + 7 and status = 'scheduled') or state = 'UNCONFIRMED')`;
  } else if (flags.all) {
    // everything
  } else {
    params.push(onDate);
    sql += ` and ((on_date = $${params.length} and status = 'scheduled') or state = 'UNCONFIRMED')`;
  }
  if (flags.vet) {
    const vet = await resolveStaff(db, flags.vet);
    params.push(vet.id);
    sql += ` and staff_id = $${params.length}`;
  }
  sql += ` order by on_date, starts_at`;
  const rows = plainAll(await db.query(sql, params));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'on_date', label: 'date', format: isoDate },
    { key: 'starts_at', label: 'at', format: (v) => String(v).slice(0, 5) },
    { key: 'patient', label: 'patient' },
    { key: 'client', label: 'owner' },
    { key: 'vet', label: 'vet' },
    { key: 'type', label: 'type' },
    { key: 'reason', label: 'reason', width: 34, format: (v) => truncate(v, 34) },
    { key: 'state', label: 'state' },
  ]);
};

commands.appt = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'add') {
    const patient = await resolvePatient(db, args[1]);
    if (patient.status !== 'active') {
      throw new CliError(`${patient.name} is marked ${patient.status}. A ${patient.status} patient does not book; the record stays, the bookings stop.`);
    }
    const vet = await resolveStaff(db, str(flags.vet));
    const onDate = parseDate(flags.on, 'appointment date') || today();
    const startsAt = parseTime(flags.at, 'start time');
    const minutes = flags.minutes ? Math.max(5, Math.round(num(flags.minutes))) : 30;
    gateVet(vet, onDate, 'take an appointment');
    await gateNoOverlap(db, vet.id, onDate, startsAt, minutes, vet.name);
    const type = str(flags.type) || 'consult';
    if (!['consult', 'vaccination', 'surgery', 'dental', 'recheck'].includes(type)) {
      throw new CliError(`"${type}" is not an appointment type. Use consult, vaccination, surgery, dental or recheck.`);
    }
    const ref = await nextRef(db, 'appointments', 'AP', 1001);
    const [row] = await db.query(
      `insert into appointments (ref, patient_id, staff_id, on_date, starts_at, minutes, type, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [ref, patient.id, vet.id, onDate, startsAt, minutes, type, str(flags.reason) || null],
    );
    const r = plain({ ...row, patient: patient.name, vet: vet.name });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ref}: ${patient.name} with ${vet.name}, ${onDate} ${startsAt} (${minutes} min, ${type}).`);
  }
  if (sub === 'cancel' || sub === 'noshow') {
    const appt = await resolveByRef(db, 'appointments', 'AP', args[1], 'appointment');
    if (appt.status !== 'scheduled') throw new CliError(`${appt.ref} is already ${appt.status}.`);
    if (sub === 'cancel' && !str(flags.reason)) throw new CliError('Why is it cancelled? --reason= goes on the record.');
    const [row] = await db.query(
      `update appointments set status = $2, cancel_reason = $3 where id = $1 returning *`,
      [appt.id, sub === 'cancel' ? 'cancelled' : 'no_show', str(flags.reason) || null],
    );
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${appt.ref}: ${row.status}.`);
  }
  throw new CliError('Usage: appt add PATIENT --vet= --on= --at=  |  appt cancel REF --reason=  |  appt noshow REF');
};

// ---- clients and patients ------------------------------------------------

commands.clients = async (db, args, flags) => {
  const rows = plainAll(await db.query(
    `select c.name, c.phone, c.suburb, c.status,
            (select count(*) from patients p where p.client_id = c.id and p.status = 'active') as patients,
            (select coalesce(sum(i.total_cents), 0) from invoices i where i.client_id = c.id and i.status = 'issued')::bigint as owing_cents,
            (select max(cn.on_date) from consults cn join patients p on p.id = cn.patient_id where p.client_id = c.id and cn.status = 'completed') as last_visit_on
     from clients c ${flags.all ? '' : `where c.status = 'active'`} order by c.name`,
  ));
  out(rows, [
    { key: 'name', label: 'client' },
    { key: 'phone', label: 'phone' },
    { key: 'suburb', label: 'suburb' },
    { key: 'patients', label: 'patients', align: 'right' },
    { key: 'owing_cents', label: 'owing', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'last_visit_on', label: 'last visit', format: isoDate },
    { key: 'status', label: 'status' },
  ]);
};

commands.client = async (db, args) => {
  const client = await resolveClient(db, args[0]);
  const patients = plainAll(await db.query(`select * from v_patients where client_id = $1 order by name`, [client.id]));
  const invoices = plainAll(await db.query(`select * from v_invoices where client_id = $1 order by issued_on desc limit 12`, [client.id]));
  const notes = plainAll(await db.query(
    `select fn.noted_on, s.name as staff, fn.note from file_notes fn left join staff s on s.id = fn.staff_id
     where fn.client_id = $1 order by fn.noted_on desc limit 8`, [client.id]));
  const appts = plainAll(await db.query(
    `select * from v_appointments where client = $1 and (state in ('today', 'scheduled', 'UNCONFIRMED') or status = 'no_show') order by on_date`, [client.name]));
  const result = { client: plain(client), patients, appointments: appts, invoices, notes };
  if (asJson) return console.log(JSON.stringify(result, null, 2));
  console.log(heading(`${client.name}  (${client.status})`));
  console.log(`  ${client.phone || ''}  ${client.email || ''}  ${[client.address, client.suburb].filter(Boolean).join(', ')}`);
  console.log(heading('Patients'));
  console.log(table(patients, [
    { key: 'ref', label: 'ref' },
    { key: 'name', label: 'name' },
    { key: 'species', label: 'species' },
    { key: 'breed', label: 'breed' },
    { key: 'age_years', label: 'age', align: 'right' },
    { key: 'last_seen_on', label: 'last seen', format: isoDate },
    { key: 'next_vacc_due_on', label: 'vacc due', format: isoDate },
    { key: 'status', label: 'status' },
  ]));
  console.log(heading('Invoices'));
  console.log(table(invoices, [
    { key: 'ref', label: 'ref' },
    { key: 'patient', label: 'patient' },
    { key: 'issued_on', label: 'issued', format: isoDate },
    { key: 'total_cents', label: 'total', align: 'right', format: money },
    { key: 'state', label: 'state' },
  ]));
  if (appts.length) {
    console.log(heading('Appointments'));
    console.log(table(appts, [
      { key: 'ref', label: 'ref' },
      { key: 'on_date', label: 'date', format: isoDate },
      { key: 'patient', label: 'patient' },
      { key: 'vet', label: 'vet' },
      { key: 'state', label: 'state' },
    ]));
  }
  if (notes.length) {
    console.log(heading('File notes'));
    for (const n of notes) console.log(`  ${isoDate(n.noted_on)}  ${n.staff || ''}: ${n.note}`);
  }
};

commands.patients = async (db, args, flags) => {
  let sql = `select * from v_patients where 1=1`;
  const params = [];
  if (!flags.all) sql += ` and status = 'active'`;
  if (flags.species) {
    params.push(String(flags.species).toLowerCase());
    sql += ` and species = $${params.length}`;
  }
  sql += ` order by name`;
  const rows = plainAll(await db.query(sql, params));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'name', label: 'name' },
    { key: 'species', label: 'species' },
    { key: 'breed', label: 'breed', width: 18 },
    { key: 'client', label: 'owner' },
    { key: 'last_seen_on', label: 'last seen', format: isoDate },
    { key: 'next_appt_on', label: 'next appt', format: isoDate },
    { key: 'next_vacc_due_on', label: 'vacc due', format: isoDate },
    { key: 'microchip', label: 'chip', format: (v) => (v ? 'yes' : 'NONE') },
    { key: 'status', label: 'status' },
  ]);
};

commands.patient = async (db, args, flags) => {
  if (args[0] === 'deceased') {
    const patient = await resolvePatient(db, args[1]);
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(
      `update patients set status = 'deceased', deceased_on = $2 where id = $1 returning *`, [patient.id, on]);
    if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
    return console.log(`${patient.name} marked deceased ${on}. The record stays: the Code keeps it, and so do we.`);
  }
  const patient = await resolvePatient(db, args[0]);
  const [card] = await db.query(`select * from v_patients where patient_id = $1`, [patient.id]);
  const consults = plainAll(await db.query(`select * from v_consults where patient_id = $1 order by on_date desc limit 12`, [patient.id]));
  const weights = plainAll(await db.query(
    `select on_date, weight_kg from consults where patient_id = $1 and weight_kg is not null order by on_date`, [patient.id]));
  const vaccs = plainAll(await db.query(
    `select v.vaccine, v.given_on, v.due_on, s.name as vet from vaccinations v join staff s on s.id = v.staff_id
     where v.patient_id = $1 order by v.given_on desc`, [patient.id]));
  const notes = plainAll(await db.query(
    `select fn.noted_on, s.name as staff, fn.note from file_notes fn left join staff s on s.id = fn.staff_id
     where fn.patient_id = $1 order by fn.noted_on desc limit 8`, [patient.id]));
  const result = { patient: plain(card), consults, weights, vaccinations: vaccs, notes };
  if (asJson) return console.log(JSON.stringify(result, null, 2));
  const c = plain(card);
  console.log(heading(`${c.name}  ${c.ref}  (${c.status})`));
  console.log(`  ${c.species}, ${c.breed || ''}, ${c.sex || ''}, ${c.age_years ?? '?'} years  ·  owner ${c.client} ${c.phone || ''}`);
  console.log(`  microchip ${c.microchip || 'NONE ON RECORD'}  ·  last weight ${c.last_weight_kg ? c.last_weight_kg + ' kg' : 'never weighed'}  ·  lifetime ${money(c.lifetime_cents)}`);
  if (weights.length > 1) {
    console.log(heading('Weight'));
    for (const w of weights) console.log(`  ${isoDate(w.on_date)}  ${w.weight_kg} kg`);
  }
  console.log(heading('Vaccinations'));
  console.log(table(vaccs, [
    { key: 'vaccine', label: 'vaccine' },
    { key: 'given_on', label: 'given', format: isoDate },
    { key: 'due_on', label: 'next due', format: isoDate },
    { key: 'vet', label: 'vet' },
  ]));
  console.log(heading('History'));
  console.log(table(consults, [
    { key: 'ref', label: 'ref' },
    { key: 'on_date', label: 'date', format: isoDate },
    { key: 'type', label: 'type' },
    { key: 'reason', label: 'reason', width: 30, format: (v) => truncate(v, 30) },
    { key: 'vet', label: 'vet' },
    { key: 'value_cents', label: 'value', align: 'right', format: money },
    { key: 'state', label: 'state' },
  ]));
  if (notes.length) {
    console.log(heading('File notes'));
    for (const n of notes) console.log(`  ${isoDate(n.noted_on)}  ${n.staff || ''}: ${n.note}`);
  }
};

commands.staff = async (db, args, flags) => {
  const rows = plainAll(await db.query(
    `select * from v_staff ${flags.all ? '' : `where status = 'active'`} order by role, name`));
  out(rows, [
    { key: 'name', label: 'name' },
    { key: 'role', label: 'role' },
    { key: 'employment', label: 'employment' },
    { key: 'registration_number', label: 'reg no' },
    { key: 'apc_expires_on', label: 'APC expires', format: isoDate },
    { key: 'apc', label: 'APC' },
    { key: 'appts_next_7d', label: 'appts 7d', align: 'right' },
    { key: 'consults_last_28d', label: 'consults 28d', align: 'right' },
    { key: 'billed_last_28d_cents', label: 'billed 28d', align: 'right', format: money },
    { key: 'status', label: 'status' },
  ]);
};

// ---- the consult room ----------------------------------------------------

commands.consult = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'open') {
    const patient = await resolvePatient(db, args[1]);
    if (patient.status !== 'active') throw new CliError(`${patient.name} is marked ${patient.status}.`);
    const vet = await resolveStaff(db, str(flags.vet));
    const onDate = parseDate(flags.on) || today();
    gateVet(vet, onDate, 'run a consult');
    let appointmentId = null;
    let type = str(flags.type) || 'consult';
    if (flags.appt) {
      const appt = await resolveByRef(db, 'appointments', 'AP', str(flags.appt), 'appointment');
      appointmentId = appt.id;
      type = str(flags.type) || appt.type;
    }
    if (!['consult', 'vaccination', 'surgery', 'dental', 'recheck'].includes(type)) {
      throw new CliError(`"${type}" is not a consult type. Use consult, vaccination, surgery, dental or recheck.`);
    }
    const ref = await nextRef(db, 'consults', 'CN', 2001);
    const [row] = await db.query(
      `insert into consults (ref, appointment_id, patient_id, staff_id, on_date, type, reason)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [ref, appointmentId, patient.id, vet.id, onDate, type, str(flags.reason) || null],
    );
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ref}: ${type} open for ${patient.name} with ${vet.name}. Add lines with: consult add ${ref} ITEM`);
  }
  if (sub === 'add') {
    const consult = await resolveByRef(db, 'consults', 'CN', args[1], 'consult');
    if (consult.status !== 'open') throw new CliError(`${consult.ref} is completed. Charges go on while the consult is open; open a new consult for new work.`);
    const item = await resolveItem(db, args[2]);
    const qty = flags.qty !== undefined ? parseQty(flags.qty) : 1;
    const price = flags.price !== undefined ? parseMoney(flags.price, 'unit price') : num(item.price_cents);
    const [vet] = await db.query('select * from staff where id = $1', [consult.staff_id]);
    if ((item.rvm || item.controlled) && vet.role !== 'vet') {
      throw new CliError(`${item.name} is a restricted veterinary medicine and ${vet.name} is a ${vet.role}. RVMs are dispensed only under a vet's authorisation (ACVM Act 1997). No force flag.`);
    }
    if (item.track_stock) {
      const expires = item.batch_expires_on ? isoDate(item.batch_expires_on) : null;
      if (expires && expires < today()) {
        throw new CliError(`Batch ${item.batch_no || '?'} of ${item.name} expired ${expires}. An expired batch is not dispensed; quarantine it and receive fresh stock. No force flag.`);
      }
      if (num(item.stock_qty) < qty) {
        throw new CliError(`Only ${item.stock_qty} ${item.unit} of ${item.name} on the shelf; cannot dispense ${qty}. Receive stock first: stock receive ${item.code} --qty=`);
      }
    }
    if (item.controlled) {
      // A controlled drug movement IS a register entry: same transaction of
      // thought, never optional (Misuse of Drugs Regulations 1977).
      const [bal] = await db.query(`select register_qty from v_register_balances where item_id = $1`, [item.id]);
      const registerQty = num(bal && bal.register_qty);
      if (registerQty < qty) {
        throw new CliError(`The ${item.name} register holds ${registerQty} ${item.unit}; cannot dispense ${qty}. The balance never goes negative: receive it into the register first.`);
      }
      await db.query(
        `insert into drug_register (item_id, entry_on, movement, qty, balance_after, patient_id, consult_id, staff_id, note)
         values ($1, $2, 'dispensed', $3, $4, $5, $6, $7, $8)`,
        [item.id, isoDate(consult.on_date), qty, registerQty - qty, consult.patient_id, consult.id, consult.staff_id, str(flags.note) || null],
      );
    }
    if (item.track_stock) {
      await db.query(`update items set stock_qty = stock_qty - $2 where id = $1`, [item.id, qty]);
    }
    const [line] = await db.query(
      `insert into consult_lines (consult_id, item_id, qty, unit_price_cents, note)
       values ($1, $2, $3, $4, $5) returning *`,
      [consult.id, item.id, qty, price, str(flags.note) || null],
    );
    const r = plain({ ...line, item: item.name, code: item.code, total_cents: Math.round(qty * price) });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${consult.ref}: ${qty} x ${item.name} at ${money(price)} = ${money(qty * price)}${item.controlled ? ' (register written)' : ''}.`);
  }
  if (sub === 'done') {
    const consult = await resolveByRef(db, 'consults', 'CN', args[1], 'consult');
    if (consult.status !== 'open') throw new CliError(`${consult.ref} is already completed.`);
    const notes = str(flags.notes).trim();
    if (!notes) {
      throw new CliError(`${consult.ref} does not complete without clinical notes. The record is the evidence of care (VCNZ Code of Professional Conduct). --notes= what you found and what you did. No force flag.`);
    }
    let consentOn = null;
    if (['surgery', 'dental'].includes(consult.type)) {
      if (flags.consent === undefined) {
        throw new CliError(`${consult.ref} is a ${consult.type}: it does not complete without consent on record. --consent (today) or --consent=DATE the form was signed. No force flag.`);
      }
      consentOn = flags.consent === true ? today() : parseDate(flags.consent, 'consent date');
    } else if (flags.consent !== undefined) {
      consentOn = flags.consent === true ? today() : parseDate(flags.consent, 'consent date');
    }
    const weight = flags.weight !== undefined ? parseQty(flags.weight, 'weight in kg') : null;
    const recheck = parseDate(flags.recheck, 'recheck date');
    const [row] = await db.query(
      `update consults set status = 'completed', notes = $2, weight_kg = coalesce($3, weight_kg), recheck_on = $4, consent_on = $5
       where id = $1 returning *`,
      [consult.id, notes, weight, recheck, consentOn],
    );
    if (row.appointment_id) {
      await db.query(`update appointments set status = 'completed' where id = $1 and status = 'scheduled'`, [row.appointment_id]);
    }
    const [v] = await db.query(`select value_cents, patient from v_consults where consult_id = $1`, [consult.id]);
    const r = plain({ ...row, value_cents: num(v.value_cents) });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${consult.ref}: completed, ${money(v.value_cents)} on the sheet. Invoice it: invoice build ${consult.ref}`);
  }
  throw new CliError('Usage: consult open PATIENT --vet=  |  consult add REF ITEM [--qty=]  |  consult done REF --notes= [--consent]');
};

commands.consults = async (db, args, flags) => {
  let where = `on_date >= current_date - 30 or status = 'open'`;
  if (flags.open) where = `status = 'open' or state = 'OPEN STALE'`;
  if (flags.unbilled) where = `state = 'unbilled' and status = 'completed'`;
  if (flags.all) where = `1=1`;
  const rows = plainAll(await db.query(`select * from v_consults where ${where} order by on_date desc`));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'on_date', label: 'date', format: isoDate },
    { key: 'patient', label: 'patient' },
    { key: 'client', label: 'owner' },
    { key: 'vet', label: 'vet' },
    { key: 'type', label: 'type' },
    { key: 'reason', label: 'reason', width: 28, format: (v) => truncate(v, 28) },
    { key: 'value_cents', label: 'value', align: 'right', format: money },
    { key: 'state', label: 'state' },
  ]);
};

commands.vacc = async (db, args, flags) => {
  if (args[0] !== 'add') throw new CliError('Usage: vacc add PATIENT --vaccine= --vet= [--given=today] [--due=]');
  const patient = await resolvePatient(db, args[1]);
  const vaccine = str(flags.vaccine).trim();
  if (!vaccine) throw new CliError('Which vaccine? --vaccine="Canine DHP"');
  const vet = await resolveStaff(db, str(flags.vet));
  if (vet.role !== 'vet') throw new CliError(`${vet.name} is a ${vet.role}. A vaccination is recorded under the vet who gave or directed it.`);
  const given = parseDate(flags.given) || today();
  const due = parseDate(flags.due, 'due date');
  const [row] = await db.query(
    `insert into vaccinations (patient_id, consult_id, staff_id, vaccine, given_on, due_on)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [patient.id, null, vet.id, vaccine, given, due],
  );
  const r = plain(row);
  if (asJson) return console.log(JSON.stringify(r, null, 2));
  return console.log(`${patient.name}: ${vaccine} given ${given}${due ? ', next due ' + due : ''} (${vet.name}).`);
};

commands.reminders = async (db, args, flags) => {
  const days = flags.days !== undefined ? Math.round(num(flags.days)) : 30;
  const where = flags.all ? `1=1` : `due_on <= current_date + ${days}`;
  const rows = plainAll(await db.query(
    `select * from v_reminders where ${where} order by due_on`));
  out(rows, [
    { key: 'patient', label: 'patient' },
    { key: 'species', label: 'species' },
    { key: 'client', label: 'owner' },
    { key: 'phone', label: 'phone' },
    { key: 'vaccine', label: 'vaccine' },
    { key: 'due_on', label: 'due', format: isoDate },
    { key: 'days_overdue', label: 'overdue', align: 'right', format: (v) => (num(v) > 0 ? `${v}d` : '') },
    { key: 'next_appt_on', label: 'booked', format: (v) => (v ? isoDate(v) : 'NO') },
    { key: 'state', label: 'state' },
  ]);
};

commands.lapsed = async (db) => {
  const rows = plainAll(await db.query(`select * from v_lapsed order by lifetime_cents desc`));
  out(rows, [
    { key: 'patient', label: 'patient' },
    { key: 'species', label: 'species' },
    { key: 'client', label: 'owner' },
    { key: 'phone', label: 'phone' },
    { key: 'last_seen_on', label: 'last seen', format: isoDate },
    { key: 'days_since', label: 'days', align: 'right' },
    { key: 'lifetime_cents', label: 'lifetime', align: 'right', format: money },
  ]);
};

// ---- money ---------------------------------------------------------------

commands.invoice = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'build') {
    const consult = await resolveByRef(db, 'consults', 'CN', args[1], 'consult');
    if (consult.status !== 'completed') {
      throw new CliError(`${consult.ref} is still open. Complete it first (consult done ${consult.ref} --notes=...): the invoice bills the record, not the plan.`);
    }
    const existing = await db.query(`select ref from invoices where consult_id = $1`, [consult.id]);
    if (existing.length) throw new CliError(`${consult.ref} is already invoiced (${existing[0].ref}).`);
    const [v] = await db.query(`select * from v_consults where consult_id = $1`, [consult.id]);
    if (!num(v.line_count)) throw new CliError(`${consult.ref} has no charge lines. Add what was done first: consult add ${consult.ref} ITEM`);
    const issued = today();
    const due = parseDate(flags.due, 'due date') || addDays(issued, 14);
    const ref = await nextRef(db, 'invoices', 'INV', 3001);
    const [row] = await db.query(
      `insert into invoices (ref, client_id, consult_id, issued_on, due_on, total_cents)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [ref, v.client_id, consult.id, issued, due, num(v.value_cents)],
    );
    const r = plain({ ...row, client: v.client, patient: v.patient });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ref}: ${money(v.value_cents)} to ${v.client} for ${v.patient} (${consult.ref}), due ${due}.`);
  }
  if (sub === 'paid') {
    const inv = await resolveByRef(db, 'invoices', 'INV', args[1], 'invoice');
    if (inv.status === 'paid') throw new CliError(`${inv.ref} is already paid.`);
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(`update invoices set status = 'paid', paid_on = $2 where id = $1 returning *`, [inv.id, on]);
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${inv.ref}: paid ${on}.`);
  }
  throw new CliError('Usage: invoice build CONSULT-REF [--due=]  |  invoice paid REF [--on=]');
};

commands.invoices = async (db, args, flags) => {
  let where = `1=1`;
  if (flags.unpaid) where = `status = 'issued'`;
  else if (!flags.all) where = `status = 'issued' or issued_on >= current_date - 60`;
  const rows = plainAll(await db.query(`select * from v_invoices where ${where} order by issued_on desc`));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'client', label: 'client' },
    { key: 'patient', label: 'patient' },
    { key: 'issued_on', label: 'issued', format: isoDate },
    { key: 'due_on', label: 'due', format: isoDate },
    { key: 'total_cents', label: 'total', align: 'right', format: money },
    { key: 'state', label: 'state' },
  ]);
};

commands.debtors = async (db) => {
  const rows = plainAll(await db.query(
    `select client, phone, count(*) as invoices, sum(total_cents)::bigint as owing_cents, max(days_overdue) as oldest_days
     from v_invoices where status = 'issued' and days_overdue > 0
     group by client, phone order by max(days_overdue) desc`));
  out(rows, [
    { key: 'client', label: 'client' },
    { key: 'phone', label: 'phone' },
    { key: 'invoices', label: 'invoices', align: 'right' },
    { key: 'owing_cents', label: 'owing', align: 'right', format: money },
    { key: 'oldest_days', label: 'oldest', align: 'right', format: (v) => `${v}d` },
  ]);
};

commands.unbilled = async (db) => {
  const rows = plainAll(await db.query(
    `select ref, on_date, (current_date - on_date) as days_old, patient, client, vet, value_cents
     from v_consults where state = 'unbilled' and status = 'completed' order by on_date`));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'on_date', label: 'date', format: isoDate },
    { key: 'days_old', label: 'days', align: 'right' },
    { key: 'patient', label: 'patient' },
    { key: 'client', label: 'owner' },
    { key: 'vet', label: 'vet' },
    { key: 'value_cents', label: 'value', align: 'right', format: money },
  ]);
};

// ---- the shelf -----------------------------------------------------------

commands.items = async (db) => {
  const rows = plainAll(await db.query(`select code, name, kind, unit, price_cents, rvm, controlled, track_stock from items order by kind, code`));
  out(rows, [
    { key: 'code', label: 'code' },
    { key: 'name', label: 'name', width: 38 },
    { key: 'kind', label: 'kind' },
    { key: 'unit', label: 'unit' },
    { key: 'price_cents', label: 'price', align: 'right', format: money },
    { key: 'rvm', label: 'rvm', format: (v) => (v ? 'RVM' : '') },
    { key: 'controlled', label: 'controlled', format: (v) => (v ? 'CD' : '') },
  ]);
};

commands.stock = async (db, args, flags) => {
  if (args[0] === 'receive') {
    const item = await resolveItem(db, args[1]);
    if (!item.track_stock) throw new CliError(`${item.name} does not track stock (${item.kind}).`);
    const qty = parseQty(flags.qty);
    if (item.controlled) {
      if (!flags.staff) throw new CliError(`${item.name} is a controlled drug: --staff= who received it, for the register.`);
      const staffRow = await resolveStaff(db, str(flags.staff));
      const [bal] = await db.query(`select register_qty from v_register_balances where item_id = $1`, [item.id]);
      await db.query(
        `insert into drug_register (item_id, movement, qty, balance_after, staff_id, note)
         values ($1, 'received', $2, $3, $4, $5)`,
        [item.id, qty, num(bal && bal.register_qty) + qty, staffRow.id, str(flags.note) || null],
      );
    }
    const batch = str(flags.batch) || item.batch_no;
    const expires = parseDate(flags.expires, 'batch expiry') || (item.batch_expires_on ? isoDate(item.batch_expires_on) : null);
    const [row] = await db.query(
      `update items set stock_qty = stock_qty + $2, batch_no = $3, batch_expires_on = $4 where id = $1 returning *`,
      [item.id, qty, batch || null, expires],
    );
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${item.code}: +${qty} ${item.unit}, now ${row.stock_qty}${batch ? ', batch ' + batch : ''}${item.controlled ? ' (register written)' : ''}.`);
  }
  const rows = plainAll(await db.query(
    `select * from v_stock ${flags.all ? '' : `where state <> 'ok'`} order by case state when 'EXPIRED BATCH' then 0 when 'OUT' then 1 when 'low' then 2 else 3 end, code`));
  out(rows, [
    { key: 'code', label: 'code' },
    { key: 'name', label: 'name', width: 34 },
    { key: 'stock_qty', label: 'on hand', align: 'right' },
    { key: 'unit', label: 'unit' },
    { key: 'reorder_at', label: 'reorder at', align: 'right' },
    { key: 'batch_no', label: 'batch' },
    { key: 'batch_expires_on', label: 'expires', format: isoDate },
    { key: 'state', label: 'state' },
  ]);
};

commands.register = async (db, args, flags) => {
  if (args[0] === 'check' || flags.check) {
    const rows = plainAll(await db.query(`select * from v_register_balances order by code`));
    if (asJson) return console.log(JSON.stringify(rows, null, 2));
    console.log(table(rows, [
      { key: 'code', label: 'code' },
      { key: 'name', label: 'drug', width: 30 },
      { key: 'register_qty', label: 'register', align: 'right' },
      { key: 'shelf_qty', label: 'shelf', align: 'right' },
      { key: 'discrepancy', label: 'discrepancy', align: 'right', format: (v) => (num(v) ? String(v) : 'reconciles') },
      { key: 'last_entry_on', label: 'last entry', format: isoDate },
    ]));
    const off = rows.filter((r) => num(r.discrepancy) !== 0);
    if (off.length) {
      console.log(`\n  ${off.length} drug(s) do not reconcile. Count the shelf, find the movement, and record the correcting entry with a witness. An inspector asks about this line first (Misuse of Drugs Regulations 1977).`);
    }
    return;
  }
  if (args[0] === 'dispose') {
    const item = await resolveItem(db, args[1]);
    if (!item.controlled) throw new CliError(`${item.name} is not a controlled drug; disposal of ordinary stock is a stock adjustment, not a register entry.`);
    const qty = parseQty(flags.qty);
    if (!str(flags.witness)) {
      throw new CliError(`Destruction of a controlled drug is witnessed, always: --witness= who watched (Misuse of Drugs Regulations 1977). No force flag.`);
    }
    const staffRow = await resolveStaff(db, str(flags.staff));
    const [bal] = await db.query(`select register_qty from v_register_balances where item_id = $1`, [item.id]);
    const registerQty = num(bal && bal.register_qty);
    if (registerQty < qty) throw new CliError(`The ${item.name} register holds ${registerQty} ${item.unit}; cannot dispose ${qty}.`);
    await db.query(
      `insert into drug_register (item_id, movement, qty, balance_after, staff_id, witness, note)
       values ($1, 'disposed', $2, $3, $4, $5, $6)`,
      [item.id, qty, registerQty - qty, staffRow.id, str(flags.witness), str(flags.note) || null],
    );
    await db.query(`update items set stock_qty = greatest(0, stock_qty - $2) where id = $1`, [item.id, qty]);
    if (asJson) return console.log(JSON.stringify({ item: item.code, disposed: qty, balance_after: registerQty - qty }, null, 2));
    return console.log(`${item.code}: ${qty} ${item.unit} disposed, witnessed by ${str(flags.witness)}. Register balance ${registerQty - qty}.`);
  }
  let sql = `select r.entry_on, i.code, r.movement, r.qty, r.balance_after, p.name as patient, cn.ref as consult, s.name as staff, r.witness, r.note
             from drug_register r join items i on i.id = r.item_id
             left join patients p on p.id = r.patient_id
             left join consults cn on cn.id = r.consult_id
             join staff s on s.id = r.staff_id`;
  const params = [];
  if (args[0]) {
    const item = await resolveItem(db, args[0]);
    params.push(item.id);
    sql += ` where r.item_id = $1`;
  }
  sql += ` order by r.entry_on desc, r.created_at desc limit 50`;
  const rows = plainAll(await db.query(sql, params));
  out(rows, [
    { key: 'entry_on', label: 'date', format: isoDate },
    { key: 'code', label: 'drug' },
    { key: 'movement', label: 'movement' },
    { key: 'qty', label: 'qty', align: 'right' },
    { key: 'balance_after', label: 'balance', align: 'right' },
    { key: 'patient', label: 'patient' },
    { key: 'consult', label: 'consult' },
    { key: 'staff', label: 'staff' },
    { key: 'witness', label: 'witness' },
  ]);
};

// ---- notes ---------------------------------------------------------------

commands.note = async (db, args, flags) => {
  if (args[0] !== 'add') throw new CliError('Usage: note add PATIENT TEXT [--staff=]  |  note add --client=NAME TEXT');
  let patientId = null;
  let clientId = null;
  let text;
  if (flags.client) {
    const client = await resolveClient(db, str(flags.client));
    clientId = client.id;
    text = args.slice(1).join(' ');
  } else {
    const patient = await resolvePatient(db, args[1]);
    patientId = patient.id;
    clientId = patient.client_id;
    text = args.slice(2).join(' ');
  }
  if (!text || !text.trim()) throw new CliError('What is the note? In a complaint, this is the record.');
  let staffId = null;
  if (flags.staff) staffId = (await resolveStaff(db, str(flags.staff))).id;
  const [row] = await db.query(
    `insert into file_notes (patient_id, client_id, staff_id, note) values ($1, $2, $3, $4) returning *`,
    [patientId, clientId, staffId, text.trim()],
  );
  if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
  return console.log('Noted.');
};

commands.notes = async (db, args) => {
  const patient = await resolvePatient(db, args[0]);
  const rows = plainAll(await db.query(
    `select fn.noted_on, s.name as staff, fn.note from file_notes fn left join staff s on s.id = fn.staff_id
     where fn.patient_id = $1 or fn.client_id = $2 order by fn.noted_on desc`, [patient.id, patient.client_id]));
  out(rows, [
    { key: 'noted_on', label: 'date', format: isoDate },
    { key: 'staff', label: 'staff' },
    { key: 'note', label: 'note', width: 76 },
  ]);
};

// ---- attention -----------------------------------------------------------

commands.attention = async (db) => {
  const rows = plainAll(await db.query(
    `select rank, reason, label, who, place, days, detail from v_attention order by rank, days desc nulls last`));
  if (asJson) return console.log(JSON.stringify(rows, null, 2));
  if (!rows.length) return console.log('Nothing wants a decision. Enjoy it while it lasts.');
  console.log(heading(`Needs attention (${rows.length})`));
  for (const r of rows) {
    console.log(`\n  [${r.reason}] ${r.label}${r.who ? ' · ' + r.who : ''}${r.place ? ' · ' + r.place : ''}`);
    console.log(`    ${r.detail}`);
  }
};

// ---- compliance ----------------------------------------------------------

const RULES = [
  {
    key: 'apc',
    rule: 'Every practising vet holds a current annual practising certificate',
    source: 'Veterinarians Act 2005 s 18',
    sql: `select s.name as label, 'practising certificate ' || case when s.apc_expires_on is null then 'not on record' else 'expired ' || to_char(s.apc_expires_on, 'YYYY-MM-DD') end || case when s.appts_next_7d > 0 then ', and holds ' || s.appts_next_7d || ' appointment(s) in the next 7 days' else '' end as detail
          from v_staff s where s.role = 'vet' and s.status = 'active' and s.apc in ('EXPIRED', 'NONE')`,
  },
  {
    key: 'register',
    rule: 'The controlled drug register reconciles with the shelf, drug by drug',
    source: 'Misuse of Drugs Regulations 1977 (register of controlled drugs)',
    sql: `select b.code as label, 'register ' || b.register_qty || ' ' || b.unit || ' vs shelf ' || b.shelf_qty || ': discrepancy ' || b.discrepancy as detail
          from v_register_balances b where b.discrepancy <> 0`,
  },
  {
    key: 'records',
    rule: 'Every consult carries clinical notes, completed the day it happened',
    source: 'VCNZ Code of Professional Conduct (records)',
    sql: `select cn.ref as label, case when cn.state = 'OPEN STALE' then 'opened ' || to_char(cn.on_date, 'YYYY-MM-DD') || ' and never completed' else 'completed with no clinical notes' end as detail
          from v_consults cn where cn.state in ('OPEN STALE', 'NO NOTES')`,
  },
  {
    key: 'consent',
    rule: 'Every surgery and dental carries informed consent, on record before the procedure',
    source: 'VCNZ Code of Professional Conduct (informed consent)',
    sql: `select cn.ref as label, cn.type || ' on ' || cn.patient || ' completed ' || to_char(cn.on_date, 'YYYY-MM-DD') || ' with no consent on record' as detail
          from v_consults cn where cn.status = 'completed' and cn.type in ('surgery', 'dental') and cn.consent_on is null`,
  },
  {
    key: 'rvm',
    rule: "Restricted veterinary medicines are dispensed only under a vet's authorisation",
    source: 'ACVM Act 1997',
    sql: `select cn.ref as label, i.name || ' dispensed under ' || s.name || ' (' || s.role || ')' as detail
          from consult_lines l join items i on i.id = l.item_id join consults cn on cn.id = l.consult_id join staff s on s.id = cn.staff_id
          where (i.rvm or i.controlled) and s.role <> 'vet'`,
  },
  {
    key: 'expired-stock',
    rule: 'No expired batch stays on the shelf',
    source: 'ACVM Act 1997 (conditions of registration and label directions)',
    sql: `select st.code as label, 'batch ' || coalesce(st.batch_no, '?') || ' expired ' || to_char(st.batch_expires_on, 'YYYY-MM-DD') || ' with ' || st.stock_qty || ' ' || st.unit || ' on hand' as detail
          from v_stock st where st.state = 'EXPIRED BATCH'`,
  },
  {
    key: 'microchip',
    rule: 'Every dog on the books has a microchip on record',
    source: 'Dog Control Act 1996 s 36A',
    sql: `select p.name as label, coalesce(p.breed, 'dog') || ', owner ' || p.client || ': no microchip on record' as detail
          from v_patients p where p.status = 'active' and p.species = 'dog' and (p.microchip is null or p.microchip = '')`,
  },
  {
    key: 'vaccination',
    rule: 'No core vaccination drifts more than 90 days overdue without a booking or a recorded decline',
    source: 'WSAVA vaccination guidelines, and your own standard',
    sql: `select r.patient as label, r.vaccine || ' due ' || to_char(r.due_on, 'YYYY-MM-DD') || ' (' || r.days_overdue || ' days overdue), nothing booked' as detail
          from v_reminders r where r.state = 'LONG OVERDUE' and r.next_appt_on is null`,
  },
  {
    key: 'retention',
    rule: 'Clinical records are never deleted: deceased patients, former clients and old consults stay on file',
    source: 'VCNZ Code of Professional Conduct (minimum retention)',
    sql: `select null as label, null as detail where false`,
    note: 'Held by design: this CLI has no delete path. Patients become deceased, staff become former, and the register only ever gains entries.',
  },
];

commands.compliance = async (db, args) => {
  const only = args[0] ? String(args[0]).toLowerCase() : null;
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const r of rules) {
    const breaches = plainAll(await db.query(r.sql));
    results.push({ key: r.key, rule: r.rule, source: r.source, note: r.note, breaches });
  }
  if (asJson) return console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    const state = r.breaches.length ? `${r.breaches.length} BREACH(ES)` : 'ok';
    console.log(`\n  [${r.key}] ${state}`);
    console.log(`    ${r.rule} (${r.source})`);
    if (r.note) console.log(`    ${r.note}`);
    for (const b of r.breaches) console.log(`      - ${b.label}: ${b.detail}`);
  }
  const total = results.reduce((s, r) => s + r.breaches.length, 0);
  console.log(`\n  ${results.length} rule(s), ${total} breach(es).`);
};

// ---- import / export -----------------------------------------------------

commands.import = async (db, args, flags) => {
  if (args[0] !== 'ezyvet') throw new CliError('Usage: import ezyvet --clients=FILE [--patients=FILE] [--dry-run]');
  const dry = !!flags['dry-run'];
  const report = { clients: 0, clients_updated: 0, patients: 0, patients_updated: 0, skips: [] };

  const readRows = (flag, label) => {
    const file = str(flags[flag]);
    if (!file) return null;
    if (!existsSync(file)) throw new CliError(`No ${label} file at ${file}.`);
    return parseCsv(readFileSync(file, 'utf8'));
  };

  const clientRows = readRows('clients', 'clients');
  const patientRows = readRows('patients', 'patients');
  if (!clientRows && !patientRows) throw new CliError('Nothing to import: give --clients= and/or --patients= (ezyVet CSV exports).');

  if (clientRows) {
    for (const row of clientRows) {
      const code = pick(row, 'Code', 'Client Code', 'Id');
      const first = pick(row, 'First Name', 'FirstName');
      const last = pick(row, 'Last Name', 'LastName', 'Surname');
      const name = pick(row, 'Name', 'Full Name') || [first, last].filter(Boolean).join(' ') || pick(row, 'Business Name');
      if (!name) {
        report.skips.push(`client row with no name (code ${code || '?'})`);
        continue;
      }
      const existing = await db.query(
        `select id from clients where (external_ref is not null and external_ref = $1) or lower(name) = lower($2)`,
        [code || `__none__`, name]);
      const fields = {
        phone: pick(row, 'Mobile', 'Mobile Phone', 'Phone', 'Best Contact'),
        email: pick(row, 'Email', 'Email Address'),
        address: pick(row, 'Physical Address', 'Address', 'Street'),
        suburb: pick(row, 'Suburb', 'City'),
      };
      if (existing.length) {
        report.clients_updated++;
        if (!dry) {
          await db.query(
            `update clients set phone = coalesce(nullif($2, ''), phone), email = coalesce(nullif($3, ''), email),
             address = coalesce(nullif($4, ''), address), suburb = coalesce(nullif($5, ''), suburb),
             external_ref = coalesce(external_ref, nullif($6, '')) where id = $1`,
            [existing[0].id, fields.phone, fields.email, fields.address, fields.suburb, code]);
        }
      } else {
        report.clients++;
        if (!dry) {
          await db.query(
            `insert into clients (name, phone, email, address, suburb, external_ref) values ($1, $2, $3, $4, $5, $6)`,
            [name, fields.phone || null, fields.email || null, fields.address || null, fields.suburb || null, code || null]);
        }
      }
    }
  }

  if (patientRows) {
    for (const row of patientRows) {
      const code = pick(row, 'Code', 'Animal Code', 'Id');
      const name = pick(row, 'Name', 'Animal Name', 'Patient Name');
      const ownerKey = pick(row, 'Owner', 'Owner Name', 'Client', 'Client Name', 'Owner Code', 'Client Code');
      if (!name) {
        report.skips.push(`patient row with no name (code ${code || '?'})`);
        continue;
      }
      const owners = await db.query(
        `select id from clients where lower(name) = lower($1) or external_ref = $1`, [ownerKey || '__none__']);
      if (!owners.length) {
        report.skips.push(`${name}: owner "${ownerKey || '?'}" not found, import clients first`);
        continue;
      }
      const fields = {
        species: (pick(row, 'Species', 'Animal Type') || 'dog').toLowerCase(),
        breed: pick(row, 'Breed'),
        sex: (pick(row, 'Sex', 'Gender') || '').toLowerCase(),
        dob: pick(row, 'Date of Birth', 'DOB', 'Birth Date'),
        microchip: pick(row, 'Microchip Number', 'Microchip', 'Chip Number'),
      };
      const dob = fields.dob ? parseDate(fields.dob, 'date of birth') : null;
      const existing = await db.query(
        `select id from patients where (external_ref is not null and external_ref = $1)
           or (lower(name) = lower($2) and client_id = $3)`,
        [code || '__none__', name, owners[0].id]);
      if (existing.length) {
        report.patients_updated++;
        if (!dry) {
          await db.query(
            `update patients set breed = coalesce(nullif($2, ''), breed), sex = coalesce(nullif($3, ''), sex),
             dob = coalesce($4, dob), microchip = coalesce(microchip, nullif($5, '')),
             external_ref = coalesce(external_ref, nullif($6, '')) where id = $1`,
            [existing[0].id, fields.breed, fields.sex, dob, fields.microchip, code]);
        }
      } else {
        report.patients++;
        if (!dry) {
          const ref = await nextRef(db, 'patients', 'PT', 101);
          await db.query(
            `insert into patients (ref, name, client_id, species, breed, sex, dob, microchip, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [ref, name, owners[0].id, fields.species, fields.breed || null, fields.sex || null, dob, fields.microchip || null, code || null]);
        }
      }
    }
  }

  if (asJson) return console.log(JSON.stringify(report, null, 2));
  console.log(`${dry ? 'DRY RUN, nothing written. ' : ''}clients: ${report.clients} new, ${report.clients_updated} updated · patients: ${report.patients} new, ${report.patients_updated} updated`);
  if (report.skips.length) {
    console.log(`\n  ${report.skips.length} skip(s): the import is the first audit, each one is a question about the old data`);
    for (const s of report.skips) console.log(`  - ${s}`);
  }
  console.log('\nHistory, vaccinations and balances do not import blind: see docs/replace-ezyvet.md for what carries over and what starts fresh.');
};

commands.export = async (db, args, flags) => {
  const tables = ['clients', 'staff', 'patients', 'items', 'appointments', 'consults', 'consult_lines', 'vaccinations', 'invoices', 'drug_register', 'file_notes'];
  const dump = {};
  const counts = {};
  for (const t of tables) {
    dump[t] = plainAll(await db.query(`select * from ${t} order by created_at`));
    counts[t] = dump[t].length;
  }
  const outFile = str(flags.out) || path.join(REPO_ROOT, 'exports', `vet-clinic-export-${today()}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(dump, null, 2));
  if (asJson) return console.log(JSON.stringify({ file: outFile, counts }, null, 2));
  console.log(`Exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows to ${outFile}`);
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);
};

// ---------------------------------------------------------------------------
// Main

const { args, flags } = parseArgv(process.argv.slice(2));
asJson = !!flags.json;
const cmd = args.shift() || 'help';

if (!commands[cmd]) {
  console.error(`Unknown command "${cmd}". Run: node scripts/vet.mjs help`);
  process.exit(1);
}

if (cmd === 'help') {
  await commands.help();
  process.exit(0);
}

const db = await getDb();
try {
  await commands[cmd](db, args, flags);
} catch (err) {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exitCode = err.code;
  } else {
    console.error(err.stack || String(err));
    process.exitCode = 1;
  }
} finally {
  await db.close();
}

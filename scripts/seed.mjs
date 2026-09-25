#!/usr/bin/env node
// Loads supabase/seed.sql: Harbourview Vets, a fictional Tauranga small-animal
// clinic with eight owners, eleven patients, six staff, thirteen items, a
// fortnight of appointments, a consult history, a vaccination record, nine
// invoices and a controlled drug register. Every row has a derived id and
// inserts with ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from clients)       as clients,
           (select count(*) from staff)         as staff,
           (select count(*) from patients)      as patients,
           (select count(*) from items)         as items,
           (select count(*) from appointments)  as appointments,
           (select count(*) from consults)      as consults,
           (select count(*) from consult_lines) as consult_lines,
           (select count(*) from vaccinations)  as vaccinations,
           (select count(*) from invoices)      as invoices,
           (select count(*) from drug_register) as drug_register,
           (select count(*) from file_notes)    as file_notes
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const db = await getDb();
  try {
    const counts = await seed(db);
    console.log('seeded:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  } finally {
    await db.close();
  }
}

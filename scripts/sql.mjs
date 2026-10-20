/**
 * Roda SQL no banco do financeiro — é por aqui que o agente responde às suas perguntas.
 *
 *   node scripts/sql.mjs "select ..."              só leitura (transação READ ONLY)
 *   node scripts/sql.mjs --arquivo consulta.sql    o mesmo, lendo de um arquivo
 *   node scripts/sql.mjs --escrever "update ..."   grava — só depois de o dono dizer "pode"
 *
 * Sem --escrever, a transação é aberta como READ ONLY: um insert/update/delete esquecido
 * falha no próprio Postgres em vez de mudar o seu dinheiro. Com --escrever, o comando roda
 * numa transação que só confirma se terminar inteiro.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { dbUrl } from '../lib/env.mjs';
import { ssl } from '../lib/ssl.mjs';

const argv = process.argv.slice(2);
const ESCREVER = argv.includes('--escrever');
const iArq = argv.indexOf('--arquivo');
const sql = iArq >= 0 ? readFileSync(argv[iArq + 1], 'utf8') : argv.filter((a) => !a.startsWith('--')).join(' ');

if (!sql.trim()) {
  console.error('uso: node scripts/sql.mjs "select ..."   (ou --arquivo x.sql, ou --escrever "...")');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl(), ssl, statement_timeout: 60_000 });
await client.connect();

try {
  await client.query(ESCREVER ? 'begin' : 'begin read only');
  const r = await client.query(sql);
  const resultados = Array.isArray(r) ? r : [r];
  for (const res of resultados) {
    if (res.rows?.length) console.table(res.rows);
    else console.log(`${res.command ?? 'ok'}: ${res.rowCount ?? 0} linha(s)`);
  }
  await client.query(ESCREVER ? 'commit' : 'rollback');
  if (ESCREVER) console.log('✔ gravado.');
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`❌ ${e.message}`);
  if (/read-only/i.test(e.message)) console.error('   Isso grava. Rode de novo com --escrever — e só depois do "pode" do dono.');
  process.exitCode = 1;
} finally {
  await client.end();
}

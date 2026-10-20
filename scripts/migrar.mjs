/**
 * Aplica as migrations de supabase/migrations no Postgres do seu projeto Supabase.
 *
 *   node scripts/migrar.mjs           aplica o que estiver pendente
 *   node scripts/migrar.mjs --status  só mostra o que já foi aplicado
 *   node scripts/migrar.mjs 0003      aplica um arquivo específico (por prefixo)
 *
 * Cada arquivo roda dentro de UMA transação: ou entra inteiro, ou não entra. O que já
 * entrou fica registrado em financeiro._migrations com o hash do conteúdo — rodar de novo
 * não repete, e editar um arquivo já aplicado é denunciado em vez de passar batido.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { dbUrl, descreverConexao } from '../lib/env.mjs';
import { ssl } from '../lib/ssl.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pasta = join(raiz, 'supabase', 'migrations');

const arg = process.argv[2];
const somenteStatus = arg === '--status';
const filtro = arg && !arg.startsWith('--') ? arg : null;

// `admin`: migration é DDL (create schema, create type, create policy) — trabalho de dono
// do banco. A role dedicada do app não tem, e não deve ter, essa permissão.
const url = dbUrl({ sessao: true, admin: true });
const client = new pg.Client({
  connectionString: url,
  ssl,
  statement_timeout: 120_000,
});

const hashDe = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

await client.connect();
console.log(`conectado: ${descreverConexao(url)}\n`);

await client.query(`
  create schema if not exists financeiro;
  create table if not exists financeiro._migrations (
    nome        text primary key,
    hash        text not null,
    aplicada_em timestamptz not null default now()
  );
`);

const { rows: aplicadas } = await client.query(
  'select nome, hash, aplicada_em from financeiro._migrations order by nome'
);
const jaAplicada = new Map(aplicadas.map((r) => [r.nome, r]));

const arquivos = readdirSync(pasta)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (somenteStatus) {
  console.log('migration                     estado');
  console.log('─'.repeat(64));
  for (const nome of arquivos) {
    const r = jaAplicada.get(nome);
    const conteudo = readFileSync(join(pasta, nome), 'utf8');
    const estado = !r
      ? 'pendente'
      : r.hash === hashDe(conteudo)
        ? `aplicada  ${r.aplicada_em.toISOString().slice(0, 16).replace('T', ' ')}`
        : '⚠️  APLICADA MAS O ARQUIVO MUDOU DEPOIS';
    console.log(`${nome.padEnd(30)}${estado}`);
  }
  await client.end();
  process.exit(0);
}

let aplicou = 0;

for (const nome of arquivos) {
  if (filtro && !nome.startsWith(filtro)) continue;

  const conteudo = readFileSync(join(pasta, nome), 'utf8');
  const hash = hashDe(conteudo);
  const anterior = jaAplicada.get(nome);

  if (anterior) {
    if (anterior.hash !== hash) {
      console.log(`⚠️  ${nome} — já aplicada, mas o arquivo mudou desde então.`);
      console.log('    Não vou reaplicar. Crie uma migration nova com a diferença.');
    } else {
      console.log(`·  ${nome} — já aplicada`);
    }
    continue;
  }

  process.stdout.write(`▸  ${nome} ... `);
  try {
    await client.query('begin');
    await client.query(conteudo);
    await client.query(
      'insert into financeiro._migrations (nome, hash) values ($1, $2)',
      [nome, hash]
    );
    await client.query('commit');
    console.log('ok');
    aplicou++;
  } catch (e) {
    await client.query('rollback');
    console.log('FALHOU');
    console.error(`\n   ${e.message}`);
    if (e.position) {
      const pos = Number(e.position);
      const linha = conteudo.slice(0, pos).split('\n').length;
      console.error(`   linha ${linha} de ${nome}`);
    }
    await client.end();
    process.exit(1);
  }
}

console.log(aplicou ? `\n${aplicou} migration(s) aplicada(s).` : '\nnada pendente.');
await client.end();

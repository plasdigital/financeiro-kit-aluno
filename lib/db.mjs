/**
 * Pool de conexão do app. Só servidor — nunca importe isto de um Client Component.
 *
 * Usa a porta 6543 (transaction pooler), que é a certa para app: cada query devolve a
 * conexão ao pool em vez de segurá-la. Migration é que vai pela 5432 (ver lib/env.mjs).
 */

import pg from 'pg';
import { dbUrl } from './env.mjs';
import { ssl } from './ssl.mjs';

// Em serverless cada instância tem o próprio pool, e há muitas instâncias ao mesmo tempo:
// 5 conexões por instância viram centenas no pooler. Localmente vale o oposto — um processo
// só, que se beneficia de manter conexões quentes.
const serverless = Boolean(process.env.VERCEL);

const g = globalThis;

export const pool =
  g.__financeiroPool ??
  (g.__financeiroPool = new pg.Pool({
    connectionString: dbUrl(),
    ssl,
    max: serverless ? 1 : 5,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  }));

/** @param {string} sql @param {any[]} [params] */
export async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

/** Primeira linha, ou undefined. */
export async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0];
}

/**
 * Carga de credenciais: primeiro process.env, depois o .env.local da raiz desta pasta.
 *
 * Nenhum valor é impresso. Quem precisar conferir qual conexão está em uso vê o host
 * mascarado em `descreverConexao()`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const FONTES = [join(raiz, '.env.local')];

function lerEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const out = {};
  for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const chave = t.slice(0, i).trim();
    let valor = t.slice(i + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    out[chave] = valor;
  }
  return out;
}

const arquivos = FONTES.map(lerEnv);

/** @param {string} nome @param {{obrigatorio?: boolean}} [opts] */
export function env(nome, { obrigatorio = false } = {}) {
  const v =
    process.env[nome] ?? arquivos.find((a) => a[nome] !== undefined)?.[nome];
  if (obrigatorio && !v) {
    throw new Error(
      `${nome} não encontrada. Procurei em process.env e em:\n` +
        FONTES.map((f) => `  ${f}`).join('\n')
    );
  }
  return v;
}

/**
 * Connection string do Postgres.
 *
 * O pooler do Supabase atende em duas portas: 6543 é transaction mode (uma conexão por
 * statement — bom pra app), 5432 é session mode. DDL longo com `create type` e funções
 * quer a sessão inteira, então migration vai por 5432.
 *
 * Duas variáveis, com precedência:
 *   FINANCEIRO_DB_URL — opcional: uma role que só enxerga o schema financeiro (para quando
 *                       um painel publicado ler este banco).
 *   SUPABASE_DB_URL   — a do dono do projeto. Migration e sincronização usam esta.
 *
 * @param {{sessao?: boolean, admin?: boolean}} [opts]
 */
export function dbUrl({ sessao = false, admin = false } = {}) {
  const bruta = admin
    ? env('SUPABASE_DB_URL', { obrigatorio: true })
    : env('FINANCEIRO_DB_URL') ?? env('SUPABASE_DB_URL', { obrigatorio: true });
  if (!sessao) return bruta;
  const u = new URL(bruta);
  if (u.port === '6543') u.port = '5432';
  return u.toString();
}

/** Host e usuário, sem a senha — pra log e conferência. */
export function descreverConexao(url = dbUrl()) {
  const u = new URL(url);
  return `${u.username}@${u.hostname}:${u.port}${u.pathname}`;
}

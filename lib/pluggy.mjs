/**
 * Cliente da API do Pluggy (Meu Pluggy — plano pessoal gratuito).
 *
 * Um titular = uma conta no Meu Pluggy = um par de credenciais. O Meu Pluggy não aceita
 * dois CPFs no mesmo perfil: quem quiser juntar as contas de outra pessoa da casa cria uma
 * segunda conta e um segundo titular. Por isso tudo aqui recebe um `titular`.
 *
 * A apiKey do /auth vale 2h; guardo em memória por processo — script curto nunca renova.
 */

import { env } from './env.mjs';

const BASE = 'https://api.pluggy.ai';

/** Credenciais de um titular, lidas do .env.local. */
export function credenciais(titular) {
  const T = titular.toUpperCase();
  const clientId = env(`PLUGGY_${T}_CLIENT_ID`, { obrigatorio: true });
  const clientSecret = env(`PLUGGY_${T}_CLIENT_SECRET`, { obrigatorio: true });
  const items = (env(`PLUGGY_${T}_ITEMS`) ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { clientId, clientSecret, items };
}

/**
 * Titulares configurados no .env.local. PLUGGY_TITULARES lista os rótulos (padrão:
 * "principal"); cada rótulo X precisa de PLUGGY_X_CLIENT_ID, _CLIENT_SECRET e _ITEMS.
 */
export function titulares() {
  return (env('PLUGGY_TITULARES') ?? 'principal')
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && env(`PLUGGY_${t.toUpperCase()}_CLIENT_ID`));
}

const chaves = new Map();

async function apiKey(titular) {
  if (chaves.has(titular)) return chaves.get(titular);
  const { clientId, clientSecret } = credenciais(titular);
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!r.ok) throw new Error(`/auth de ${titular} falhou: ${r.status} ${await r.text()}`);
  const { apiKey: k } = await r.json();
  chaves.set(titular, k);
  return k;
}

/** GET cru, com a apiKey do titular. */
export async function get(titular, caminho, params = {}) {
  const url = new URL(caminho, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, { headers: { 'X-API-KEY': await apiKey(titular) } });
  if (!r.ok) throw new Error(`GET ${url.pathname} (${titular}): ${r.status} ${await r.text()}`);
  return r.json();
}

/**
 * GET paginado por página ({results, page, totalPages}) — /accounts e /bills.
 * Guardrail: teto de páginas pra um bug de paginação não virar loop infinito.
 */
export async function getTudo(titular, caminho, params = {}, { maxPaginas = 200 } = {}) {
  const out = [];
  let page = 1;
  while (page <= maxPaginas) {
    const r = await get(titular, caminho, { ...params, page, pageSize: 500 });
    out.push(...(r.results ?? []));
    const total = r.totalPages ?? 1;
    if (page >= total) break;
    page++;
  }
  return out;
}

/**
 * GET paginado por cursor — /v2/transactions.
 *
 * A v1 responde 410 desde 2026 ("use GET /v2/transactions with cursor pagination"), e a v2
 * é exigente: aceita `accountId`, `dateFrom` e `dateTo`, e recusa `from`, `to`, `pageSize`
 * ou `limit` com 400. A próxima página vem pronta em `next`, como query string
 * ("?accountId=…&after=…") — sigo ela em vez de remontar os parâmetros na mão.
 */
export async function getCursor(titular, caminho, params = {}, { maxPaginas = 500 } = {}) {
  const out = [];
  let proxima = null;
  for (let i = 0; i < maxPaginas; i++) {
    const r = proxima
      ? await getBruto(titular, `${caminho}${proxima}`)
      : await get(titular, caminho, params);
    out.push(...(r.results ?? []));
    proxima = r.next ?? null;
    if (!proxima) break;
  }
  return out;
}

/** GET com o caminho já montado (query string incluída) — usado pela paginação por cursor. */
async function getBruto(titular, caminhoComQuery) {
  const r = await fetch(new URL(caminhoComQuery, BASE), {
    headers: { 'X-API-KEY': await apiKey(titular) },
  });
  if (!r.ok) throw new Error(`GET ${caminhoComQuery.slice(0, 40)} (${titular}): ${r.status}`);
  return r.json();
}

export const item = (titular, id) => get(titular, `/items/${id}`);
export const contas = (titular, itemId) => getTudo(titular, '/accounts', { itemId });
export const faturas = (titular, accountId) => getTudo(titular, '/bills', { accountId });
export const transacoes = (titular, accountId, dateFrom, dateTo) =>
  getCursor(titular, '/v2/transactions', { accountId, dateFrom, dateTo });

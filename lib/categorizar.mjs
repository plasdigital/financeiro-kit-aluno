/**
 * Motor de categorização.
 *
 * Determinístico e barato: percorre as regras por prioridade e devolve a primeira que casar.
 * O que não casar fica SEM categoria — visível na tela, pronto pra correção.
 * Corrigir na tela oferece criar a regra; a partir daí aquele estabelecimento nunca mais erra.
 */

import { REGRAS } from './regras-base.mjs';

/**
 * Maiúscula, sem acento, espaços colapsados.
 * A fatura mistura tudo: "Dl*99 Ride", "SUPERMERCADO CENTRO", "Ifd*Pizzaria".
 * @param {string} s
 */
export function normalizar(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} descricao
 * @param {Array} [regras] regras do banco; sem isso usa as regras-base
 * @returns {object|null} a regra que casou, ou null
 */
export function categorizar(descricao, regras = REGRAS) {
  const d = normalizar(descricao);
  if (!d) return null;

  // A ordem precisa ser TOTAL, não só por prioridade. Empate resolvido "na ordem em que
  // veio" dá resultados diferentes aqui e no SQL da importação — foi o que aconteceu com
  // "Amazon Prime Aluguel", que casa em ALUGUEL (Moradia) e AMAZON PRIME (Assinaturas),
  // as duas com prioridade 30. Desempate: padrão mais longo é o mais específico e ganha;
  // se ainda empatar, alfabético, que é arbitrário mas igual nos dois lados.
  const ordenadas = [...regras]
    .filter((r) => r.ativa !== false)
    .sort(
      (a, b) =>
        (a.prioridade ?? 100) - (b.prioridade ?? 100) ||
        b.padrao.length - a.padrao.length ||
        a.padrao.localeCompare(b.padrao)
    );

  for (const r of ordenadas) {
    const tipo = r.tipoMatch ?? r.tipo_match ?? 'contem';
    const padrao = normalizar(r.padrao);

    if (tipo === 'regex') {
      if (new RegExp(r.padrao, 'i').test(d)) return r;
    } else if (tipo === 'exato') {
      if (d === padrao) return r;
    } else if (d.includes(padrao)) {
      return r;
    }
  }

  return null;
}

/**
 * Categoriza uma lista e devolve o resultado com a taxa de cobertura.
 * @param {Array<{descricaoLimpa?:string, descricao:string}>} lancamentos
 * @param {Array} [regras]
 */
export function categorizarLote(lancamentos, regras = REGRAS) {
  let reconhecidos = 0;
  const itens = lancamentos.map((l) => {
    const regra = categorizar(l.descricaoLimpa ?? l.descricao, regras);
    if (regra) reconhecidos++;
    return { ...l, categoria: regra?.categoria ?? null, escopo: regra?.escopo ?? null };
  });

  return {
    itens,
    reconhecidos,
    total: lancamentos.length,
    cobertura: lancamentos.length ? reconhecidos / lancamentos.length : 0,
  };
}

/**
 * Conferência da carga do Open Finance — a Etapa 2.3 da aula (docs/00-a-aula.md).
 *
 *   node scripts/conferir.mjs
 *
 * Responde, no terminal, as três perguntas que decidem se a carga pode ser considerada boa:
 *   1. cada cartão fecha o mesmo total que o app do banco mostra? (fatura × mês)
 *   2. o que o painel chama de gasto ainda é gasto? (nada contado duas vezes)
 *   3. o que sobrou sem categoria, e quanto vale?
 */

import { q, pool } from '../lib/db.mjs';

const brl = (n) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const titulo = (t) => console.log(`\n\x1b[1m${t}\x1b[0m\n${'─'.repeat(t.length)}`);

// 1. Fatura por cartão e mês, com o total que o próprio banco informou ao lado.
titulo('Faturas — total calculado × total informado pelo banco');
const faturas = await q(`
  select m.nome as cartao, to_char(f.competencia,'YYYY-MM') as mes, f.situacao,
         f.total_calculado::float, f.total_informado::float, f.qtd_lancamentos::int,
         f.divergencia::float
    from financeiro.v_faturas f
    join financeiro.meios_pagamento m on m.id = f.meio_pagamento_id
   where f.competencia >= date_trunc('month', current_date) - interval '6 months'
   order by m.nome, f.competencia
`);
for (const f of faturas) {
  const alerta = Math.abs(f.divergencia ?? 0) > 1 ? `  ⚠️ divergência ${brl(f.divergencia)}` : '';
  console.log(
    `${f.cartao.padEnd(24)} ${f.mes}  ${String(f.situacao).padEnd(9)} ` +
      `${brl(f.total_calculado).padStart(13)} vs ${brl(f.total_informado).padStart(13)}` +
      ` ${String(f.qtd_lancamentos).padStart(4)} itens${alerta}`
  );
}

// 2. Gasto por mês e por meio de pagamento — a foto que você vai olhar.
titulo('Gasto por mês (só consumo: sem pagamento de fatura, transferência e saldo rolado)');
const meses = await q(`
  select to_char(l.competencia,'YYYY-MM') as mes,
         sum(l.valor) filter (where m.tipo = 'cartao_credito')::float as cartao,
         sum(l.valor) filter (where m.tipo <> 'cartao_credito')::float as conta,
         sum(l.valor)::float as total
    from financeiro.lancamentos l
    join financeiro.meios_pagamento m on m.id = l.meio_pagamento_id
    left join financeiro.categorias c on c.id = l.categoria_id
   where l.origem = 'open_finance'
     and l.situacao <> 'cancelado'
     and coalesce(c.nome,'') not in ('Saldo rolado','Entrada','Transferência','Dinheiro de terceiro')
     and l.valor > 0
   group by 1 order by 1
`);
console.log('mês        cartão            conta            total');
for (const m of meses) {
  console.log(
    `${m.mes}  ${brl(m.cartao).padStart(14)} ${brl(m.conta).padStart(16)} ${brl(m.total).padStart(16)}`
  );
}

// 3. O buraco: o que entrou sem categoria.
//
// Só consumo: pagamento de fatura e transferência entram como `cancelado` e ficam de fora.
const SEM_CATEGORIA = `
  l.categoria_id is null
  and l.situacao <> 'cancelado'
  and l.valor > 0
`;

titulo('Sem categoria — os 15 maiores blocos');
const semCat = await q(`
  select left(l.descricao, 40) as descricao, count(*)::int as vezes, sum(l.valor)::float as total
    from financeiro.lancamentos l
   where ${SEM_CATEGORIA}
   group by 1 order by 3 desc limit 15
`);
for (const s of semCat) {
  console.log(`${brl(s.total).padStart(13)}  ${String(s.vezes).padStart(3)}×  ${s.descricao}`);
}
const [tot] = await q(`
  select count(*)::int as qtd, sum(l.valor)::float as total
    from financeiro.lancamentos l
   where ${SEM_CATEGORIA}
`);
console.log(`\ntotal sem categoria: ${tot.qtd} lançamentos · ${brl(tot.total)}`);

await pool.end();

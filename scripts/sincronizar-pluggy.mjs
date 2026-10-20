/**
 * Sincroniza contas, cartões, faturas e transações do Pluggy para o schema financeiro.
 *
 *   node scripts/sincronizar-pluggy.mjs --dry             mostra o que faria, não escreve nada
 *   node scripts/sincronizar-pluggy.mjs                   incremental (últimos 90 dias)
 *   node scripts/sincronizar-pluggy.mjs --tudo            histórico completo (últimos 24 meses)
 *   node scripts/sincronizar-pluggy.mjs --refazer "Nome"  apaga o lote open_finance do meio e recarrega
 *   node scripts/sincronizar-pluggy.mjs --refazer-tudo    apaga TODO o lote open_finance e recarrega
 *   node scripts/sincronizar-pluggy.mjs --titular=principal  só um titular
 *
 * O porquê das decisões: docs/00-a-aula.md (as travas).
 *
 * As três travas que importam:
 *   1. `--dry` não escreve NEM o meio de pagamento — conferir não pode criar cadastro.
 *   2. todo `delete` é filtrado por `origem = 'open_finance'` E por meio de pagamento. O que
 *      veio de outra origem (lançamento manual, importação) está fora do alcance deste
 *      script, sempre.
 *   3. reimportar não sobrescreve categoria já preenchida — correção feita na tela sobrevive.
 */

import { q, q1, pool } from '../lib/db.mjs';
import { titulares, credenciais, item, contas, faturas, transacoes } from '../lib/pluggy.mjs';
import { categorizar } from '../lib/categorizar.mjs';
import { paraCategoria, porDescricao, NAO_E_CONSUMO } from '../lib/pluggy-categorias.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const TUDO = argv.includes('--tudo');
const REFAZER = argv.includes('--refazer') ? argv[argv.indexOf('--refazer') + 1] : null;
const REFAZER_TUDO = argv.includes('--refazer-tudo');
const SO_TITULAR = argv.find((a) => a.startsWith('--titular='))?.split('=')[1];

const HOJE = new Date();

// ── datas ────────────────────────────────────────────────────────────────────
// O Pluggy devolve "2026-08-31T03:00:00.000Z", que é 31/08 00:00 em Brasília. Ler o pedaço
// antes do "T" joga a compra pro dia errado quando o fuso vira — e no cartão isso muda a
// fatura em que ela cai.
const FUSO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function isoDe(d) {
  return FUSO.format(d instanceof Date ? d : new Date(d));
}
const primeiroDoMes = (iso) => `${iso.slice(0, 7)}-01`;

const DESDE = isoDe(new Date(HOJE.getTime() - (TUDO || REFAZER || REFAZER_TUDO ? 730 : 90) * 864e5));
const ATE = isoDe(new Date(HOJE.getTime() + 400 * 864e5)); // parcela futura já vem lançada

const brl = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── nomes ────────────────────────────────────────────────────────────────────
// O connector do Meu Pluggy se chama "MeuPluggy" em todos os itens, e a conta de cartão vem
// batizada de "GOLD" ou "platinum". Sozinhos, viram três meios de pagamento chamados "GOLD"
// no painel. O banco sai da conta corrente do mesmo item; o titular, do .env.
const BANCOS = [
  [/\bINTER\b/i, 'Inter'],
  [/\bNU\b|NUBANK|NU PAGAMENTOS/i, 'Nubank'],
  [/SANTANDER/i, 'Santander'],
  [/MERCADO ?PAGO/i, 'Mercado Pago'],
  [/\bC6\b/i, 'C6'],
  [/BRADESCO/i, 'Bradesco'],
  [/ITA[UÚ]/i, 'Itaú'],
  [/CAIXA/i, 'Caixa'],
];

function bancoDoItem(cs) {
  for (const c of cs) {
    for (const [re, nome] of BANCOS) if (re.test(c.name ?? '')) return nome;
  }
  return null;
}

const titulo = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());

function nomeDoMeio(conta, banco, titular) {
  const T = titulo(titular);
  const b = banco ?? titulo(conta.name || 'Conta');
  if (conta.type === 'CREDIT') {
    const nivel = conta.creditData?.level;
    const apelido = nivel && nivel !== 'OTHERS' ? titulo(nivel) : titulo(conta.name);
    return `${b} ${apelido} ${T}`.replace(/\s+/g, ' ');
  }
  if (conta.subtype === 'SAVINGS_ACCOUNT') return `${b} Poupança ${T}`;
  return `${b} Conta ${T}`;
}

/**
 * De-para de nome: o nome que a sincronização gera → o nome de um meio que já existe.
 *
 * Só serve a quem cadastrou um cartão à mão ANTES de conectar o banco (ex.: "Nubank"). Sem
 * isto, a sincronização criaria "Nubank Platinum Principal" ao lado, e o mesmo cartão
 * apareceria duas vezes. Quem começa do zero deixa vazio.
 */
const MEIO_EXISTENTE = {
  // 'Nubank Platinum Principal': 'Nubank',
};

// ── categorização ────────────────────────────────────────────────────────────
async function carregarRegras() {
  const rows = await q(`
    select r.padrao, r.tipo_match, r.prioridade, r.ativa, c.nome as categoria
      from financeiro.regras_categoria r
      join financeiro.categorias c on c.id = r.categoria_id
     where r.ativa
  `);
  return rows.map((r) => ({ ...r, tipoMatch: r.tipo_match }));
}

async function mapaCategorias() {
  const rows = await q(`select id, nome from financeiro.categorias where ativa`);
  const m = new Map();
  for (const r of rows) if (!m.has(r.nome)) m.set(r.nome, r.id);
  return m;
}

// Categorias que já significam "não é gasto" e por isso não viram "Entrada".
const JA_NAO_E_GASTO = new Set(['Entrada', 'Transferência', 'Pagamento de fatura', 'Investimento']);

/** CPFs de todas as contas conectadas — preenchido na descoberta, antes de gravar. */
const CPFS_PROPRIOS = new Set();
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Uma transação do Pluggy vira uma linha de lançamento.
 *
 * Normalização de sinal: no painel, GASTO É SEMPRE POSITIVO e crédito é negativo.
 * O Pluggy inverte o sinal entre conta corrente (Pix enviado = -50) e cartão (compra = +65),
 * então o que decide é o `type`, nunca o sinal do `amount`.
 */
function normalizar(t, { ehCartao, regras, cats }) {
  const catPluggy = t.category ?? null;
  const valorAbs = Math.abs(Number(t.amount) || 0);
  const entrada = t.type === 'CREDIT';

  const descricao = t.descriptionRaw || t.description || '(sem descrição)';
  const regra = categorizar(descricao, regras);
  let nomeCat = regra?.categoria ?? paraCategoria(catPluggy);
  let naoEConsumo = NAO_E_CONSUMO.has(catPluggy);

  // Pix e TED entre contas que você mesmo conectou: o Pluggy só chama de "Same person
  // transfer" quando o CPF dos dois lados é igual, então o dinheiro que vai da sua conta para
  // a de outra pessoa da casa (outro titular) entra como "Transfer - PIX" e vira gasto. O
  // documento do recebedor está no payload; comparo com o de todas as contas conectadas aqui.
  const outroLado =
    (entrada ? t.paymentData?.payer : t.paymentData?.receiver)?.documentNumber?.value ?? null;
  if (outroLado && CPFS_PROPRIOS.has(soDigitos(outroLado))) {
    nomeCat = 'Transferência';
    naoEConsumo = true;
  }

  // A descrição corrige o que a categoria do banco erra (pagamento de fatura, aplicação).
  const pelaDescricao = porDescricao(descricao, { ehCartao, entrada });
  if (pelaDescricao) {
    nomeCat = pelaDescricao.categoria;
    naoEConsumo = pelaDescricao.naoEConsumo;
  }

  // Dinheiro entrando em conta corrente não é "gasto negativo" de alguma categoria: é
  // receita. Sem isto, um Pix recebido vira "Transporte" com valor negativo e apaga da soma
  // um gasto real de igual valor.
  if (!ehCartao && entrada && !naoEConsumo && !(nomeCat && JA_NAO_E_GASTO.has(nomeCat))) {
    nomeCat = 'Entrada';
  }

  const meta = t.creditCardMetadata ?? null;
  return {
    pluggy_transaction_id: t.id,
    descricao,
    valor: entrada ? -valorAbs : valorAbs,
    data: isoDe(t.date),
    competencia:
      ehCartao && meta?.billForecastDate
        ? `${meta.billForecastDate}-01`
        : primeiroDoMes(isoDe(t.date)),
    categoria_id: nomeCat ? (cats.get(nomeCat) ?? null) : null,
    parcela_num: meta?.installmentNumber ?? null,
    parcela_total: meta?.totalInstallments ?? null,
    naoEConsumo,
  };
}

// ── faturas ──────────────────────────────────────────────────────────────────
function situacaoDaFatura(b, hoje = isoDe(HOJE)) {
  const total = Number(b.totalAmount) || 0;
  const pago = (b.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const venc = isoDe(b.dueDate);
  const fech = b.billClosingDate ? isoDe(b.billClosingDate) : venc;
  if (total > 0 && pago >= total - 0.01) return { situacao: 'paga', pago, venc, fech };
  if (venc < hoje) return { situacao: 'atrasada', pago, venc, fech };
  if (fech <= hoje) return { situacao: 'fechada', pago, venc, fech };
  return { situacao: 'aberta', pago, venc, fech };
}

// ── execução ─────────────────────────────────────────────────────────────────
const resumo = [];
let erros = 0;

const regras = await carregarRegras();
const cats = await mapaCategorias();

console.log(
  `${DRY ? '🔎 DRY-RUN — nada será escrito' : '💾 gravando'} · janela ${DESDE} → ${ATE}` +
    (REFAZER ? ` · refazendo "${REFAZER}"` : '')
);
console.log(`regras de categoria carregadas: ${regras.length}\n`);

// ── 1ª passada: descoberta ───────────────────────────────────────────────────
// Antes de gravar é preciso conhecer TODAS as contas, porque é o documento de um titular que
// permite reconhecer, na conta do outro, que aquele Pix foi para dentro de casa e não é
// gasto. Descobrir enquanto grava classificaria errado tudo que passasse antes.
const plano = [];

for (const titular of titulares()) {
  if (SO_TITULAR && titular !== SO_TITULAR) continue;
  const { items } = credenciais(titular);
  console.log(`━━━ ${titular.toUpperCase()} — ${items.length} conexão(ões)`);

  for (const itemId of items) {
    let it;
    try {
      it = await item(titular, itemId);
    } catch (e) {
      console.log(`  ⚠️  item ${itemId.slice(0, 8)}: ${e.message.slice(0, 120)}`);
      erros++;
      continue;
    }

    // Consentimento vencido ou erro de conexão: avisa e PULA. Zerar a conta porque o banco
    // não respondeu hoje é como um painel aprende a mentir.
    if (it.status !== 'UPDATED' || it.executionStatus !== 'SUCCESS') {
      console.log(
        `  ⚠️  item ${itemId.slice(0, 8)} com status ${it.status}/${it.executionStatus} — pulado`
      );
      erros++;
      continue;
    }

    const cs = await contas(titular, itemId);
    const banco = bancoDoItem(cs);

    // Conta PJ (CNPJ, 14 dígitos) conectada no mesmo Meu Pluggy: pelo nome sairia "Inter
    // Conta Principal", e o garantirMeio, que casa por nome, religaria a conta pessoal na PJ.
    // O item com CNPJ vira "Empresa" no nome e "empresa" no titular. O cartão do item não traz
    // documento, por isso a decisão é do item, não da conta.
    const ehEmpresa = cs.some((c) => soDigitos(c.taxNumber).length === 14);

    for (const c of cs) {
      if (c.taxNumber) CPFS_PROPRIOS.add(soDigitos(c.taxNumber));
      const nomeBruto = nomeDoMeio(c, banco, ehEmpresa ? 'Empresa' : titular);
      plano.push({
        titular,
        titularMeio: ehEmpresa ? 'empresa' : titulo(titular),
        itemId,
        c,
        nome: MEIO_EXISTENTE[nomeBruto] ?? nomeBruto,
        ehCartao: c.type === 'CREDIT',
      });
    }
  }
}

console.log(
  `\ncontas encontradas: ${plano.length} · documentos próprios reconhecidos: ${CPFS_PROPRIOS.size}\n`
);

// ── 2ª passada: sincronização ────────────────────────────────────────────────
for (const alvo of plano) {
  try {
    resumo.push(await sincronizarConta(alvo));
  } catch (e) {
    console.log(`  ❌ ${alvo.nome}: ${e.message.slice(0, 200)}`);
    erros++;
  }
}

console.log('\n──────────────────────────────────────────────────────────────────────────────');
console.log(
  'meio de pagamento'.padEnd(28) +
    'transações'.padStart(11) +
    'novas'.padStart(8) +
    'atualiz.'.padStart(9) +
    'faturas'.padStart(9) +
    'gasto na janela'.padStart(18)
);
for (const r of resumo) {
  console.log(
    r.nome.padEnd(28) +
      String(r.lidas).padStart(11) +
      String(r.criados).padStart(8) +
      String(r.atualizados).padStart(9) +
      String(r.faturas).padStart(9) +
      brl(r.gasto).padStart(18)
  );
}
const tot = resumo.reduce(
  (a, r) => ({
    lidas: a.lidas + r.lidas,
    criados: a.criados + r.criados,
    atualizados: a.atualizados + r.atualizados,
    faturas: a.faturas + r.faturas,
  }),
  { lidas: 0, criados: 0, atualizados: 0, faturas: 0 }
);
console.log('──────────────────────────────────────────────────────────────────────────────');
console.log(
  'TOTAL'.padEnd(28) +
    String(tot.lidas).padStart(11) +
    String(tot.criados).padStart(8) +
    String(tot.atualizados).padStart(9) +
    String(tot.faturas).padStart(9)
);
if (erros) console.log(`\n⚠️  ${erros} conexão(ões)/conta(s) com problema — ver acima.`);
if (DRY) console.log('\nnada foi gravado (--dry). Rode sem --dry para valer.');

await pool.end();

// ─────────────────────────────────────────────────────────────────────────────
async function sincronizarConta({ titular, titularMeio, itemId, c, nome, ehCartao }) {
  const bills = ehCartao ? await faturas(titular, c.id) : [];
  const ts = await transacoes(titular, c.id, DESDE, ATE);

  const linha = { nome, lidas: ts.length, criados: 0, atualizados: 0, faturas: 0, gasto: 0 };

  // Conta sem transação nenhuma e sem fatura não vira cadastro. O Pluggy lista tudo que o
  // banco expõe — poupança zerada, cartão cancelado, limite simbólico — e cada uma dessas
  // viraria um meio de pagamento morto, com dia de fechamento inventado só pra satisfazer
  // a constraint do schema. Aparece quando tiver movimento.
  if (!ts.length && !bills.length) {
    console.log(`  ·  ${nome.padEnd(26)} sem movimento no Pluggy — não cadastrada`);
    return linha;
  }

  // Ciclo do cartão: sai das faturas reais; o creditData é o plano B.
  const ultima = bills.slice().sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))[0];
  const diaVenc = ultima
    ? Number(isoDe(ultima.dueDate).slice(8, 10))
    : c.creditData?.balanceDueDate
      ? Number(isoDe(c.creditData.balanceDueDate).slice(8, 10))
      : null;
  const diaFech = ultima?.billClosingDate
    ? Number(isoDe(ultima.billClosingDate).slice(8, 10))
    : null;

  const normalizadas = ts.map((t) => normalizar(t, { ehCartao, regras, cats }));
  linha.gasto = normalizadas
    .filter((n) => !n.naoEConsumo && n.valor > 0)
    .reduce((s, n) => s + n.valor, 0);

  if (DRY) {
    const semCat = normalizadas.filter((n) => !n.categoria_id).length;
    linha.faturas = bills.length;
    console.log(
      `  ${nome.padEnd(26)} ${String(ts.length).padStart(5)} transações · ` +
        `${bills.length} faturas · ${semCat} sem categoria · gasto ${brl(linha.gasto)}` +
        (ehCartao ? ` · ciclo ${diaFech ?? '?'}/${diaVenc ?? '?'}` : '')
    );
    return linha;
  }

  const meio = await garantirMeio({ c, nome, ehCartao, itemId, diaFech, diaVenc, titularMeio });

  if (REFAZER_TUDO || (REFAZER && nome.toLowerCase() === REFAZER.toLowerCase())) {
    const del = await q(
      `delete from financeiro.lancamentos
        where origem = 'open_finance' and meio_pagamento_id = $1
        returning id`,
      [meio.id]
    );
    console.log(
      `  ♻️  ${nome}: ${del.length} lançamentos open_finance apagados antes de recarregar`
    );
  }

  // Faturas primeiro: o lançamento do cartão precisa do id da fatura em que cai.
  const porCompetencia = new Map();
  for (const b of bills) {
    const f = await gravarFatura(meio, b);
    if (f) {
      porCompetencia.set(f.competencia_iso, f);
      linha.faturas++;
    }
  }

  const imp = await q1(
    `insert into financeiro.importacoes (meio_pagamento_id, arquivo_nome, formato, linhas_lidas)
     values ($1, $2, 'pluggy_api', $3) returning id`,
    [meio.id, `pluggy:${c.id}`, ts.length]
  );

  for (const n of normalizadas) {
    const fatura = ehCartao ? porCompetencia.get(n.competencia) : null;
    const paga = fatura?.situacao === 'paga';
    const situacao = n.naoEConsumo ? 'cancelado' : ehCartao ? (paga ? 'pago' : 'previsto') : 'pago';
    const pagoEm =
      situacao !== 'pago' ? null : ehCartao ? (fatura?.pago_em ?? fatura?.vencimento) : n.data;

    const r = await q(
      `insert into financeiro.lancamentos
         (descricao, categoria_id, meio_pagamento_id, fatura_id, data, competencia, valor,
          parcela_num, parcela_total, situacao, pago_em, origem, pluggy_transaction_id,
          importacao_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open_finance',$12,$13)
       on conflict (pluggy_transaction_id) do update set
         descricao     = excluded.descricao,
         valor         = excluded.valor,
         data          = excluded.data,
         competencia   = excluded.competencia,
         fatura_id     = coalesce(excluded.fatura_id, financeiro.lancamentos.fatura_id),
         parcela_num   = excluded.parcela_num,
         parcela_total = excluded.parcela_total,
         situacao      = excluded.situacao,
         pago_em       = excluded.pago_em,
         categoria_id  = coalesce(financeiro.lancamentos.categoria_id, excluded.categoria_id)
       returning (xmax = 0) as criado`,
      [
        n.descricao,
        n.categoria_id,
        meio.id,
        fatura?.id ?? null,
        n.data,
        n.competencia,
        n.valor,
        n.parcela_num,
        n.parcela_total,
        situacao,
        pagoEm,
        n.pluggy_transaction_id,
        imp.id,
      ]
    );
    if (r[0]?.criado) linha.criados++;
    else linha.atualizados++;
  }

  await q(
    `update financeiro.importacoes set criados = $2, duplicados_ignorados = $3 where id = $1`,
    [imp.id, linha.criados, linha.atualizados]
  );
  await q(`update financeiro.meios_pagamento set pluggy_sync_em = now() where id = $1`, [meio.id]);

  console.log(
    `  ✔ ${nome.padEnd(26)} ${String(linha.criados).padStart(5)} novas · ` +
      `${linha.atualizados} atualizadas · ${linha.faturas} faturas`
  );
  return linha;
}

async function garantirMeio({ c, nome, ehCartao, itemId, diaFech, diaVenc, titularMeio }) {
  const achado =
    (await q1(`select * from financeiro.meios_pagamento where pluggy_account_id = $1`, [c.id])) ??
    (await q1(`select * from financeiro.meios_pagamento where nome = $1`, [nome]));

  const tipo = ehCartao ? 'cartao_credito' : 'debito_pix';
  // A constraint `cartao_tem_ciclo` existe porque sem ciclo o total nunca bate com o app do
  // banco. Cartão sem fatura nenhuma (os zerados) entra com o vencimento do creditData e o
  // fechamento estimado 7 dias antes — declarado na observação, não escondido.
  const fech = ehCartao ? (diaFech ?? (diaVenc ? ((diaVenc + 22) % 31) + 1 : 1)) : null;
  const venc = ehCartao ? (diaVenc ?? 1) : null;
  const estimado = ehCartao && !diaFech;
  const T = titularMeio;

  if (achado) {
    await q(
      `update financeiro.meios_pagamento
          set pluggy_item_id    = $2,
              pluggy_account_id = $3,
              titular           = coalesce(titular, $4),
              limite            = coalesce($5, limite),
              dia_fechamento    = coalesce(dia_fechamento, $6),
              dia_vencimento    = coalesce(dia_vencimento, $7)
        where id = $1`,
      [achado.id, itemId, c.id, T, c.creditData?.creditLimit ?? null, fech, venc]
    );
    return achado;
  }

  const novo = await q1(
    `insert into financeiro.meios_pagamento
       (nome, tipo, titular, dia_fechamento, dia_vencimento, limite, observacao,
        pluggy_item_id, pluggy_account_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning *`,
    [
      nome,
      tipo,
      T,
      fech,
      venc,
      c.creditData?.creditLimit ?? null,
      'Criado pela sincronização do Open Finance' +
        (estimado ? ' — dia de fechamento estimado (sem fatura no Pluggy)' : ''),
      itemId,
      c.id,
    ]
  );
  console.log(`  ➕ meio de pagamento criado: ${nome}`);
  return novo;
}

/**
 * Fatura nova entra com a situação derivada do Pluggy. Fatura que JÁ existe tem os campos
 * factuais atualizados, mas mantém a `situacao` que está lá: se você corrigiu o pago/atrasado
 * de uma fatura (pedindo ao agente), sobrescrever isso com um palpite automático apagaria a
 * única leitura confiável daquele mês.
 */
async function gravarFatura(meio, b) {
  const { situacao, pago, venc, fech } = situacaoDaFatura(b);
  const competencia = primeiroDoMes(venc);
  const pagoEm =
    (b.payments ?? [])
      .map((p) => isoDe(p.paymentDate))
      .sort()
      .at(-1) ?? null;

  const existente = await q1(
    `select id, situacao from financeiro.faturas where meio_pagamento_id = $1 and competencia = $2`,
    [meio.id, competencia]
  );

  if (existente) {
    await q(
      `update financeiro.faturas
          set fechamento      = $2,
              vencimento      = $3,
              total_informado = $4,
              pluggy_bill_id  = $5,
              pago_em         = coalesce(pago_em, $6),
              valor_pago      = coalesce(valor_pago, $7)
        where id = $1`,
      [existente.id, fech, venc, b.totalAmount ?? null, b.id, pagoEm, pago || null]
    );
    return { ...existente, competencia_iso: competencia, pago_em: pagoEm, vencimento: venc };
  }

  const nova = await q1(
    `insert into financeiro.faturas
       (meio_pagamento_id, competencia, fechamento, vencimento, total_informado, situacao,
        pago_em, valor_pago, pluggy_bill_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id, situacao`,
    [meio.id, competencia, fech, venc, b.totalAmount ?? null, situacao, pagoEm, pago || null, b.id]
  );
  return { ...nova, competencia_iso: competencia, pago_em: pagoEm, vencimento: venc };
}

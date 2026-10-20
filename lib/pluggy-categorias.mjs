/**
 * De-para das categorias do Pluggy para as categorias do painel.
 *
 * Ordem de decisão na importação:
 *   1. `regras_categoria` do banco  — é onde mora a correção que você pede ao agente
 *   2. este de-para                 — desempate, com a categoria que o próprio banco atribuiu
 *   3. nada                         — fica SEM categoria, visível na tela, pronto pra virar regra
 *
 * O que NÃO está aqui é de propósito. `Transfers`, `Transfer - PIX` e `Transfer - Bank Slip`
 * são "paguei alguém": pode ser aluguel, pode ser pizza. Chutar uma categoria aqui produz um
 * gráfico bonito e errado — e é justamente o número que você vai usar pra caçar vazamento.
 */

/** Categoria do painel por categoria do Pluggy. */
export const DE_PARA = {
  // Casa
  Rent: 'Moradia',
  Utilities: 'Moradia',
  'Electricity bill': 'Moradia',
  'Water bill': 'Moradia',
  'Gas bill': 'Moradia',
  Telecommunications: 'Moradia',
  Internet: 'Moradia',
  'Mobile phone': 'Moradia',
  'Home improvement': 'Moradia',

  // Comida
  Groceries: 'Mercado',
  Supermarkets: 'Mercado',
  'Eating out': 'Alimentação',
  'Food and drinks': 'Alimentação',
  'Food delivery': 'Alimentação',

  // Rodar
  'Taxi and ride-hailing': 'Transporte',
  'Public transportation': 'Transporte',
  'Gas stations': 'Transporte',
  Fuel: 'Transporte',
  Parking: 'Transporte',
  Automotive: 'Transporte',
  'Car rental': 'Transporte',
  Tolls: 'Transporte',

  // Corpo
  Pharmacy: 'Saúde',
  Optometry: 'Saúde',
  Dentist: 'Saúde',
  Doctors: 'Saúde',
  'Medical services': 'Saúde',
  Healthcare: 'Saúde',
  'Health insurance': 'Saúde',
  Gyms: 'Saúde',
  'Sports and fitness': 'Saúde',

  // Comprar
  Shopping: 'Compras',
  'Office supplies': 'Compras',
  Electronics: 'Compras',
  'Books and magazines': 'Compras',
  Clothing: 'Vestuário',
  'Clothing and accessories': 'Vestuário',

  // Assinar
  'Video streaming': 'Assinaturas',
  'Music streaming': 'Assinaturas',
  'Digital services': 'Assinaturas',
  Software: 'Assinaturas',
  'Online games': 'Assinaturas',

  // Aprender e viver
  University: 'Educação',
  Education: 'Educação',
  Courses: 'Educação',
  'Cinema, theater and concerts': 'Lazer',
  Travel: 'Lazer',
  Entertainment: 'Lazer',
  Donations: 'Outros',

  // O que o banco cobra
  'Interests charged': 'Encargos',
  'Tax on financial operations': 'Encargos',
  'Late payment and overdraft costs': 'Encargos',
  'Bank fees': 'Encargos',
  'Loans and financing': 'Encargos',
  Taxes: 'Impostos',

  // Não é consumo (ver TRATAMENTO abaixo)
  'Credit card payment': 'Pagamento de fatura',
  'Same person transfer': 'Transferência',
  'Same person transfer - CASH': 'Saque',
  Income: 'Entrada',
  Salary: 'Entrada',
  'Wage payments': 'Entrada',
};

/**
 * Categorias que não são consumo e por isso entram como `cancelado` — auditáveis, fora de
 * toda soma de gasto.
 *
 * `Same person transfer - CASH` (saque) fica de FORA desta lista de propósito: dinheiro que
 * saiu para a mão é gasto até prova em contrário. Esconder saque é esconder exatamente o
 * tipo de vazamento que o painel existe pra achar.
 */
export const NAO_E_CONSUMO = new Set(['Credit card payment', 'Same person transfer']);

/** @param {string|null} categoriaPluggy */
export const paraCategoria = (categoriaPluggy) => DE_PARA[categoriaPluggy] ?? null;

/**
 * O que a categoria do Pluggy erra e a descrição acerta.
 *
 * Três casos que, sem isto, fazem o painel mentir:
 *
 * 1. **Pagamento de fatura no cartão do Inter** chega como "PAGAMENTO ON LINE" na categoria
 *    `Shopping`. Entra como crédito de compra, e o total da fatura fecha negativo — o
 *    contrário exato do que o app do banco mostra.
 * 2. **Pagamento de fatura visto do lado da conta corrente** ("Pagamento efetuado - Fatura
 *    cartão Inter"). A compra já está detalhada no cartão; somar o pagamento conta duas vezes.
 * 3. **Aplicação e resgate de CDB** são movimento de patrimônio, não gasto. Sem isto, cada
 *    aplicação ("Aplicação - CDB …") aparece como consumo do mês.
 */
const PAGAMENTO_DE_FATURA = [
  /pagamento\s+on\s*line/i,
  /pgto\.?\s*fatura/i,
  /pagamento\s+(d[ae]\s+)?fatura/i,
  /pagamento\s+recebido/i,
  /^pagamento\s+efetuado.*fatura/i,
];

/**
 * O contra-lançamento da dívida que rola.
 *
 * O Nubank lança o saldo devedor como DÉBITO numa fatura ("Saldo em rotativo") e o CRÉDITO
 * correspondente na outra ("Crédito de rotativo"). São as duas metades do mesmo movimento de
 * dívida — nenhuma é consumo. Somar só o crédito faz o mês fechar com gasto negativo; somar só
 * o débito conta a mesma compra duas vezes. Os dois vão para `Saldo rolado`, que já é ignorado
 * em toda soma de gasto.
 *
 * "Desconto (NuFinanceira)" e "Crédito de parcelamento" são a mesma família: o desconto de
 * uma renegociação é redução de dívida, não dinheiro que entrou no mês.
 */
const DIVIDA_ROLADA = [
  /cr[ée]dito de rotativo/i,
  /cr[ée]dito de atraso/i,
  /cr[ée]dito de parcelamento/i,
  /encerramento de d[íi]vida/i,
  /desconto \(nufinanceira\)/i,
  /saldo em rotativo/i,
  /saldo em atraso/i,
  /valor pendente do m[êe]s anterior/i,
];

const INVESTIMENTO = [
  /aplica[çc][ãa]o/i,
  /resgate/i,
  /\bcdb\b/i,
  /porquinho/i,
  /tesouro\s+direto/i,
  /previd[êe]ncia/i,
];

/**
 * Classificação que vem da descrição, não da categoria do banco.
 * @param {string} descricao
 * @param {{ehCartao: boolean, entrada: boolean}} ctx
 * @returns {{categoria: string, naoEConsumo: boolean}|null}
 */
export function porDescricao(descricao, { ehCartao, entrada }) {
  const d = String(descricao ?? '');

  // Vem primeiro: "Crédito de rotativo" também casa com o teste de pagamento de fatura, e
  // classificá-lo como quitação o tiraria do total da fatura — que é justamente onde ele
  // precisa ficar para o número bater com o app do banco.
  if (DIVIDA_ROLADA.some((re) => re.test(d))) {
    return { categoria: 'Saldo rolado', naoEConsumo: false };
  }

  // Dinheiro chegando na conta corrente é receita, mesmo quando o remetente tem nome de
  // categoria: um Pix RECEBIDO de quem você pagou um almoço não é "Alimentação", é reembolso.
  if (!ehCartao && entrada && /recebid[oa]/i.test(d)) {
    return { categoria: 'Entrada', naoEConsumo: false };
  }

  // No cartão só um crédito pode ser quitação; um débito chamado "pagamento" é compra.
  if ((!ehCartao || entrada) && PAGAMENTO_DE_FATURA.some((re) => re.test(d))) {
    return { categoria: 'Pagamento de fatura', naoEConsumo: true };
  }
  if (!ehCartao && INVESTIMENTO.some((re) => re.test(d))) {
    return { categoria: 'Investimento', naoEConsumo: true };
  }
  return null;
}

-- Open Finance via Pluggy (Meu Pluggy)
--
-- O extrato passa a vir da API, com id estável de transação. A origem `open_finance` é
-- separada de propósito: "apagar e refazer a carga" nunca alcança um lançamento manual.

-- ─────────────────────────────────────────────────────────────
-- 1. Origem nova
-- ─────────────────────────────────────────────────────────────

alter type financeiro.origem_lancamento add value if not exists 'open_finance';

-- ─────────────────────────────────────────────────────────────
-- 2. O vínculo com o Pluggy mora no meio de pagamento
--    Uma conta bancária É um meio de pagamento. Tabela de-para separada criaria
--    uma segunda verdade sobre a mesma coisa.
-- ─────────────────────────────────────────────────────────────

alter table financeiro.meios_pagamento
  add column if not exists pluggy_item_id    text,
  add column if not exists pluggy_account_id text unique,
  add column if not exists pluggy_sync_em    timestamptz;

comment on column financeiro.meios_pagamento.pluggy_account_id is
  'Conta no Pluggy. Unique: é por ele que a sincronização reconhece um meio já cadastrado '
  'em vez de criar um duplicado a cada rodada.';

-- ─────────────────────────────────────────────────────────────
-- 3. Dedupe desta origem: o id do próprio banco, não um hash inventado
-- ─────────────────────────────────────────────────────────────

alter table financeiro.lancamentos
  add column if not exists pluggy_transaction_id text unique;

comment on column financeiro.lancamentos.pluggy_transaction_id is
  'Id estável da transação no Pluggy. Substitui a chave_dedupe (hash de descrição+valor+data) '
  'nesta origem — não há empate a desfazer quando o banco emite o identificador.';

alter table financeiro.faturas
  add column if not exists pluggy_bill_id text unique;

create index if not exists lancamentos_origem_idx on financeiro.lancamentos (origem);

-- ─────────────────────────────────────────────────────────────
-- 4. Categorias que só existem porque o extrato de conta corrente chegou
--
--    Fatura de cartão só tem consumo. Extrato tem dinheiro entrando, dinheiro indo de uma
--    conta sua para outra conta sua, e saque. Sem lugar próprio, os três viram "gasto" e a
--    resposta sai errada justamente na pergunta que importa: onde o dinheiro vaza.
-- ─────────────────────────────────────────────────────────────

insert into financeiro.categorias (nome, escopo) values
  ('Entrada',       'pessoal'),   -- salário, Pix recebido, estorno em conta: receita, não gasto
  ('Transferência', 'pessoal'),   -- entre contas suas (ou da casa): não é consumo, só muda de bolso
  ('Saque',         'pessoal')    -- dinheiro na mão: é gasto até prova em contrário, e por isso SOMA
on conflict (nome, escopo) do nothing;

comment on column financeiro.lancamentos.situacao is
  'previsto | pago | atrasado | cancelado. `cancelado` significa "não é consumo": pagamento de '
  'fatura e transferência entre contas próprias entram assim, ficam auditáveis e somem de '
  'toda soma de gasto.';

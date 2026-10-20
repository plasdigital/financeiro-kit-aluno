-- Financeiro com Open Finance — schema base (schema próprio: `financeiro`)
--
-- A regra que não se negocia: nada em public.*. Schema próprio é o que permite, um dia, dar
-- a um painel uma credencial que enxerga só o financeiro e mais nada.

create schema if not exists financeiro;

-- ─────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────

create type financeiro.tipo_meio          as enum ('cartao_credito','boleto','debito_pix','outro');
create type financeiro.tipo_despesa       as enum ('recorrente','parcelada','avulsa');
create type financeiro.situacao_despesa   as enum ('ativa','encerrada','pausada','renegociada');
create type financeiro.situacao_lancamento as enum ('previsto','pago','atrasado','cancelado');
create type financeiro.situacao_fatura    as enum ('aberta','fechada','paga','atrasada');
create type financeiro.origem_lancamento  as enum ('manual','importacao','gerado','whatsapp');
create type financeiro.escopo_categoria   as enum ('pessoal','empresa');
create type financeiro.tipo_match         as enum ('contem','regex','exato');

-- ─────────────────────────────────────────────────────────────
-- meios_pagamento — o CANO por onde a despesa sai.
-- Cartão de crédito NÃO é conta; é meio. A conta vira fatura.
-- ─────────────────────────────────────────────────────────────

create table financeiro.meios_pagamento (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null unique,
  tipo               financeiro.tipo_meio not null,
  titular            text,                                    -- cartão de terceiro é caso real
  dia_fechamento     smallint check (dia_fechamento between 1 and 31),
  dia_vencimento     smallint check (dia_vencimento between 1 and 31),
  limite             numeric(12,2),
  juros_rotativo_mes numeric(6,3),                             -- % a.m. — alimenta o ranking de atraso
  ativo              boolean not null default true,
  observacao         text,
  created_at         timestamptz not null default now(),

  -- Sem ciclo, o total do painel nunca bate com o app do banco.
  constraint cartao_tem_ciclo check (
    tipo <> 'cartao_credito'
    or (dia_fechamento is not null and dia_vencimento is not null)
  )
);

comment on column financeiro.meios_pagamento.dia_fechamento is
  'Compra depois do fechamento cai na fatura seguinte. Obrigatório em cartão.';

-- ─────────────────────────────────────────────────────────────
-- categorias
-- ─────────────────────────────────────────────────────────────

create table financeiro.categorias (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  escopo     financeiro.escopo_categoria not null default 'pessoal',
  ativa      boolean not null default true,
  created_at timestamptz not null default now(),
  unique (nome, escopo)
);

comment on column financeiro.categorias.escopo is
  'Filtro da tela (pessoal/empresa), não uma segunda planilha.';

-- ─────────────────────────────────────────────────────────────
-- faturas — o agrupamento mensal de um cartão, que vira UM pagamento
-- ─────────────────────────────────────────────────────────────

create table financeiro.faturas (
  id                uuid primary key default gen_random_uuid(),
  meio_pagamento_id uuid not null references financeiro.meios_pagamento(id) on delete cascade,
  competencia       date not null,
  fechamento        date not null,
  vencimento        date not null,
  total_informado   numeric(12,2),          -- o que o banco diz; divergência vira alerta
  situacao          financeiro.situacao_fatura not null default 'aberta',
  pago_em           date,
  valor_pago        numeric(12,2),          -- menor que o total = rotativo
  created_at        timestamptz not null default now(),
  unique (meio_pagamento_id, competencia),
  constraint competencia_no_dia_1 check (extract(day from competencia) = 1),
  constraint vence_depois_de_fechar check (vencimento >= fechamento)
);

-- O total calculado é VIEW, não coluna (ver v_faturas no fim).
-- Coluna materializada exigiria trigger e criaria uma segunda verdade sobre o mesmo número.

-- ─────────────────────────────────────────────────────────────
-- importacoes — auditoria de cada arquivo importado (permite desfazer o lote)
-- ─────────────────────────────────────────────────────────────

create table financeiro.importacoes (
  id                   uuid primary key default gen_random_uuid(),
  meio_pagamento_id    uuid not null references financeiro.meios_pagamento(id) on delete cascade,
  arquivo_nome         text not null,
  formato              text not null default 'nubank_csv',
  linhas_lidas         int not null default 0,
  criados              int not null default 0,
  duplicados_ignorados int not null default 0,
  importado_em         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- despesas — a REGRA ("o que eu consumo")
-- ─────────────────────────────────────────────────────────────

create table financeiro.despesas (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  categoria_id      uuid references financeiro.categorias(id) on delete set null,
  meio_pagamento_id uuid not null references financeiro.meios_pagamento(id) on delete restrict,
  tipo              financeiro.tipo_despesa not null,
  valor_previsto    numeric(12,2),
  valor_total       numeric(12,2),          -- só parcelada; base da amortização
  parcelas_total    smallint check (parcelas_total > 0),
  dia_vencimento    smallint check (dia_vencimento between 1 and 31),
  inicio            date not null default current_date,
  fim               date,                   -- preenchido = conta encerrada
  situacao          financeiro.situacao_despesa not null default 'ativa',
  juros_atraso_mes  numeric(6,3),           -- % a.m.
  multa_atraso      numeric(6,3),           -- % sobre o valor
  peso_consequencia smallint not null default 3 check (peso_consequencia between 1 and 5),
  contrato_url      text,                   -- Storage, bucket privado
  observacao        text,
  created_at        timestamptz not null default now(),

  constraint parcelada_tem_total check (
    tipo <> 'parcelada'
    or (valor_total is not null and parcelas_total is not null)
  ),
  constraint fim_depois_do_inicio check (fim is null or fim >= inicio)
);

comment on column financeiro.despesas.peso_consequencia is
  '1 a 5. O que impede o ranking de mandar atrasar o aluguel: juros do aluguel são baixos, '
  'a consequência é despejo. 5 = consequência máxima. Assinatura = 1.';

comment on table financeiro.despesas is
  'NÃO existe coluna parcelas_pagas. O andamento (17/30), o saldo devedor e o mês da última '
  'parcela são derivados dos lançamentos. Contador manual desincroniza na primeira amortização.';

-- ─────────────────────────────────────────────────────────────
-- lancamentos — a CÉLULA ("cada gasto individual")
-- ─────────────────────────────────────────────────────────────

create table financeiro.lancamentos (
  id                uuid primary key default gen_random_uuid(),
  despesa_id        uuid references financeiro.despesas(id) on delete cascade,
  importacao_id     uuid references financeiro.importacoes(id) on delete set null,
  descricao         text not null,          -- o `title` cru do CSV
  categoria_id      uuid references financeiro.categorias(id) on delete set null,
  meio_pagamento_id uuid not null references financeiro.meios_pagamento(id) on delete restrict,
  fatura_id         uuid references financeiro.faturas(id) on delete set null,
  data              date not null,          -- data da compra
  competencia       date not null,          -- 1º dia do mês a que pertence
  valor             numeric(12,2) not null, -- NEGATIVO = crédito/estorno
  parcela_num       smallint,
  parcela_total     smallint,
  situacao          financeiro.situacao_lancamento not null default 'previsto',
  pago_em           date,
  valor_pago        numeric(12,2),          -- pagou menos que o previsto? fica registrado
  origem            financeiro.origem_lancamento not null default 'manual',
  chave_dedupe      text unique,            -- ver 0002 e lib/import/dedupe.ts
  observacao        text,
  created_at        timestamptz not null default now(),

  constraint competencia_no_dia_1 check (extract(day from competencia) = 1),
  constraint pago_tem_data       check (situacao <> 'pago' or pago_em is not null),
  constraint parcela_coerente    check (
    (parcela_num is null and parcela_total is null)
    or (parcela_num is not null and parcela_total is not null and parcela_num <= parcela_total)
  )
);

comment on column financeiro.lancamentos.despesa_id is
  'NULL = compra avulsa importada da fatura (a maioria dos lançamentos de cartão).';

comment on column financeiro.lancamentos.chave_dedupe is
  'hash(meio, data, descricao, valor, ocorrencia_n). O ocorrencia_n existe porque duas corridas '
  'de Uber do mesmo valor no mesmo dia são legítimas — e acontecem no extrato real.';

create index on financeiro.lancamentos (meio_pagamento_id, competencia);
create index on financeiro.lancamentos (despesa_id);
create index on financeiro.lancamentos (data desc);
create index on financeiro.lancamentos (categoria_id);
create index on financeiro.lancamentos (fatura_id);
create index on financeiro.lancamentos (situacao)
  where situacao in ('previsto','atrasado');

-- ─────────────────────────────────────────────────────────────
-- regras_categoria — o aprendizado. Corrige uma vez, nunca mais erra.
-- ─────────────────────────────────────────────────────────────

create table financeiro.regras_categoria (
  id           uuid primary key default gen_random_uuid(),
  padrao       text not null,
  tipo_match   financeiro.tipo_match not null default 'contem',
  categoria_id uuid not null references financeiro.categorias(id) on delete cascade,
  prioridade   smallint not null default 100,   -- menor = avaliada antes
  ativa        boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (padrao, tipo_match)
);

create index on financeiro.regras_categoria (prioridade) where ativa;

-- ─────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────

-- Total da fatura sempre ao vivo. `Pagamento recebido` não é gasto — é quitação,
-- e o parser o marca como cancelado, então ele já não entra nesta soma.
create view financeiro.v_faturas as
select
  f.*,
  coalesce(sum(l.valor) filter (where l.situacao <> 'cancelado'), 0) as total_calculado,
  count(l.id)                                                        as qtd_lancamentos,
  case
    when f.total_informado is null then null
    else round(f.total_informado
               - coalesce(sum(l.valor) filter (where l.situacao <> 'cancelado'), 0), 2)
  end as divergencia
from financeiro.faturas f
left join financeiro.lancamentos l on l.fatura_id = f.id
group by f.id;

-- Andamento de cada parcelada: o "17/30" derivado, nunca digitado.
create view financeiro.v_parceladas as
select
  d.id,
  d.nome,
  d.valor_total,
  d.parcelas_total,
  count(l.id) filter (where l.situacao = 'pago')                     as parcelas_pagas,
  d.parcelas_total - count(l.id) filter (where l.situacao = 'pago')  as parcelas_restantes,
  coalesce(sum(l.valor_pago) filter (where l.situacao = 'pago'), 0)  as total_pago,
  d.valor_total
    - coalesce(sum(l.valor_pago) filter (where l.situacao = 'pago'), 0) as saldo_devedor,
  max(l.competencia) filter (where l.situacao <> 'cancelado')        as ultima_competencia
from financeiro.despesas d
left join financeiro.lancamentos l on l.despesa_id = d.id
where d.tipo = 'parcelada'
group by d.id;

-- ─────────────────────────────────────────────────────────────
-- RLS — ligada em tudo, SEM policy permissiva, de propósito.
-- Consequência: anon e authenticated não acessam nada.
-- Acessa quem bypassa RLS: service_role, ou a role dedicada de 0003.
-- ─────────────────────────────────────────────────────────────

alter table financeiro.meios_pagamento  enable row level security;
alter table financeiro.categorias       enable row level security;
alter table financeiro.faturas          enable row level security;
alter table financeiro.importacoes      enable row level security;
alter table financeiro.despesas         enable row level security;
alter table financeiro.lancamentos      enable row level security;
alter table financeiro.regras_categoria enable row level security;

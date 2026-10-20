-- Regras de categoria para o vocabulário do Open Finance
--
-- O CSV do Nubank e a API do Pluggy descrevem a MESMA linha com palavras diferentes. A que
-- importa é a dívida que rola de um mês para o outro:
--
--   CSV     "Valor pendente do mês anterior"   → já tinha regra, cai em `Saldo rolado`
--   Pluggy  "Saldo em rotativo" / "Saldo em atraso"  → não tinha, caía como gasto
--
-- `Saldo rolado` é a categoria que a soma de gasto ignora por natureza: a compra que
-- originou aquele saldo já foi contada no mês em que aconteceu. Sem estas regras, todo mês
-- com rotativo aparece com um gasto que nunca existiu — a mesma dívida contada de novo.

insert into financeiro.regras_categoria (padrao, tipo_match, categoria_id, prioridade)
select v.padrao, 'contem', c.id, 10
  from (values
    ('Saldo em rotativo'),
    ('Saldo em atraso'),
    ('Saldo anterior'),
    ('Pagamento de fatura anterior')
  ) as v(padrao)
  cross join financeiro.categorias c
 where c.nome = 'Saldo rolado'
on conflict (padrao, tipo_match) do nothing;

-- Encargo do cartão é gasto de verdade (sai do bolso), e continua em `Encargos`:
-- juros de rotativo, IOF, multa. Só o principal que rola é que não se soma duas vezes.
insert into financeiro.regras_categoria (padrao, tipo_match, categoria_id, prioridade)
select v.padrao, 'contem', c.id, 20
  from (values
    ('Juros de rotativo'),
    ('Juros de dívida encerrada'),
    ('IOF de rotativo'),
    ('Multa de atraso'),
    ('Encargos de atraso')
  ) as v(padrao)
  cross join financeiro.categorias c
 where c.nome = 'Encargos'
on conflict (padrao, tipo_match) do nothing;



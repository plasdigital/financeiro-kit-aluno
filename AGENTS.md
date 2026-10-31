# AGENTS.md — manual do agente

## Regras que não se pulam

1. **É o dinheiro do dono.** Comando que grava (sincronizar, migrar, `sql.mjs --escrever`) só roda
   depois do "pode", mostrando antes o `--dry` ou o `select` equivalente.
2. **Segredo nunca sai do `.env.local`.** Não escreva chave nem senha em documento, em commit ou na
   resposta do chat.
3. **Nada move dinheiro.** Não existe caminho de pagamento e não se cria um.
4. **Nunca peça a senha do banco do dono.** O login do Open Finance é feito na tela do banco.
5. **Nada em `public`, nenhuma migration aplicada editada.** Tudo no schema `financeiro`.

## O que esta pasta faz

Lê bancos e cartões do dono por Open Finance (API do Pluggy), grava no schema `financeiro` do
Supabase dele e responde perguntas sobre o dinheiro com SQL. Só leitura do lado do banco.

## Primeira conversa: "me ajuda a configurar"

Siga o [COMECE-AQUI.md](COMECE-AQUI.md) **na ordem**. Antes de cada passo, rode o checador da
tabela abaixo e pule o que já está feito. Passo no navegador (criar conta, conectar banco, copiar
chave) é do dono: diga exatamente onde clicar e espere ele colar o valor.

| Etapa | Checador (read-only) | Pronto quando |
|---|---|---|
| dependências | `node -v` e a pasta `node_modules/` existe | Node ≥ 20 e `node_modules/` presente |
| chaves | `.env.local` existe na raiz | arquivo com `SUPABASE_DB_URL` e `PLUGGY_*` preenchidos |
| Pluggy | `node scripts/testar-pluggy.mjs` | `✅ ligação com o Pluggy ok` |
| banco | `node scripts/migrar.mjs --status` | nenhuma migration `pendente` |
| carga | `node scripts/sql.mjs "select count(*) from financeiro.lancamentos"` | maior que zero |
| conferência | `node scripts/conferir.mjs` | nenhuma linha com `⚠️ divergência` |

Valor que o dono colar no chat: grave direto no `.env.local` e **não repita o valor na resposta**.

## As possibilidades

### Read-only: pode rodar sem perguntar

| O dono pede | Comando |
|---|---|
| "a ligação está ok?" / "por que tal banco parou?" | `node scripts/testar-pluggy.mjs` |
| "o que a sincronização traria?" | `node scripts/sincronizar-pluggy.mjs --dry` |
| "confere a carga" / "bate com o app do banco?" | `node scripts/conferir.mjs` |
| qualquer pergunta sobre o dinheiro | `node scripts/sql.mjs "<select>"`, com as receitas abaixo |
| "o banco está criado?" | `node scripts/migrar.mjs --status` |

### Muda o mundo: mostre o que vai fazer e espere o "pode"

| O dono pede | Comando | Antes de rodar, mostre |
|---|---|---|
| "cria o banco" | `node scripts/migrar.mjs` | a lista de migrations pendentes (`--status`) |
| "sincroniza" | `node scripts/sincronizar-pluggy.mjs` | o resultado do `--dry` |
| a primeira carga | `node scripts/sincronizar-pluggy.mjs --tudo` | o resultado do `--dry` |
| "recarrega o cartão X do zero" | `node scripts/sincronizar-pluggy.mjs --refazer "Nome do meio"` | quantos lançamentos `open_finance` serão apagados |
| criar regra, lançar à mão, marcar pago, corrigir categoria | `node scripts/sql.mjs --escrever "<sql>"` | o SQL exato e quantas linhas ele toca (rode o `select` equivalente antes) |
| "agenda a sincronização todo dia" | agendador do sistema (abaixo) | o comando e o horário |

`--refazer-tudo` apaga **todo** o lote `open_finance`. Só com pedido explícito do dono para isso.

## Receitas de SQL

**Gasto = consumo.** Em toda soma de gasto, exclua: `situacao = 'cancelado'` (pagamento de fatura e
transferência entre contas próprias), as categorias `Saldo rolado`, `Entrada` e `Transferência`, e
`valor <= 0`. **Gasto é positivo e crédito é negativo** (a sincronização já normaliza o sinal).

```sql
-- o filtro de gasto (reuse em toda pergunta de "quanto gastei")
l.situacao <> 'cancelado' and l.valor > 0
and coalesce(c.nome, '') not in ('Saldo rolado', 'Entrada', 'Transferência')
```

| Pergunta | Base |
|---|---|
| resultado do mês | entradas = `sum(-l.valor)` com `c.nome = 'Entrada'`; saídas = soma com o filtro de gasto, as duas por `competencia` |
| pra onde foi o dinheiro | soma com o filtro de gasto, `group by c.nome`, ordenado pelo total |
| o que está em aberto | `financeiro.v_faturas` com `situacao in ('aberta','fechada','atrasada')`, por `vencimento` |
| juros e tarifa | soma com `c.nome = 'Encargos'` nos últimos 12 meses, por mês |
| sem categoria | `l.categoria_id is null` + o filtro de gasto, agrupado por `descricao` |
| maior gasto | o filtro de gasto, `order by l.valor desc` |

Joins: `financeiro.lancamentos l left join financeiro.categorias c on c.id = l.categoria_id join
financeiro.meios_pagamento m on m.id = l.meio_pagamento_id`. O mês de um lançamento é
`competencia` (1º dia do mês). No cartão, `competencia` é o mês da fatura, não o da compra.

**Responda em reais** (`R$ 1.234,56`), com o período escrito, e diga quando o número depende de
lançamento sem categoria ("R$ X ficaram sem categoria e não entraram nesta conta").

### Regra nova de categoria

```sql
insert into financeiro.regras_categoria (padrao, tipo_match, categoria_id, prioridade)
select 'POSTO X', 'contem', id, 30 from financeiro.categorias where nome = 'Transporte';

-- e aplica nas linhas que já estão no banco SEM categoria (nunca sobrescreve correção)
update financeiro.lancamentos l set categoria_id = c.id
  from financeiro.categorias c
 where c.nome = 'Transporte' and l.categoria_id is null
   and upper(l.descricao) like '%POSTO X%';
```

O `padrao` é casado contra a descrição em **maiúscula e sem acento**. Prioridade menor é avaliada
antes. **Nunca crie categoria nova por conta própria:** use uma das existentes (`select nome from
financeiro.categorias`). Categoria nova só com o dono pedindo pelo nome.

### Lançamento que o Open Finance não enxerga

Dinheiro em espécie, acerto fora do banco, conta que outra pessoa pagou: `origem = 'manual'`, num
meio de pagamento `tipo = 'outro'` (crie um chamado `Dinheiro` se não existir). Gasto positivo;
`competencia` é o 1º dia do mês; `situacao = 'pago'` exige `pago_em`.

## Agendar a sincronização

O Pluggy atualiza cada banco uma vez por dia; rodar mais que isso não traz nada novo.

- **Windows:** `schtasks /create /tn "Financeiro - sincronizar" /sc daily /st 08:00 /tr "cmd /c cd /d <PASTA> && node scripts\sincronizar-pluggy.mjs >> sincronizar.log 2>&1"`
- **macOS/Linux:** `crontab -e` → `0 8 * * * cd <PASTA> && node scripts/sincronizar-pluggy.mjs >> sincronizar.log 2>&1`

Troque `<PASTA>` pelo caminho absoluto desta pasta. Mostre a linha e o horário antes de criar.

## As travas

1. **Nunca grave sem o "pode".** Sincronizar, migrar, `--escrever`, `--refazer`: mostre antes o
   `--dry` ou o `select` equivalente.
2. **Nunca imprima nem repita** o conteúdo do `.env.local`: secret do Pluggy, senha do banco.
   Para conferir se uma chave existe, diga *existe / está vazia*.
3. **Nunca edite uma migration já aplicada.** Correção de schema é migration nova, com o próximo número.
4. **Nunca crie tabela em `public`.** Tudo no schema `financeiro`.
5. **Nunca peça a senha do banco do dono.** O login do Open Finance é na tela do banco, no meu.pluggy.ai.
6. **Nada move dinheiro.** Não existe e não se cria caminho de pagamento ou transferência.
7. **Não publique dado.** Nada de extrato, valor ou nome de quem recebeu Pix em commit, print, issue
   ou serviço externo. Pergunta respondida fica no terminal.
8. **Na dúvida, sem categoria.** Lançamento sem categoria é visível; na categoria errada, ele mente
   sem ninguém ver.

## As armadilhas

| O erro diz | O que é de verdade | Conserto |
|---|---|---|
| `/auth de <titular> falhou: 401` ou `403` | Client ID/Secret errado, de outra aplicação, ou com espaço colado | copiar de novo do dashboard.pluggy.ai |
| `GET /items/... 404` | o itemId não pertence a esta aplicação | "Ir para Demo" da **mesma** aplicação → "Copiar Item ID" |
| item `LOGIN_ERROR`, `OUTDATED` ou `WAITING_USER_INPUT` | consentimento vencido ou o banco pediu nova autorização | o dono reconecta o banco no meu.pluggy.ai |
| o banco não aparece no "Ir para Demo" | passou o teste de 15 dias do dashboard, ou o conector MeuPluggy não está na lista | conferir os conectores; se o teste acabou, falar com o suporte do Pluggy |
| `GET /v2/transactions ... 400` | parâmetro que a v2 recusa (`from`, `to`, `pageSize`) | o `lib/pluggy.mjs` já usa só `dateFrom`/`dateTo` e o cursor `next`; não acrescente outros |
| `SUPABASE_DB_URL não encontrada` | falta o `.env.local` na raiz, ou o nome da variável está errado | COMECE-AQUI, passo 4 |
| `password authentication failed` | a senha do banco está errada, ou o `[YOUR-PASSWORD]` ficou no texto | trocar pela senha do passo 3.1 (ou redefinir em Database Settings) |
| `Tenant or user not found` | host ou região do pooler errados | copiar a string de novo em **Connect → Transaction pooler** |
| `self-signed certificate` / `unable to verify` | a string é a conexão direta (`db.<ref>.supabase.co`), não o pooler | usar a do **Transaction pooler** |
| `relation "financeiro.x" does not exist` | o banco não foi criado | `node scripts/migrar.mjs` |
| `APLICADA MAS O ARQUIVO MUDOU DEPOIS` | alguém editou uma migration já aplicada | desfazer a edição e criar migration nova |
| fatura com `⚠️ divergência` no conferir | fatura ainda aberta (o total muda até fechar), estorno, ou compra internacional com IOF em outra data | fatura fechada divergindo: listar os lançamentos dela e comparar com o app do banco antes de concluir |
| gasto do mês quase o dobro | pagamento de fatura somado junto com as compras | conferir se o pagamento entrou como `cancelado`; se não, a regra em `lib/pluggy-categorias.mjs` (`PAGAMENTO_DE_FATURA`) precisa do texto que o banco dele usa |

## Onde está o porquê

- [docs/00-a-aula.md](docs/00-a-aula.md): a aula inteira, com as travas e o capítulo de segurança.
- Os comentários no topo de `scripts/sincronizar-pluggy.mjs` e de `lib/pluggy-categorias.mjs`
  explicam cada decisão de sinal, de categoria e de fatura.

# Comece aqui

A configuração inteira, na ordem. Você faz isso uma vez só.

> **Atalho.** Abra esta pasta no Claude Code (ou no Codex) e diga *"me ajuda a configurar"*. O
> agente segue estes mesmos passos com você, roda os testes e avisa o que falta. As partes que
> acontecem no navegador (criar conta, conectar banco) continuam sendo suas.

---

## 1. Instalar

| # | Passo | Deu certo quando |
|---|---|---|
| 1.1 | Instalar o **Node.js 20 ou mais novo** (nodejs.org) | `node -v` mostra `v20` ou maior |
| 1.2 | Abrir o terminal **nesta pasta** e rodar `npm install` | aparece a pasta `node_modules/` |

---

## 2. Pluggy: conectar os bancos

São dois sites diferentes, e é aqui que quase todo mundo se perde:

- **meu.pluggy.ai** é onde **os seus bancos** se conectam. É o aplicativo de consumidor, gratuito.
- **dashboard.pluggy.ai** é onde **o seu programa** ganha as chaves para ler o que está no Meu
  Pluggy. É o portal de desenvolvedor.

| # | Passo | Onde | Deu certo quando |
|---|---|---|---|
| 2.1 | Criar a conta e **conectar cada banco** pelo botão principal. O login é feito na tela do próprio banco (Open Finance) | meu.pluggy.ai | as contas aparecem lá sincronizando |
| 2.2 | Criar a conta de desenvolvedor | dashboard.pluggy.ai | você está dentro do dashboard |
| 2.3 | Criar uma **aplicação** em *Applications* | dashboard | a tela mostra **Client ID** e **Client Secret** |
| 2.4 | Deixar o conector **MeuPluggy** na sua lista de conectores, abrir a aplicação, clicar em **"Ir para Demo"** e conectar com **MeuPluggy**. Repita **uma vez por banco** conectado no passo 2.1 | dashboard → Demo | cada banco aparece no Demo |
| 2.5 | Em cada banco do Demo, abrir o menu de **três pontos** (canto superior direito) e clicar em **"Copiar Item ID"** | Demo | um itemId por banco, anotado |

> ⚠️ **Faça o passo 2.4 nos primeiros 15 dias.** Criar a conta no dashboard abre um período de
> teste de 15 dias, e é só dentro dele que dá para ligar o Meu Pluggy à sua aplicação. Depois que
> o teste acaba, o que já foi ligado continua sincronizando, mas a lista de bancos não muda mais.
> Por isso a regra é **conectar todos os bancos no 2.1 antes de fazer o 2.4**.

**O itemId é por banco, não por conta.** Um Nubank com conta e cartão é um itemId só, e a
sincronização descobre sozinha as contas que existem dentro dele.

**Onde a sua senha é digitada:** na tela do banco, no fluxo de consentimento. Ela não passa por
esta pasta, pelo Pluggy nem pela IA. Se alguma ferramenta pedir a senha do seu banco para "ler o
extrato", ela não está fazendo Open Finance: está raspando o site do banco e guardando a sua senha.

---

## 3. Supabase: onde o dado mora

| # | Passo | Onde | Deu certo quando |
|---|---|---|---|
| 3.1 | Criar um projeto. Região: **South America (São Paulo)**. Anote a **senha do banco** que você definir | supabase.com | o projeto existe |
| 3.2 | Botão **Connect**, no topo do projeto → **Transaction pooler** → copiar a connection string | painel do projeto | uma linha começando com `postgresql://postgres.` |

---

## 4. O arquivo de chaves

1. Copie o `.env.exemplo` para **`.env.local`**, na raiz desta pasta.
2. Preencha:

| Variável | De onde vem |
|---|---|
| `SUPABASE_DB_URL` | o passo 3.2, com `[YOUR-PASSWORD]` trocado pela senha do 3.1 |
| `PLUGGY_PRINCIPAL_CLIENT_ID` | passo 2.3 |
| `PLUGGY_PRINCIPAL_CLIENT_SECRET` | passo 2.3 |
| `PLUGGY_PRINCIPAL_ITEMS` | os itemIds do passo 2.5, separados por vírgula |

**Quer juntar as contas de outra pessoa da casa?** Ela cria um Meu Pluggy próprio (o Meu Pluggy
não aceita dois CPFs no mesmo perfil) e vira um segundo titular. Os nomes das variáveis estão no
fim do `.env.exemplo`.

---

## 5. Testar, criar o banco e carregar

Rode um comando de cada vez e só passe para o próximo quando o atual der certo.

| # | Comando | O que faz | Deu certo quando |
|---|---|---|---|
| 5.1 | `node scripts/testar-pluggy.mjs` | confere chaves, itemIds e status de cada banco. **Não grava nada** | `✅ ligação com o Pluggy ok` |
| 5.2 | `node scripts/migrar.mjs` | cria o schema `financeiro` no seu Supabase | `4 migration(s) aplicada(s)` |
| 5.3 | `node scripts/sincronizar-pluggy.mjs --dry` | mostra o que traria, **sem gravar** | as contagens fazem sentido |
| 5.4 | `node scripts/sincronizar-pluggy.mjs --tudo` | a primeira carga, com o histórico inteiro | a tabela final com `novas` |
| 5.5 | `node scripts/conferir.mjs` | fatura por fatura, o total calculado contra o total que o banco informa | os dois números iguais, mês a mês |

**O passo 5.5 é o que dá valor ao sistema.** Um número quase certo é pior do que nenhum, porque
você decide errado achando que está informado. Se uma fatura divergir, peça ao agente para
investigar antes de seguir.

---

## 6. Trocar as chaves

As chaves do Pluggy passaram pelo seu terminal e, provavelmente, por uma conversa com a IA. Depois
que a carga estiver conferida:

1. No **dashboard.pluggy.ai**, gere um **novo Client Secret** para a aplicação.
2. Cole o novo valor no `.env.local`.
3. Rode `node scripts/testar-pluggy.mjs` de novo.

Leva um minuto, e é o passo que quase todo mundo pula.

---

## 7. Usar

Daqui para frente, você conversa com o agente:

- *"sincroniza"*: traz o que entrou desde a última vez. O Pluggy atualiza cada banco uma vez por dia.
- *"quanto entrou e quanto saiu esse mês?"*
- *"pra onde foi o meu dinheiro em julho?"*
- *"o que ficou sem categoria?"* e depois *"Posto X é Transporte"*: o agente cria a regra e,
  daquele dia em diante, esse estabelecimento não erra mais.
- *"quanto eu paguei de juros e tarifa nos últimos 12 meses?"*
- *"agenda a sincronização para todo dia de manhã"*: o agente monta o agendamento no seu sistema
  operacional.

**O consentimento do Open Finance vence**, normalmente em 12 meses. Quando isso acontece, a
sincronização avisa e pula aquele banco em vez de zerar a conta. Para voltar, reconecte o banco
no meu.pluggy.ai.

# Open Finance com IA: extrato e fatura entrando sozinhos

> O material da aula, inteiro. O passo a passo prático desta pasta está em `COMECE-AQUI.md`.

## O que você vai conseguir

Parar de alimentar planilha. Os seus bancos e cartões passam a entrar sozinhos, uma vez por dia, por
**Open Finance** — o mesmo mecanismo que o seu banco usa para mostrar a conta de outro banco dentro do
app dele. A partir daí:

- a linha **"cartão: R$ 3.000"** deixa de ser um buraco e vira as **200 compras** que a formaram, cada
  uma com data, loja e categoria;
- você pergunta em português — *"quanto entrou e quanto saiu esse mês?"*, *"pra onde foi o meu dinheiro
  em julho?"*, *"o que ainda está em aberto?"* — e a resposta sai em segundos;
- o que estava previsto se cruza com o que saiu de verdade da conta, e a conta paga se marca sozinha.

**A ordem importa, e ela é o contrário da intuição: o banco primeiro, a tela por último.** Na primeira
semana você já responde qualquer pergunta sobre o seu dinheiro **sem existir uma única tela**. Desenhar
painel antes de ter dado real é desenhar no vácuo.

> A linha "cartão: três mil reais" não é informação, é um buraco. Ela esconde exatamente as duzentas
> decisões que fizeram o mês dar errado.

---

## O que você precisa ter na mão

| Ferramenta | Para quê | Custo |
|---|---|---|
| **Claude Code** | monta o banco, importa, categoriza e responde a pergunta | a assinatura da IA |
| **Supabase** | onde o dinheiro vira dado: um schema só seu, com a segurança ligada | grátis para começar |
| **Meu Pluggy** | o Open Finance: conecta os bancos e traz extrato e fatura | gratuito para uso pessoal |
| **O aplicativo do Claude no celular** | falar com o mesmo projeto fora do computador | a mesma assinatura |

**O que este material não cobre:** investimentos, previsão automática de gasto e qualquer coisa que
grave de volta no seu banco. O sistema é **só leitura** — nenhuma linha dele move dinheiro.

---

## Etapa 0 — a mesa

| # | Passo | Onde | Deu certo quando |
|---|---|---|---|
| 0.1 | Instalar o **Claude Code** | claude.com/code | o comando `claude` abre no terminal |
| 0.2 | Criar um projeto no **Supabase** | supabase.com | o projeto existe |
| 0.3 | Criar um **schema próprio** para o financeiro | pedindo ao agente | as tabelas existem, com a segurança de linha ligada |

**A regra que não se negocia:** nada em `public`. Schema próprio, sempre — é ele que permite dar acesso
a uma credencial que enxerga só o financeiro e mais nada.

---

## Etapa 1 — conectar os bancos (Open Finance)

| # | Passo | Onde | Deu certo quando |
|---|---|---|---|
| 1.1 | Criar conta no **Meu Pluggy** | meu.pluggy.ai | a conta existe |
| 1.2 | **Conectar cada banco**, com o login do próprio banco | ainda no Meu Pluggy | as contas aparecem sincronizando |
| 1.3 | Pegar **Client ID** e **Secret** | dashboard.pluggy.ai | as duas chaves na mão |
| 1.4 | Anotar os **itemIds** — um por conexão de banco | dashboard | a lista completa |
| 1.5 | Guardar tudo no arquivo de ambiente da pasta | a sua pasta | e nunca dentro do código |

**Onde a sua senha é digitada:** na tela do **próprio banco**, no fluxo de consentimento. Ela não passa
pelo sistema em momento nenhum. Ferramenta que pede a senha do seu banco para "ler o extrato" não está
fazendo Open Finance, está fazendo raspagem — e guardando a sua senha.

---

## Etapa 2 — a carga

| # | Passo | O que é | Deu certo quando |
|---|---|---|---|
| 2.1 | Rodar a sincronização **em modo de teste** primeiro | ele mostra o que traria, sem gravar nada | a contagem bate com o app do banco |
| 2.2 | Carregar o **histórico inteiro** | a primeira carga puxa anos de uma vez | as transações no banco |
| 2.3 | **Conferir mês a mês** | o total da fatura no seu sistema contra o app do banco | os dois números iguais |
| 2.4 | **Trocar os secrets** | as chaves passaram por conversa de chat e ficam no histórico | as chaves antigas mortas |

O passo 2.4 é o que quase todo mundo pula. Chave que apareceu numa conversa é chave usada; trocar leva
um minuto no painel do Pluggy.

---

## Etapa 3 — a prova, sem tela nenhuma

Com o dado no banco, o agente já responde. Peça em português:

- *"quanto entrou e quanto saiu esse mês?"* — o resultado do mês, sem abrir planilha
- *"pra onde foi o meu dinheiro em julho?"* — o gasto por categoria
- *"o que está em aberto?"* — as contas que ainda não foram pagas, por vencimento
- *"quanto eu paguei de juros e de tarifa nos últimos 12 meses?"* — **o número que dói**

Se você parar aqui, o sistema já vale o trabalho. Tela é conforto, não é o produto.

---

## Etapa 4 — o celular, sem construir aplicativo nenhum

A pergunta que aparece agora é sempre a mesma: *"e quando eu não estiver no computador?"*

A resposta não é construir um aplicativo. É abrir o **aplicativo do Claude** no celular e **selecionar
este projeto**. Ele passa a conversar com o mesmo banco que você acabou de montar — e daí, do celular,
você:

- **pergunta sobre as contas**, do mesmo jeito que perguntaria sentado no computador;
- **informa o que o Open Finance não enxerga** — o pagamento em dinheiro, o acerto que ficou fora do
  banco, a conta que outra pessoa pagou por você. Você conta em português e ele grava na tabela certa;
- **marca o que já foi pago** e corrige o que entrou errado.

**O que isso economiza é justamente a parte cara.** Todo projeto de finanças pessoais empaca no mesmo
lugar: a tela de cadastro para lançar à mão o que o banco não trouxe. Aqui essa tela não precisa
existir, porque a conversa faz o papel dela — no mesmo projeto e no mesmo banco, sem uma segunda coisa
para manter.

---

## Etapa 5 — o painel, se você quiser (é outro projeto)

Se em algum momento você quiser **métricas na tela** — o gráfico do mês, o cartão aberto, a fila de
atrasos, editar e marcar clicando em vez de conversando — isso existe, e é a construção de **um projeto
à parte**: um site simples lendo o mesmo banco, publicado com **login** e com uma **credencial de banco
dedicada**, que enxerga só o schema do financeiro.

**Esta aula não ensina a construir esse painel.** Ela termina onde o dado está no lugar, confere com o
app do banco e responde à pergunta. O painel é o passo seguinte de quem quiser, e o caminho é o mesmo
Claude Code, na mesma pasta.

---

## As travas — o que dá errado, e o conserto

| A trava | O que acontece | O conserto |
|---|---|---|
| **Contar a fatura e as compras dela** | o mês infla quase 100%: a linha do cartão **é** a soma das compras que estão dentro dele | escolher um dos dois lados na hora de somar, e deixar isso marcado no dado |
| **Cada fonte manda o valor na convenção dela** | uma conta traz a saída com sinal negativo, outra com positivo, e o mês inteiro sai trocado | padronizar **na entrada**: uma regra só, valendo para todas as fontes |
| **O consentimento do Open Finance vence** | o padrão é 12 meses; sem ninguém olhar, a conta simplesmente para de atualizar | acompanhar o status da conexão — a sincronização avisa em vez de falhar calada |
| **Confiar antes de conferir** | número quase certo é pior que nenhum: você decide errado achando que está informado | os totais têm que bater com o app do banco, mês a mês, antes de o sistema valer para decidir |
| **Categoria criada sozinha pela IA** | 18 categorias viram 60 numa semana e nenhum relatório fecha | o que não casa com regra **fica sem categoria**, à vista, nunca escondido em "Outros" |

---

## Segurança — o capítulo que este tema não pode pular

Este é o único sistema que concentra a sua vida financeira inteira num lugar só. As três garantias que
sustentam isso:

1. **Só leitura.** Não existe caminho de pagamento no projeto. O acesso do Open Finance é de consulta.
2. **A senha do banco nunca passa pelo sistema.** O login acontece na tela do próprio banco.
3. **Revogável a qualquer momento.** Você corta o consentimento no app do banco e o painel apenas para
   de atualizar.

E os cinco erros que estragam tudo:

| O erro | Por que dói |
|---|---|
| Criar tabela em `public` | qualquer chave pública do projeto passa a enxergar a sua fatura |
| Usar a chave de dono do projeto no app | é a chave que ignora toda a segurança: uma linha dessas anula o resto |
| Arquivo de segredo em git, print ou repositório público | segredo em histórico é segredo vazado |
| Ferramenta que pede a senha do seu banco | não é Open Finance, é raspagem |
| "É local, não precisa de login" | o local de hoje é o publicado de amanhã |

**A fronteira:** isto é o **seu** dinheiro, na sua máquina. No dia em que você guardar o dado financeiro
de outra pessoa, o assunto deixa de ser técnico e vira responsabilidade legal — e não é disso que esta
aula trata.

---

## Por onde começar hoje

Crie o projeto no Supabase e conecte **um** banco só no Meu Pluggy. Com uma conta conectada e
o histórico dela carregado, você já faz a primeira pergunta em português — e é essa primeira
resposta que decide se você vai querer o resto.

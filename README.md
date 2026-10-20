# Financeiro com Open Finance (Pluggy)

Os seus bancos e cartões entrando sozinhos num banco de dados seu, por **Open Finance**, e a IA
respondendo em português: *"quanto entrou e quanto saiu esse mês?"*, *"pra onde foi o meu dinheiro
em julho?"*, *"quanto eu paguei de juros no ano?"*.

**Baixe a pasta, abra o Claude Code (ou o Codex) dentro dela e diga: _"me ajuda a configurar"_.**
O agente lê o `CLAUDE.md` e conduz o resto com você.

## O que esta pasta faz

1. **Conecta** cada banco ao Pluggy, com o login feito na tela do próprio banco. A sua senha não
   passa por aqui.
2. **Traz** contas, cartões, faturas e transações para um schema `financeiro` no seu Supabase. A
   gravação é idempotente: rodar duas vezes não duplica nada.
3. **Categoriza** cada gasto por regra. O que não casa com nenhuma regra fica sem categoria e
   aparece na conferência, em vez de sumir em "Outros".
4. **Responde** às suas perguntas com SQL, sem tela nenhuma.

É **só leitura** do lado do banco: nenhuma linha desta pasta move dinheiro.

## O que você precisa ter

| | Para quê | Custo |
|---|---|---|
| Node.js 20+ | rodar os scripts | grátis |
| Claude Code ou Codex | o agente que configura e responde | a assinatura da IA |
| Supabase | onde o dinheiro vira dado | grátis para começar |
| Meu Pluggy + dashboard do Pluggy | o Open Finance | gratuito para uso pessoal |

## Ordem de leitura

1. **[COMECE-AQUI.md](COMECE-AQUI.md)**: a configuração, passo a passo, uma vez só.
2. **[docs/00-a-aula.md](docs/00-a-aula.md)**: o porquê de cada decisão e as travas, que são o
   que dá errado e o conserto de cada uma.
3. `CLAUDE.md` é o manual do agente. Você não precisa ler, mas pode.

## A regra de segurança

O `.env.local` guarda a chave do seu Pluggy e a senha do seu banco de dados. **Ele nunca entra no
git**, e o `.gitignore` já o barra. Se você publicar esta pasta, publique sem ele.

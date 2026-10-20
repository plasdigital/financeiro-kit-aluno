# AGENTS.md — Codex · Antigravity · Cursor

O manual completo está em **[CLAUDE.md](CLAUDE.md)**. Leia-o antes de qualquer ação nesta pasta.

Cinco regras que não se pulam, mesmo sem ler o resto:

1. **É o dinheiro do dono.** Comando que grava (sincronizar, migrar, `sql.mjs --escrever`) só roda
   depois do "pode", mostrando antes o `--dry` ou o `select` equivalente.
2. **Segredo nunca sai do `.env.local`.** Não escreva chave nem senha em documento, em commit ou na
   resposta do chat.
3. **Nada move dinheiro.** Não existe caminho de pagamento e não se cria um.
4. **Nunca peça a senha do banco do dono.** O login do Open Finance é feito na tela do banco.
5. **Nada em `public`, nenhuma migration aplicada editada.** Tudo no schema `financeiro`.

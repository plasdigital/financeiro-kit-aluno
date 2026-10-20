/**
 * Confere a ligação com o Pluggy — só leitura, não grava nada em lugar nenhum.
 *
 *   node scripts/testar-pluggy.mjs
 *
 * Para cada titular do .env.local responde, na ordem em que as coisas costumam quebrar:
 *   1. as credenciais existem?            (PLUGGY_<TITULAR>_CLIENT_ID / _CLIENT_SECRET / _ITEMS)
 *   2. o Pluggy aceita as credenciais?    (POST /auth)
 *   3. cada itemId responde, e com qual status?   (GET /items/:id)
 *   4. quais contas cada banco expõe?     (GET /accounts?itemId=)
 *
 * Não imprime saldo nem transação: a saída deste script costuma ir parar num print ou numa
 * conversa com a IA, e conferir a ligação não precisa de dinheiro nenhum na tela.
 */

import { titulares, credenciais, item, contas } from '../lib/pluggy.mjs';
import { env } from '../lib/env.mjs';

const data = (s) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

let problemas = 0;
const lista = titulares();

if (!lista.length) {
  const rotulos = env('PLUGGY_TITULARES') ?? 'principal';
  console.log('❌ nenhum titular configurado.');
  console.log(`   PLUGGY_TITULARES = "${rotulos}", mas não achei PLUGGY_<TITULAR>_CLIENT_ID para nenhum deles.`);
  console.log('   Copie .env.exemplo para .env.local e preencha (COMECE-AQUI.md, passo 4).');
  process.exit(1);
}

for (const titular of lista) {
  console.log(`\n━━━ titular: ${titular}`);

  let items;
  try {
    ({ items } = credenciais(titular));
  } catch (e) {
    console.log(`  ❌ ${e.message.split('\n')[0]}`);
    problemas++;
    continue;
  }
  if (!items.length) {
    console.log(`  ⚠️  PLUGGY_${titular.toUpperCase()}_ITEMS está vazio — nenhum banco para ler.`);
    console.log('     Dashboard > a sua aplicação > "Ir para Demo" > ⋮ > "Copiar Item ID" (COMECE-AQUI.md, passo 2.5).');
    problemas++;
    continue;
  }

  for (const id of items) {
    let it;
    try {
      it = await item(titular, id);
    } catch (e) {
      const msg = e.message;
      if (/\/auth/.test(msg)) {
        console.log(`  ❌ o Pluggy recusou o Client ID/Secret: ${msg.slice(0, 160)}`);
        console.log('     Confira se copiou da aplicação certa no dashboard, sem espaço sobrando.');
        problemas++;
        break;
      }
      console.log(`  ❌ item ${id.slice(0, 8)}…: ${msg.slice(0, 160)}`);
      console.log('     404 = o itemId não é desta aplicação (ou foi apagado). Copie de novo no "Ir para Demo".');
      problemas++;
      continue;
    }

    const ok = it.status === 'UPDATED' && it.executionStatus === 'SUCCESS';
    console.log(
      `  ${ok ? '✔' : '⚠️ '} ${it.connector?.name ?? 'conector?'} · item ${id.slice(0, 8)}… · ` +
        `${it.status}/${it.executionStatus}`
    );
    console.log(`     última atualização: ${data(it.lastUpdatedAt)} · próxima: ${data(it.nextAutoSyncAt)}`);
    if (it.consentExpiresAt) console.log(`     consentimento vence em: ${data(it.consentExpiresAt)}`);
    if (!ok) {
      console.log('     A sincronização vai PULAR este item até ele voltar a UPDATED/SUCCESS.');
      console.log('     Abra o meu.pluggy.ai e reconecte o banco (consentimento vencido é o caso mais comum).');
      problemas++;
      continue;
    }

    const cs = await contas(titular, id);
    for (const c of cs) {
      const tipo = c.type === 'CREDIT' ? 'cartão' : c.subtype === 'SAVINGS_ACCOUNT' ? 'poupança' : 'conta';
      console.log(`       · ${tipo.padEnd(8)} ${c.name ?? ''}${c.number ? ` (final ${String(c.number).slice(-4)})` : ''}`);
    }
    if (!cs.length) console.log('       · nenhuma conta exposta por este item');
  }
}

console.log(
  problemas
    ? `\n⚠️  ${problemas} problema(s) acima. Conserte e rode de novo antes de sincronizar.`
    : '\n✅ ligação com o Pluggy ok. Próximo passo: node scripts/sincronizar-pluggy.mjs --dry'
);
process.exit(problemas ? 1 : 0);

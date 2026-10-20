/**
 * Configuração TLS das conexões Postgres — uma só, para app e scripts.
 *
 * Mora em módulo próprio (e não no db.mjs) porque importar o db.mjs cria o pool como
 * efeito colateral, e os scripts abrem `Client` avulso em vez de usar o pool.
 *
 * A cadeia do pooler é assinada por CA própria da Supabase, que não está no bundle de
 * raízes do sistema. Sem esse certificado, a única saída seria `rejectUnauthorized: false`
 * — que aceita qualquer certificado e permitiria a alguém no meio do caminho se passar
 * pelo banco. Em localhost isso era indiferente; publicado, não é.
 */

import { SUPABASE_ROOT_CA } from './supabase-ca.mjs';

export const ssl = { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };

# CoreSys — Gate de Release
Data: 2026-09-29

## Status
QA/DESENVOLVIMENTO: APROVADO
PRODUÇÃO MULTI-TENANT: NÃO APROVADO

## Condições de bloqueio
A promoção para produção permanece bloqueada até:
1. Remover/revogar a sobrecarga legada de complete_sale.
2. Remover/revogar versões legadas de RPCs de relatórios que não recebem store_id.
3. Corrigir o erro TypeScript em src/contexts/StoreContext.tsx:372.
4. Criar e executar testes de isolamento multi-tenant/RLS.
5. Revalidar Security Advisor e funções SECURITY DEFINER.
6. Reexecutar typecheck, build e testes após as correções.

## Evidências atuais
- Projeto local: D:\Projetos\vestra
- Supabase: ndrjynlbwrugakjqtzwy
- Branch GitHub: main
- Commit observado: 71be81a50a572bec2c8d5e7c2b01eb4aa626d16c
- Build local: aprovado
- Typecheck local: falhou por propriedade custo inexistente no tipo Product
- npm audit: 3 vulnerabilidades moderadas com correção disponível
- Supabase Security Advisor: 18 SECURITY DEFINER expostas a authenticated, proteção contra senhas vazadas desativada e sale_idempotency sem policies
- Supabase Performance Advisor: alertas principalmente no schema gerenciado stripe e índices ainda não utilizados

## Regra
Nenhuma migration ou mudança destrutiva em produção foi aplicada como parte deste gate.

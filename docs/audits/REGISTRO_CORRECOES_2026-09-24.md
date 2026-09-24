# Registro de correções da auditoria

Data: 24/09/2026

## Escopo executado nesta etapa

- Bloqueio de INSERT direto nas tabelas transacionais de vendas, itens, pagamentos e movimentações.
- Reforço do search_path nas funções auxiliares de autorização.
- Integração da chave de idempotência no serviço de vendas.
- Bloqueio do fallback local silencioso para vendas quando o Supabase está configurado.
- Consulta de produtos usando o estoque por loja (store_inventory).
- Filtro do histórico de vendas pela loja ativa.
- Validação de quantidade e custo na entrada de estoque.
- Migration complementar para validação de descontos, parcelas e venda atômica.
- CI com npm ci determinístico e npm run typecheck.

## Pendências identificadas

- Devoluções e créditos transacionais no backend.
- Agregações de dashboard e relatórios no PostgreSQL.
- Paginação de consultas de listas.
- Remoção adicional de any em todo o frontend.
- Política completa de retenção e anonimização de dados pessoais.
- Testes de RLS, RPC, concorrência e integração com Mercado Pago.
- Revisão completa de todas as policies antigas e duplicadas em um banco de teste.
- Configuração efetiva de deploy da pipeline de produção.

## Observação

As migrations devem ser validadas em um banco Supabase de homologação antes de produção.

## 24/09/2026 — Continuação da implementação

### Correções aplicadas
- Isolamento por `store_id` em transações financeiras e despesas fixas no frontend.
- Filtro de movimentações de vendas pela loja ativa.
- Endurecimento da `complete_sale`: valida loja ativa, descontos, parcelas, itens ativos, estoque por loja e idempotência concorrente.
- Endurecimento do fluxo PIX: idempotência persistente, validação de pagamento e proteção contra cancelamento de venda já concluída.
- Entrada de estoque com validação de loja, permissão, variante, quantidade e custo.
- Falha de operações remotas deixou de cair silenciosamente para o estado local em produtos e entrada de estoque.
- Fluxo `create-mp-pix` passou a aceitar chave de idempotência fornecida pelo cliente/header e usa essa chave também na criação do pagamento no Mercado Pago.

### Validação CI
- Workflow Staging, run #11, executou `npm ci` com sucesso.
- O `typecheck` inicialmente falhou por erro de escopo de tipo em `src/services/inventory.service.ts`; o erro foi corrigido no commit `2c71e643bf785cbf08036aff97a840ba5bce9ed2`.
- A execução do workflow para o commit de correção ainda não foi reportada pelo GitHub no momento deste registro; portanto build/typecheck final não devem ser considerados aprovados.
- O CI também reportou warnings de engine porque o workflow usa Node 20 enquanto a versão instalada de `@supabase/supabase-js` declara Node >=22, além de 3 vulnerabilidades moderadas no `npm audit`.

### Pendências críticas restantes
- Validar migrations e RLS em banco Supabase de homologação.
- Implementar dashboard/relatórios com agregações SQL e filtro por loja.
- Implementar paginação nas listas de grande volume.
- Persistir devoluções/créditos transacionalmente no backend.
- Revisar `stock_quantity` apenas como campo legado e eliminar seu uso operacional restante.
- Implementar testes automatizados reais de RPC, RLS, concorrência e Mercado Pago.
- Validar assinatura obrigatória do webhook e configuração de CORS em produção.
- Revisar retenção/anonimização e demais requisitos técnicos de privacidade.

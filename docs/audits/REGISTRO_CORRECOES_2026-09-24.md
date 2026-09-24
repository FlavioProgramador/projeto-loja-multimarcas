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
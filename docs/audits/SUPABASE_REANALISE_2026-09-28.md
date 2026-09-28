# Reanálise Supabase / PostgreSQL / RLS / Edge Functions — 2026-09-28

## Escopo
Auditoria somente. Nenhuma migration foi aplicada ao banco durante esta revisão e nenhuma Edge Function foi publicada/modificada no projeto Supabase.

## Banco observado
O banco atual possui 18 funções SECURITY DEFINER executáveis por `authenticated`. Todas as funções `public.*` próprias auditadas têm `search_path` fixado; as três exceções do advisor pertencem ao schema gerenciado `stripe`.

### Achados confirmados
1. A sobrecarga antiga `complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)` continua executável por `authenticated`. O corpo não valida loja, usa `unit_price` enviado pelo cliente e não registra `store_id`.
2. A sobrecarga nova `complete_sale(uuid,uuid,text,text,jsonb,text,integer,numeric,numeric,text)` valida loja mas precisa de negações explícitas para papel nulo/inativo e chave de idempotência obrigatória.
3. `create_mp_pix_sale` valida autenticação e loja por helper, mas a condição de papel deve tratar `NULL` explicitamente.
4. `cancel_sale`, `manage_product` e outras RPCs possuem padrões `role NOT IN (...)` que não são fail-closed quando a consulta de papel retorna NULL.
5. `approve_physical_inventory` usa `p_user_id` e precisa manter `p_user_id = auth.uid()`, além de validar loja/papel/estado.
6. `report_stock_status`, `report_top_selling_products`, `report_inventory_movements_summary`, `get_profitability_by_product` e `get_profitability_by_category` não filtram por loja no corpo atual, apesar de serem SECURITY DEFINER. Isso exige correção antes de serem consideradas seguras para um ambiente multi-loja.
7. `get_variant_stock_by_store` já restringe o resultado às lojas com vínculo ativo ou ADMIN.
8. O estoque derivado permanece consistente: 152 unidades em `store_inventory` e 152 em `product_variants.stock_quantity`.
9. `unaccent` está em `extensions`.
10. Advisor de segurança continua apontando proteção contra senhas vazadas desativada.
11. Advisor continua apontando três funções do schema `stripe` com `search_path` mutável. Não foram alteradas.
12. Advisor de performance continua apontando uma FK sem índice no schema gerenciado `stripe` e diversos índices não utilizados. Não foram removidos.

## Edge Functions
Estado do projeto Supabase observado:
- `stripe-setup`: verify_jwt=false
- `stripe-webhook`: verify_jwt=false
- `stripe-worker`: verify_jwt=false
- `create-mp-pix`: verify_jwt=true
- `mp-webhook`: verify_jwt=false

O código das Edge Functions Stripe não está versionado em caminhos acessíveis via Code Search neste repositório; o código implantado foi retornado pelo Supabase apenas para a função `mp-webhook`. Não foi feita publicação nesta revisão.

## Risco de compatibilidade
As correções seguintes precisam ser aplicadas como migrations e revisadas antes de qualquer execução:
- revogar a sobrecarga antiga de `complete_sale` em vez de excluí-la imediatamente;
- atualizar a função moderna para exigir idempotency key e fail-closed;
- endurecer as RPCs de estoque/devolução/inventário;
- filtrar relatórios por loja;
- corrigir a policy de UPDATE de `physical_inventories` preservando `store_id` e `created_by`;
- adicionar testes SQL/RLS em ambiente não produtivo.

## Regra de mudança
Nenhuma dessas correções foi aplicada ao banco durante esta revisão. A branch GitHub existe para preparar os arquivos de migration e testes após aprovação.

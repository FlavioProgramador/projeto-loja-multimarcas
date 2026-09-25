# Auditoria técnica do CoreSys — 25/09/2026

## Escopo

Auditoria do frontend React/TypeScript, serviços de acesso ao Supabase, migrations PostgreSQL e integridade dos dados do projeto `projeto-loja-multimarcas`.

## Alterações implementadas nesta etapa

### 1. Clientes

Arquivo: `src/services/customers.service.ts`

- Adicionado `CustomersService.update(uuid, customer)`.
- Adicionado `CustomersService.remove(uuid)` com exclusão lógica (`is_active = false`).
- Mantida a atualização por UUID, evitando depender do identificador numérico exibido na interface.

Commit: `830023b39abe035fe668cd069bdbe61da109ba1e`

Mensagem: `feat(clientes): adicionar atualização e exclusão lógica persistidas`

### 2. Fornecedores

Arquivo: `src/services/suppliers.service.ts`

- Adicionado `SuppliersService.update(uuid, supplier)`.
- Adicionado `SuppliersService.remove(uuid)` com exclusão lógica (`is_active = false`).
- Mantida a atualização por UUID.

Commit: `e30ff123a24397e2afde9d6ff2ae4aba48a403dc`

Mensagem: `feat(fornecedores): adicionar atualização e exclusão lógica persistidas`

## Verificações realizadas no Supabase

Projeto: `ndrjynlbwrugakjqtzwy`

- As tabelas principais estão com RLS habilitado.
- A estrutura atual possui `stores`, `inventory_movements.store_id` e estruturas de inventário físico.
- A estrutura atual consultada não apresenta `store_id` em `sales` nem em `financial_transactions`, apesar de migrations e funções do fluxo multi-loja referenciarem esses campos.
- A estrutura atual não apresentou, na listagem consultada, as tabelas `store_inventory` e `user_store_access`.
- A consulta de integridade retornou zero registros órfãos para itens de venda, pagamentos, variantes e movimentações.
- A consulta também retornou zero vendas sem itens e zero vendas sem pagamentos.

## Divergências críticas identificadas

### Multi-loja

Existe divergência entre o contrato esperado pelas migrations/RPCs e o schema efetivamente consultado. Antes de aplicar a correção definitiva, é necessário reconciliar:

- `sales.store_id`;
- `financial_transactions.store_id`;
- `store_inventory`;
- `user_store_access`;
- policies RLS e funções auxiliares de autorização.

Essa correção não foi aplicada automaticamente nesta etapa para evitar criar tabelas ou colunas sem validar todas as dependências, constraints, policies e dados existentes.

### Contexto global

`StoreContext.tsx` ainda contém operações de clientes e devoluções que atualizam o estado local. Os métodos de serviço para clientes e fornecedores já foram preparados, mas a integração completa com os handlers do contexto e os componentes de interface ainda precisa ser concluída e validada com TypeScript/build.

### Devoluções

O fluxo de devolução ainda registra dados principalmente no estado local. É necessário criar uma operação transacional no Supabase para:

- validar a venda original;
- impedir devolução superior à quantidade vendida;
- registrar o evento de devolução;
- atualizar estoque;
- registrar movimentação;
- gerar crédito ou lançamento financeiro conforme o tipo de resolução.

## Próximas etapas recomendadas

1. Reconciliar o schema multi-loja com uma migration incremental e idempotente.
2. Atualizar `database.ts` a partir dos tipos gerados pelo Supabase.
3. Integrar `update` e `remove` de clientes/fornecedores no `StoreContext`.
4. Implementar devoluções transacionais no banco.
5. Revisar RLS e privilégios das funções `SECURITY DEFINER` após a reconciliação do schema.
6. Executar lint, typecheck e build.
7. Realizar testes de regressão para venda, estoque, cancelamento, devolução e financeiro.

## Estado desta etapa

- Auditoria parcial executada.
- Dois commits funcionais realizados em português.
- Documento de auditoria criado.
- Correção completa ainda não concluída.
- Não foi aplicado DDL destrutivo.

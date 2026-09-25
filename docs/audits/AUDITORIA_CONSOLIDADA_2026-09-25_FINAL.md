# Auditoria consolidada CoreSys — 2026-09-25

## Escopo concluído

A etapa final concentrou-se na reconciliação do backend Supabase com o aplicativo React/TypeScript, persistência transacional de devoluções, operações de clientes/fornecedores, sincronização dos tipos de banco e revisão das funções críticas.

## Banco de dados

Foi aplicada a migração `reconciliacao_multi_loja_20260925`, reconciliando as entidades de lojas e estoque por loja:

- `user_store_access`
- `store_inventory`
- `sale_idempotency`
- `store_id` em vendas, financeiro e despesas
- políticas RLS orientadas à loja
- índices por loja

A base foi inicializada com uma loja principal e os perfis existentes foram vinculados a ela.

Também foram aplicadas as migrações:
- `persistencia_devolucoes_creditos_20260925`
- `rpcs_multiloja_vendas_estoque_20260925_v2`
- `seguranca_rpcs_e_historico_20260925`

## Devoluções e créditos

A devolução deixou de ser somente local quando o Supabase está configurado.

O fluxo agora utiliza `process_return` em uma transação no banco e valida:

1. autenticação e permissão por loja;
2. existência da venda original;
3. venda concluída;
4. variante pertencente à venda;
5. quantidade devolvida versus quantidade vendida ainda disponível;
6. atualização do estoque da loja;
7. lançamento de movimentação `RETURN`;
8. sincronização do estoque agregado da variante;
9. registro financeiro;
10. crédito/vale persistido em `customer_credit_movements`.

Para estorno em dinheiro, é gerada uma transação financeira de despesa. Para crédito/vale, é registrada a emissão financeira e a movimentação de crédito do cliente.

## Clientes e fornecedores

O `StoreContext` passou a aguardar a confirmação do Supabase para operações persistentes.

Em atualização/exclusão, a UI faz alteração otimista e restaura o snapshot anterior quando a operação remota falha.

Foram expostos no contexto:
- `updateCustomer`
- `deleteCustomer`
- `updateSupplier`
- `deleteSupplier`

O histórico de clientes também passou a considerar movimentações persistidas de crédito.

## Vendas, estoque e cancelamento

As funções críticas usadas pela aplicação foram alinhadas ao modelo multi-loja:

- `complete_sale`
- `register_stock_entry`
- `cancel_sale`

Essas funções agora recebem/validam a loja, operam sobre `store_inventory`, registram movimentações por loja e controlam permissões.

As funções críticas acima tiveram `EXECUTE` revogado para `anon` e concedido apenas a `authenticated`.

## Tipos TypeScript

`src/types/database.ts` foi atualizado com as estruturas do modelo reconciliado, incluindo:
- lojas e acesso por loja;
- estoque por loja;
- idempotência;
- campos `store_id`;
- variantes com estoque mínimo/reserva;
- retornos;
- itens de retorno;
- movimentações de crédito;
- RG do cliente.

A geração de tipos do Supabase foi executada após as migrações para conferir o schema vigente.

## Histórico imutável de estoque

Existem 18 movimentações históricas com `store_id = NULL`.

A atribuição retroativa dessas linhas foi tentada, mas o próprio banco bloqueou a operação por meio do mecanismo de imutabilidade do histórico.

O histórico não foi adulterado nem teve o trigger desativado para forçar a correção.

Essas linhas permanecem como legado sem loja. A RLS permite sua visualização somente por administradores; novas movimentações críticas são gravadas com `store_id`.

## Validação do ambiente

O repositório possui pipelines GitHub Actions com:
- `npm ci`
- `npm run typecheck`
- `npm run build`

A execução local não pôde ser realizada porque o ambiente desta sessão não conseguiu resolver `github.com` para clonar o repositório.

Também não houve execução do pipeline GitHub após os commits desta etapa disponível no conector; portanto, typecheck/build finais não devem ser marcados como aprovados.

## Advisory de segurança

Após as alterações, ainda existem advisories de plataforma para:
- funções `SECURITY DEFINER` executáveis por roles autenticadas/anônimas;
- funções com search_path mutável;
- extensão `unaccent` no schema `public`;
- proteção contra senhas vazadas desabilitada;
- tabela `sale_idempotency` com RLS habilitado sem policy, intencionalmente usada apenas pelas RPCs.

As funções `complete_sale`, `register_stock_entry`, `cancel_sale` e `process_return` receberam restrição explícita de execução e `search_path` fixo.

A proteção de senha vazada é uma configuração do Auth que não foi alterada nesta etapa.

## Commits principais

- `830023b39abe035fe668cd069bdbe61da109ba1e`
- `e30ff123a24397e2afde9d6ff2ae4aba48a403dc`
- `e372a22854bac3aa9bf82325b93354200a05bfd1`
- `b25e088bcf38bcee074c73d6e27c06eaa45d4cbb`
- `36e27af71af64139cfd8b7ebedfa0afaa2e06c52`
- `b40743be76635c5c28bcff08a2ef2cd03d6cd970`
- `c0e9761712ee6bd53ba8424f84fc1c69efc19ec2`
- `b196f82158a1e717fc50fceb0e988de55ef3a16e`
- `6936bd161236698da8a29b285d8f1b5c916a8659`
- `e2228c6869f03d96423b14eb9c552834fd7c1c54`
- `b84849a3d5dbfa3ce5c7258d1c6b4d8c47ea6208`
- `a44f483abcd00988c711acda3a372f1ceec9a00f`

## Status

Implementação de backend e integração solicitada: concluída.

Validação automática final de TypeScript/build: pendente de execução em runner CI ou ambiente local com acesso ao repositório.

Validação funcional com usuário autenticado real (venda, cancelamento, retorno e financeiro): requer execução de cenários no ambiente da aplicação.

# Auditoria e Integridade de Backend (Fase 1)

## 1. Migração para Soft Deletes e Proteção de Histórico

Para garantir a integridade dos dados contábeis e de estoque, foi abolido o uso de *hard deletes* (exclusão física) nas tabelas operacionais.

**Modificações Realizadas:**
* Adicionada a coluna `is_active BOOLEAN DEFAULT true` em `product_variants` e `customers`. As tabelas `products` e `suppliers` já a possuíam.
* As chaves estrangeiras (`FOREIGN KEY`) que utilizavam `ON DELETE CASCADE` para tabelas transacionais (como `inventory_movements`, `sale_items`, `payments`) foram convertidas para `ON DELETE RESTRICT`. 
* Com isso, o banco proíbe nativamente a exclusão de qualquer produto, variante, ou cliente que já possua histórico de compras ou movimentações.

## 2. Refatoração do Serviço de Produtos e SKUs (manage_product RPC)

Anteriormente, o sistema utilizava `Date.now()` no frontend para gerar SKUs e sobrescrevia as variantes via UPSERT direto. Isso causava conflitos e potencial perda de dados. 

**Solução (RPC `manage_product`):**
* Criada a RPC `manage_product`, que recebe a payload do produto e a lista de variações, aplicando transações ACID diretamente no servidor.
* **Smart Update/Insert**: A RPC atualiza os produtos e as variantes individualmente. 
* **Geração de SKU Estável**: Se um SKU não for fornecido manualmente, a RPC gera um SKU formatado e único com base em `PRODUTO-TAMANHO-COR`. Exemplo: `CAME-M-AZU`. Em caso de colisão, um sufixo numérico iterativo é adicionado. O SKU continua sendo perfeitamente editável e pesquisável.
* **Soft Delete de Variantes Ausentes**: Variantes previamente existentes que são removidas no painel de edição deixam de ser deletadas fisicamente, e agora têm a propriedade `is_active` definida como `false`.
* Toda a lógica de inserção múltipla do frontend (`ProductsService`) foi substituída por uma única chamada à RPC.

## 3. Validação em Nível de Banco de Dados

* Confirmado o uso extensivo de restrições `CHECK`, como `CHECK (sale_price >= 0)`, `CHECK (stock_quantity >= 0)`, garantindo impossibilidade matemática de gerar estoque negativo através de queries erráticas no frontend.
* Adicionada restrição faltante `CHECK (cost_price >= 0)` na tabela `products`.

## 4. Normalização de Consultas (Frontend)

* Arquivos em `src/services/` (`products.service.ts`, `customers.service.ts`, `suppliers.service.ts`) refatorados para filtrar inativos utilizando a cláusula `.eq('is_active', true)`.
* Para os produtos, a filtragem de variantes ativas é feita no retorno da payload unificada, evitando poluir as listagens do sistema (PDV) com variantes fora de circulação.

## Resumo das RPCs Críticas (Estado Atual)

* `complete_sale`: Conclui venda e abate o estoque concorrentemente usando *Lock Pessimista* (`FOR UPDATE`).
* `cancel_mp_pix_sale`: Desfaz venda, estorna pagamento e refaz (soma) estoques.
* `register_stock_entry`: Garante injeção limpa de saldo e gera relatório financeiro acoplado de compra (caso haja custo).
* `manage_product`: Consolida a arquitetura UPSERT de entidade com seus relacionamentos garantindo Soft Delete seguro.

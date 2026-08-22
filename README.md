# 🛍️ Vestra - Sistema PDV & ERP para Lojas Multimarcas

Um sistema completo de Ponto de Venda (PDV) e Gestão Empresarial (ERP) moderno, desenvolvido com React, TypeScript, Vite e Supabase. O projeto foi projetado para ser rápido, bonito e fácil de usar, com foco na experiência do lojista e do cliente.

## 🚀 Funcionalidades

- **Ponto de Venda (PDV) Moderno**:
  - Interface ágil para fechamento de vendas.
  - Formas de pagamento integradas (Cartão de Crédito, Cartão de Débito, Dinheiro).
  - Integração de pagamento via PIX (Mercado Pago).
  - Impressão automática de recibo/cupom não fiscal com opções de compartilhamento (WhatsApp/PDF).
  - Controle e baixa instantânea de estoque.

- **Gestão de Estoque (Inventário)**:
  - Cadastro de produtos com variações (Tamanho, Cor).
  - Registro de movimentos de entrada e saída.
  - Alertas visuais de estoque baixo.

- **Gestão de Clientes e Fornecedores**:
  - CRM embutido para cadastro e histórico de clientes.
  - Cadastro de fornecedores e controle de informações.

- **Gestão Financeira**:
  - Fluxo de caixa diário/mensal (Entradas e Saídas).
  - Gráficos de receita e faturamento.
  - Relatórios de vendas e produtos mais vendidos (Top Products).

- **Gestão de Acesso (Auth)**:
  - Sistema de Login seguro via Supabase Auth.
  - Gestão de diferentes papéis e permissões (Caixa, Gerente).

## 💻 Tecnologias Utilizadas

**Frontend:**
- [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- UI construída com componentes customizados em CSS puro moderno, com animações suaves e design "premium"
- [Lucide Icons](https://lucide.dev/) (Ícones)
- [Recharts](https://recharts.org/) (Gráficos)
- [date-fns](https://date-fns.org/) (Manipulação de Datas)

**Backend / Infraestrutura:**
- [Supabase](https://supabase.com/) (PostgreSQL, Auth, Edge Functions)
- RPCs (Remote Procedure Calls) no PostgreSQL para transações críticas atômicas (como vendas no PDV)
- [Mercado Pago](https://www.mercadopago.com.br/) (Integração para pagamentos via PIX)

## 🛠️ Como executar localmente

1. **Clone o repositório:**
```bash
git clone https://github.com/FlavioProgramador/projeto-loja-multimarcas.git
cd projeto-loja-multimarcas
```

2. **Instale as dependências:**
```bash
npm install
```

3. **Configure as Variáveis de Ambiente:**
Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:
```env
VITE_SUPABASE_URL=sua_url_do_supabase
VITE_SUPABASE_ANON_KEY=sua_anon_key_do_supabase
VITE_MERCADO_PAGO_PUBLIC_KEY=sua_chave_publica_mp
```

4. **Inicie o servidor de desenvolvimento:**
```bash
npm run dev
```

5. **Acesse no navegador:**
`http://localhost:5173`

## 📦 Banco de Dados (Supabase)

Para garantir o funcionamento pleno das vendas, certifique-se de executar o arquivo SQL inicial fornecido na pasta `supabase/` no painel de **SQL Editor** do seu projeto no Supabase.

Ele cria todas as tabelas (clientes, vendas, estoque) e a principal procedure (`complete_sale`) de processamento atômico de PDV.

## 📝 Licença

Desenvolvido para lojas de moda e multimarcas. Reservados todos os direitos ou conforme acordo com o cliente.

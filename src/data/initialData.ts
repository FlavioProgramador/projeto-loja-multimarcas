import { Product, FinancialTransaction, Customer, Supplier, FixedExpense, SaleMovement } from '../types';

export const INITIAL_PRODUCTS: Product[] = [
  { id: "42d17f53-08d2-4923-9991-03143453263a", nome: "Camisa Cyclone", marca: "Cyclone", categoria: "Camisas", preco: 89.90, skus: [{ id: "e1d9c5a1-3f25-4a2e-9cf8-0fd899dcc882", tamanho: "P", cor: "Preto", qtd: 12 }, { id: "f3522230-a973-45a4-9278-a37c17e12efb", tamanho: "M", cor: "Preto", qtd: 8 }, { id: "055c9c80-6b42-414a-a566-abb7985e7561", tamanho: "G", cor: "Preto", qtd: 3 }] },
  { id: "65af3a90-f152-49a1-b495-68072d533526", nome: "Jaqueta Oakley", marca: "Oakley", categoria: "Jaquetas", preco: 229.90, skus: [{ id: "a7760c08-b2f8-492c-a0f1-50227410f4af", tamanho: "M", cor: "Azul", qtd: 5 }, { id: "5c59b2a1-f070-4862-8ec0-f37d2840b686", tamanho: "G", cor: "Azul", qtd: 2 }] },
  { id: "68f84a76-eb78-498d-b975-ccc95ad1754c", nome: "Tênis Kenner", marca: "Kenner", categoria: "Calçados", preco: 159.90, skus: [{ id: "43a51ca0-4456-4c7a-b000-78890daa7724", tamanho: "P", cor: "Branco", qtd: 0 }, { id: "81a00ca8-f46d-4f40-8107-05723b99a220", tamanho: "M", cor: "Branco", qtd: 4 }, { id: "4326b415-4474-48db-bda7-58e995709574", tamanho: "G", cor: "Branco", qtd: 6 }] },
  { id: "2d35c31b-499f-49ca-90bd-4226e42c419e", nome: "Boné High", marca: "High", categoria: "Acessórios", preco: 49.90, skus: [{ id: "39efa235-8510-4a92-b1b8-cd15ee80d2e8", tamanho: "Único", cor: "Preto", qtd: 15 }] },
  { id: "3f8b26a5-2366-41fc-9f44-1d0ea6313beb", nome: "Regata Nike", marca: "Nike", categoria: "Camisas", preco: 69.90, skus: [{ id: "ec2fcfac-5920-431f-a3f0-8beb4993bfb6", tamanho: "P", cor: "Vermelho", qtd: 7 }, { id: "6b7804d2-a31d-44e6-b52d-e80fc80b2732", tamanho: "M", cor: "Vermelho", qtd: 3 }] },
  { id: "6025f96e-f387-46ee-ba76-d56d1fde6ea9", nome: "Moletom Cyclone", marca: "Cyclone", categoria: "Moletons", preco: 149.90, skus: [{ id: "95b8cbc8-f937-4155-8ef0-0ce34b1c093a", tamanho: "M", cor: "Cinza", qtd: 10 }, { id: "2c52c87b-20e5-4e66-93fd-f915c36311ff", tamanho: "G", cor: "Cinza", qtd: 4 }] },
  { id: "ab02c81b-f59e-469c-99b1-6c492fd325b4", nome: "Short Oakley", marca: "Oakley", categoria: "Calças", preco: 99.90, skus: [{ id: "47ad1a32-20fd-4ff5-90ca-027e65abf065", tamanho: "P", cor: "Preto", qtd: 2 }, { id: "c7f50312-aa5a-4b96-a0cb-2f68cbc98b71", tamanho: "M", cor: "Preto", qtd: 0 }] },
  { id: "7db5e33d-04f8-4031-b92b-8ea2ec574b6d", nome: "Camisa Kenner", marca: "Kenner", categoria: "Camisas", preco: 79.90, skus: [{ id: "11b84a44-83b7-4611-a836-0360cec16777", tamanho: "G", cor: "Branco", qtd: 1 }, { id: "670b4814-569e-47ef-a1c3-eec54e3f1175", tamanho: "M", cor: "Branco", qtd: 9 }] },
  { id: "180f0f93-22d8-4807-a1bc-5fc48625dd66", nome: "Tênis High", marca: "High", categoria: "Calçados", preco: 129.90, skus: [{ id: "ad4bf589-77b1-47df-a902-108effeb28e8", tamanho: "P", cor: "Preto", qtd: 0 }, { id: "79e8fcbd-d723-4722-9c21-ca94860ea0e0", tamanho: "M", cor: "Preto", qtd: 0 }] },
  { id: "0e834598-1863-4a95-8169-3cb9c76a40df", nome: "Camiseta Nike", marca: "Nike", categoria: "Camisas", preco: 59.90, skus: [{ id: "675f5bb1-2b87-450b-9578-826037f8a642", tamanho: "G", cor: "Azul", qtd: 6 }] },
  { id: "552ff793-246c-45ca-aace-61eb50cfcdd6", nome: "Jaqueta High", marca: "High", categoria: "Jaquetas", preco: 189.90, skus: [{ id: "3e315744-0405-4209-91a1-3a98f85f35ee", tamanho: "M", cor: "Verde", qtd: 3 }] },
  { id: "a4798438-e64f-4448-9549-4fdaee808191", nome: "Bermuda Cyclone", marca: "Cyclone", categoria: "Calças", preco: 79.90, skus: [{ id: "88c1621b-f034-4742-b0df-03085d4ce998", tamanho: "P", cor: "Preto", qtd: 0 }, { id: "79cf8adb-8afa-440c-b3b3-3e4589c1d40a", tamanho: "M", cor: "Preto", qtd: 4 }] },
  { id: "27c93f0d-1c47-4f86-9a1d-b6016830a26b", nome: "Mochila Oakley", marca: "Oakley", categoria: "Acessórios", preco: 139.90, skus: [{ id: "92ad6322-e8f4-45bc-8b0f-14115a27d31d", tamanho: "Único", cor: "Preto", qtd: 9 }] },
  { id: "c1ce85bb-2858-4bc7-961a-c4174ac1e086", nome: "Regata Kenner", marca: "Kenner", categoria: "Camisas", preco: 49.90, skus: [{ id: "cd473838-b88f-4ac0-b817-938c96f51051", tamanho: "P", cor: "Branco", qtd: 2 }, { id: "a93654ce-41ba-4223-b14b-b1373c91db60", tamanho: "G", cor: "Branco", qtd: 0 }] },
  { id: "d7377ed5-b365-4775-8708-72d6d957674b", nome: "Camisa Nike", marca: "Nike", categoria: "Camisas", preco: 89.90, skus: [{ id: "0306c697-2a22-483b-af25-b95d221ccd01", tamanho: "M", cor: "Preto", qtd: 5 }, { id: "4f7ce280-efc7-4272-bd23-72c892c83a04", tamanho: "G", cor: "Preto", qtd: 2 }] }
];

export const INITIAL_TRANSACTIONS: FinancialTransaction[] = [
  { id: "aedddb7a-e806-4f25-85ff-379416bd5b32", tipo: "entrada", descricao: "Venda PDV #1001", valor: 189.90, data: "2026-07-14" },
  { id: "3abcfa1a-d470-4b4f-9abf-84ae948f6e88", tipo: "entrada", descricao: "Venda PDV #1002", valor: 279.80, data: "2026-07-15" },
  { id: "0a16e6c8-ecd0-46f6-b7bc-eef096605f69", tipo: "saida", descricao: "Pagamento de Luz", valor: 120.00, data: "2026-07-16" },
  { id: "5c5e2d00-5461-4bba-9761-343bc60bc924", tipo: "entrada", descricao: "Venda PDV #1003", valor: 459.70, data: "2026-08-17" }
];

export const INITIAL_MOVEMENTS: SaleMovement[] = [];

export const INITIAL_CUSTOMERS: Customer[] = [
  { id: "faf54d4a-5a07-474d-a35c-b1057bd69248", nome: "João Silva", cpf: "123.456.789-00", telefone: "(11) 99999-9999", email: "joao@email.com", endereco: "Rua das Flores, 123", historico: [] },
  { id: "1548fc50-1a3b-4e41-b32b-390c5c59b601", nome: "Maria Santos", cpf: "987.654.321-00", telefone: "(11) 88888-8888", email: "maria@email.com", endereco: "Av. Principal, 456", historico: [] }
];

export const INITIAL_SUPPLIERS: Supplier[] = [
  { id: "0ad0fdb3-49cd-4dd2-a721-68014f2d4dae", nome: "Distribuidora XYZ", cnpj: "12.345.678/0001-99", contato: "(11) 3333-4444", email: "contato@xyz.com", endereco: "Rua Comercial, 789", produtos: [] }
];

export const INITIAL_FIXED_EXPENSES: FixedExpense[] = [
  { id: "986a0b44-6034-4b9f-a9e5-9c433429d211", descricao: "Aluguel", valor: 1500.00, dataVencimento: "2026-08-25", categoria: "Aluguel", pago: false },
  { id: "9897ba7b-d050-449e-9174-06baeac8aaae", descricao: "Salários", valor: 5000.00, dataVencimento: "2026-08-30", categoria: "Pessoal", pago: false }
];


export const INITIAL_NOTIFICATIONS: string[] = [
  'Tênis Kenner (Branco/M) está sem estoque.',
  'Conta de luz vence amanhã (R$ 120,00).',
  'Aluguel vence em 5 dias.'
];

import React from 'react';
import { CircleDollarSign, CreditCard, UsersRound, ShoppingBag } from 'lucide-react';
import { formatMoeda } from '../../lib/utils';

interface CustomerStatsProps {
  totalCustomers: number;
  activeCustomers: number;
  customersWithCredit: number;
  totalPurchases: number;
  totalRevenue: number;
  creditBalance: number;
}

export const CustomerStats: React.FC<CustomerStatsProps> = ({
  totalCustomers, activeCustomers, customersWithCredit, totalPurchases, totalRevenue, creditBalance,
}) => (
  <section className="customer-stat-grid" aria-label="Resumo de clientes">
    <article className="customer-stat-card"><span className="customer-stat-icon"><UsersRound size={18} /></span><div><small>Clientes ativos</small><strong>{activeCustomers}</strong><span>{totalCustomers} cadastrados</span></div></article>
    <article className="customer-stat-card"><span className="customer-stat-icon"><ShoppingBag size={18} /></span><div><small>Compras registradas</small><strong>{totalPurchases}</strong><span>no histórico atual</span></div></article>
    <article className="customer-stat-card"><span className="customer-stat-icon"><CircleDollarSign size={18} /></span><div><small>Receita atribuída</small><strong>{formatMoeda(totalRevenue)}</strong><span>somatório das vendas</span></div></article>
    <article className="customer-stat-card"><span className="customer-stat-icon"><CreditCard size={18} /></span><div><small>Crédito em carteira</small><strong>{formatMoeda(creditBalance)}</strong><span>{customersWithCredit} clientes com saldo</span></div></article>
  </section>
);
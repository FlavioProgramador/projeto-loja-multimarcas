import React, { useState } from 'react';
import {
  RotateCcw,
  Search,
  Plus,
  Printer,
  FileSpreadsheet,
  Coins,
  Receipt,
  Tag,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { formatMoeda, hoje, downloadCSV } from '../../lib/utils';
import { StatCard } from '../ui/StatCard';
import { StatusBadge } from '../ui/StatusBadge';
import { NewReturnModal } from './NewReturnModal';
import { ReturnReceipt } from './ReturnReceipt';
import { ReturnRecord } from '../../types';

export const ReturnsView: React.FC = () => {
  const { returns, customers } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedForPrint, setSelectedForPrint] = useState<ReturnRecord | null>(null);

  // Stats
  const totalDevolucoesQtd = returns.reduce(
    (acc, r) => acc + r.itens.reduce((sum, item) => sum + item.qtd, 0),
    0
  );
  const totalCreditosEmitidos = returns.reduce((acc, r) => acc + r.valorTotal, 0);
  const saldoTotalClientes = customers.reduce((acc, c) => acc + (c.saldoCredito || 0), 0);

  // Filtered returns
  const filteredReturns = returns.filter(r => {
    const matchesSearch =
      r.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.clienteNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.clienteCpf.includes(searchTerm) ||
      (r.vendaOriginalId && r.vendaOriginalId.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType =
      filterType === 'all' || r.tipoResolucao === filterType;

    return matchesSearch && matchesType;
  });

  const handlePrint = (record: ReturnRecord) => {
    setSelectedForPrint(record);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const handleExportCSV = () => {
    let csv = 'Codigo,Data,Cliente,CPF,VendaOrigem,ValorTotal,Destino,Status,Itens\n';
    returns.forEach(r => {
      const itensStr = r.itens.map(i => `${i.nome} (${i.tamanho}/${i.cor}) x${i.qtd} - ${i.motivo}`).join('; ');
      csv += `"${r.codigo}","${r.data}","${r.clienteNome}","${r.clienteCpf}","${r.vendaOriginalId || 'Avulsa'}","${r.valorTotal.toFixed(2).replace('.', ',')}","${r.tipoResolucao}","${r.status}","${itensStr.replace(/"/g, '""')}"\n`;
    });
    downloadCSV(`relatorio_trocas_devolucoes_${hoje()}.csv`, csv);
  };

  return (
    <>
      <div className="module-fade">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Trocas & Devoluções</h1>
            <p className="page-subtitle">
              Controle de mercadorias devolvidas, reentrada em estoque e saldo de crédito / vales para clientes.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={handleExportCSV}>
              <FileSpreadsheet size={16} /> Exportar CSV
            </button>
            <button className="btn" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} /> Nova Troca / Devolução
            </button>
          </div>
        </div>

        {/* 3 KPI Metric Cards */}
        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <StatCard
            label="Total de Peças Trocadas"
            value={`${totalDevolucoesQtd} un`}
            icon={<RotateCcw size={18} />}
            iconBg="var(--badge-blue-bg)"
            iconColor="var(--primary)"
            delta={`${returns.length} ocorrências`}
            deltaType="neutral"
            deltaLabel="reentradas no estoque"
          />

          <StatCard
            label="Créditos / Vales Emitidos"
            value={formatMoeda(totalCreditosEmitidos)}
            icon={<Tag size={18} />}
            iconBg="var(--badge-green-bg)"
            iconColor="var(--badge-green)"
            delta="Vales e créditos"
            deltaType="positive"
            deltaLabel="gerados em trocas"
          />

          <StatCard
            label="Saldo em Aberto (Clientes)"
            value={formatMoeda(saldoTotalClientes)}
            icon={<Coins size={18} />}
            iconBg="var(--badge-yellow-bg)"
            iconColor="var(--badge-yellow)"
            delta={`${customers.filter(c => (c.saldoCredito || 0) > 0).length} clientes`}
            deltaType="neutral"
            deltaLabel="com crédito disponível"
          />
        </div>

        {/* Main Table Container */}
        <div className="table-wrap">
          <div className="table-header-bar" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50)',
                  color: 'var(--text-muted)'
                }}
              />
              <input
                placeholder="Buscar por código, cliente, CPF ou venda..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '36px', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                style={{ fontSize: '12px', padding: '6px 10px' }}
              >
                <option value="all">Todas as Resoluções</option>
                <option value="credito_cliente">Saldo em Conta</option>
                <option value="vale_troca">Cupom Vale-Troca</option>
                <option value="estorno_dinheiro">Estorno em Dinheiro</option>
              </select>

              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                {filteredReturns.length} registros
              </span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Código / Data</th>
                <th>Cliente</th>
                <th>Origem</th>
                <th>Peças Devolvidas</th>
                <th>Valor do Crédito</th>
                <th>Resolução</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '36px' }}>
                    Nenhuma troca ou devolução registrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredReturns.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                        {r.codigo}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.data}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.clienteNome}</div>
                      {r.clienteCpf && r.clienteCpf !== 'Não informado' && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {r.clienteCpf}
                        </div>
                      )}
                    </td>
                    <td>
                      {r.vendaOriginalId ? (
                        <span className="badge-status neutral">{r.vendaOriginalId}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Avulsa</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                        {r.itens.map((it, idx) => (
                          <div key={idx} style={{ marginBottom: '2px' }}>
                            <strong>{it.nome}</strong> ({it.tamanho}/{it.cor}) x{it.qtd}
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                              • {it.motivo}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <strong
                        style={{
                          color: 'var(--badge-green)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '13.5px'
                        }}
                      >
                        {formatMoeda(r.valorTotal)}
                      </strong>
                    </td>
                    <td>
                      {r.tipoResolucao === 'credito_cliente' && (
                        <span className="badge-status success" title="Crédito disponível no cadastro do cliente">
                          🏷️ Saldo em Conta
                        </span>
                      )}
                      {r.tipoResolucao === 'vale_troca' && (
                        <span className="badge-status neutral" title="Cupom impresso">
                          🎫 Vale-Troca
                        </span>
                      )}
                      {r.tipoResolucao === 'estorno_dinheiro' && (
                        <span className="badge-status warning" title="Devolvido em dinheiro">
                          💵 Estorno
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handlePrint(r)}
                        title="Imprimir Comprovante / Vale-Troca"
                        style={{ padding: '5px 8px' }}
                      >
                        <Printer size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <NewReturnModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </div>

      {/* Hidden printer receipt */}
      {selectedForPrint && <ReturnReceipt returnRecord={selectedForPrint} />}
    </>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  FileSpreadsheet,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Tag,
} from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { ReturnsService, type ReturnsSummary } from '../../services/returns.service';
import { formatMoeda, hoje, downloadCSV, formatCpf } from '../../lib/utils';
import { StatCard } from '../ui/StatCard';
import { NewReturnModal } from './NewReturnModal';
import { ReturnReceipt } from './ReturnReceipt';
import { ReturnRecord } from '../../types';

const PAGE_SIZE=15;
const EMPTY_SUMMARY:ReturnsSummary={
  occurrences:0,
  totalPieces:0,
  totalCredits:0,
  customerCreditBalance:0,
  customersWithCredit:0,
};

export const ReturnsView: React.FC = () => {
  const { activeStoreId } = useStore();
  const [returns,setReturns]=useState<ReturnRecord[]>([]);
  const [summary,setSummary]=useState<ReturnsSummary>(EMPTY_SUMMARY);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all'|'credito_cliente'|'vale_troca'|'estorno_dinheiro'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedForPrint, setSelectedForPrint] = useState<ReturnRecord | null>(null);

  const load=useCallback(async()=>{
    if(!activeStoreId){
      setReturns([]);
      setSummary(EMPTY_SUMMARY);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try{
      const result=await ReturnsService.getPage({
        storeId:activeStoreId,
        page,
        pageSize:PAGE_SIZE,
        search:searchTerm,
        resolutionType:filterType,
      });
      setReturns(result.rows);
      setSummary(result.summary);
      setTotal(result.total);
      const lastPage=Math.max(1,Math.ceil(result.total/PAGE_SIZE));
      if(page>lastPage)setPage(lastPage);
    }catch(error){
      console.error('Erro ao carregar devoluções:',error);
      setReturns([]);
      setTotal(0);
    }finally{
      setLoading(false);
    }
  },[activeStoreId,page,searchTerm,filterType]);

  useEffect(()=>setPage(1),[activeStoreId,searchTerm,filterType]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load();},searchTerm.trim()?250:0);
    return ()=>window.clearTimeout(timer);
  },[load,searchTerm]);

  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));

  const handlePrint = (record: ReturnRecord) => {
    setSelectedForPrint(record);
    window.setTimeout(() => window.print(), 200);
  };

  const handleExportCSV = async () => {
    if(!activeStoreId)return;
    try{
      const allReturns=await ReturnsService.getAll(activeStoreId);
      let csv = 'Codigo,Data,Cliente,CPF,VendaOrigem,ValorTotal,Destino,Status,Itens\n';
      allReturns.forEach(record => {
        const itensStr = record.itens
          .map(item => `${item.nome} (${item.tamanho}/${item.cor}) x${item.qtd} - ${item.motivo}`)
          .join('; ');
        csv += `"${record.codigo}","${record.data}","${record.clienteNome}","${formatCpf(record.clienteCpf)}","${record.vendaOriginalId || 'Avulsa'}","${record.valorTotal.toFixed(2).replace('.', ',')}","${record.tipoResolucao}","${record.status}","${itensStr.replace(/"/g, '""')}"\n`;
      });
      downloadCSV(`relatorio_trocas_devolucoes_${hoje()}.csv`, csv);
    }catch(error){
      console.error('Erro ao exportar devoluções:',error);
    }
  };

  return (
    <>
      <div className="module-fade">
        <div className="page-header">
          <div>
            <h1 className="page-title">Trocas & Devoluções</h1>
            <p className="page-subtitle">
              Controle de mercadorias devolvidas, reentrada em estoque e saldo de crédito / vales para clientes.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={()=>void handleExportCSV()}>
              <FileSpreadsheet size={16} /> Exportar CSV
            </button>
            <button className="btn" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} /> Nova Troca / Devolução
            </button>
          </div>
        </div>

        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <StatCard
            label="Total de Peças Trocadas"
            value={`${summary.totalPieces} un`}
            icon={<RotateCcw size={18} />}
            iconBg="var(--badge-blue-bg)"
            iconColor="var(--primary)"
            delta={`${summary.occurrences} ocorrências`}
            deltaType="neutral"
            deltaLabel="reentradas no estoque"
          />

          <StatCard
            label="Créditos / Vales Emitidos"
            value={formatMoeda(summary.totalCredits)}
            icon={<Tag size={18} />}
            iconBg="var(--badge-green-bg)"
            iconColor="var(--badge-green)"
            delta="Vales e créditos"
            deltaType="positive"
            deltaLabel="gerados em trocas"
          />

          <StatCard
            label="Saldo em Aberto (Clientes)"
            value={formatMoeda(summary.customerCreditBalance)}
            icon={<Coins size={18} />}
            iconBg="var(--badge-yellow-bg)"
            iconColor="var(--badge-yellow)"
            delta={`${summary.customersWithCredit} clientes`}
            deltaType="neutral"
            deltaLabel="com crédito disponível"
          />
        </div>

        <div className="table-wrap">
          <div className="table-header-bar" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)'
                }}
              />
              <input
                placeholder="Buscar por código, cliente, CPF ou venda..."
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                style={{ paddingLeft: '36px', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                value={filterType}
                onChange={event => setFilterType(event.target.value as typeof filterType)}
                style={{ fontSize: '12px', padding: '6px 10px' }}
              >
                <option value="all">Todas as Resoluções</option>
                <option value="credito_cliente">Saldo em Conta</option>
                <option value="vale_troca">Cupom Vale-Troca</option>
                <option value="estorno_dinheiro">Estorno em Dinheiro</option>
              </select>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                {loading?'Carregando...':`${total} registros`}
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
              {!loading&&returns.length===0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '36px' }}>
                    Nenhuma troca ou devolução registrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                returns.map(record => (
                  <tr key={record.uuid || record.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                        {record.codigo}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{record.data}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.clienteNome}</div>
                      {record.clienteCpf && record.clienteCpf !== 'Não informado' && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {formatCpf(record.clienteCpf)}
                        </div>
                      )}
                    </td>
                    <td>
                      {record.vendaOriginalId ? (
                        <span className="badge-status neutral">{record.vendaOriginalId}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Avulsa</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                        {record.itens.map((item, index) => (
                          <div key={index} style={{ marginBottom: '2px' }}>
                            <strong>{item.nome}</strong> ({item.tamanho}/{item.cor}) x{item.qtd}
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                              • {item.motivo}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <strong style={{ color: 'var(--badge-green)', fontFamily: 'var(--font-mono)', fontSize: '13.5px' }}>
                        {formatMoeda(record.valorTotal)}
                      </strong>
                    </td>
                    <td>
                      {record.tipoResolucao === 'credito_cliente' && (
                        <span className="badge-status success">🏷️ Saldo em Conta</span>
                      )}
                      {record.tipoResolucao === 'vale_troca' && (
                        <span className="badge-status neutral">🎫 Vale-Troca</span>
                      )}
                      {record.tipoResolucao === 'estorno_dinheiro' && (
                        <span className="badge-status warning">💵 Estorno</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handlePrint(record)}
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

          {total>0&&<div className="finance-pagination">
            <span>Exibindo {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,total)} de {total}</span>
            <div>
              <button disabled={page===1||loading} onClick={()=>setPage(value=>Math.max(1,value-1))}><ChevronLeft size={16}/></button>
              <strong>{page}/{pages}</strong>
              <button disabled={page===pages||loading} onClick={()=>setPage(value=>Math.min(pages,value+1))}><ChevronRight size={16}/></button>
            </div>
          </div>}
        </div>

        <NewReturnModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => { if (page === 1) void load(); else setPage(1); }}
        />
      </div>

      {selectedForPrint && <ReturnReceipt returnRecord={selectedForPrint} />}
    </>
  );
};

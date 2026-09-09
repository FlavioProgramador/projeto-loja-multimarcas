import React, { useState } from 'react';
import {
  RotateCcw,
  Search,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  ShoppingBag,
  User,
  CreditCard,
  Printer
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';
import { ReturnItem, ReturnReason, ReturnRecord } from '../../types';
import { formatMoeda } from '../../lib/utils';
import { ReturnReceipt } from './ReturnReceipt';

interface NewReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (returnRecord: ReturnRecord) => void;
}

const RETURN_REASONS: ReturnReason[] = [
  'Tamanho Incorreto',
  'Defeito de Fabricação',
  'Insatisfação com o Modelo',
  'Troca de Cor',
  'Presente / Outro'
];

export const NewReturnModal: React.FC<NewReturnModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { products, movements, customers, processReturn } = useStore();

  const [mode, setMode] = useState<'sale' | 'custom'>('sale');
  const [selectedSaleId, setSelectedSaleId] = useState<string>('');
  const [saleSearch, setSaleSearch] = useState<string>('');

  const [customerName, setCustomerName] = useState('');
  const [customerCpf, setCustomerCpf] = useState('');
  const [resolutionType, setResolutionType] = useState<
    'credito_cliente' | 'vale_troca' | 'estorno_dinheiro'
  >('credito_cliente');
  const [observacoes, setObservacoes] = useState('');

  // Items to return
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);

  // For custom item addition
  const [selectedProductIdx, setSelectedProductIdx] = useState<number>(0);
  const [selectedSkuIdx, setSelectedSkuIdx] = useState<number>(0);
  const [customQty, setCustomQty] = useState<number>(1);
  const [customReason, setCustomReason] = useState<ReturnReason>('Tamanho Incorreto');

  // Success print state
  const [completedReturn, setCompletedReturn] = useState<ReturnRecord | null>(null);

  // Filter sales
  const filteredSales = movements.filter(
    m =>
      m.vendaId.toLowerCase().includes(saleSearch.toLowerCase()) ||
      m.comprador.toLowerCase().includes(saleSearch.toLowerCase()) ||
      m.cpf.includes(saleSearch)
  );

  const handleSelectSale = (saleId: string) => {
    setSelectedSaleId(saleId);
    const sale = movements.find(m => m.vendaId === saleId);
    if (!sale) return;

    setCustomerName(sale.comprador !== 'Cliente não identificado' ? sale.comprador : '');
    setCustomerCpf(sale.cpf !== 'Não informado' ? sale.cpf : '');

    // Parse items from the sale string (e.g. "Camisa Cyclone (M/Preto) x1, Jaqueta Oakley (G/Azul) x2")
    const parsedItems: ReturnItem[] = [];
    const itemEntries = sale.produtos.split(',');

    itemEntries.forEach(entry => {
      const trimmed = entry.trim();
      if (!trimmed) return;

      const qtyMatch = trimmed.match(/x(\d+)$/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const withoutQty = trimmed.replace(/\s*x\d+$/, '');

      const varMatch = withoutQty.match(/\((.*?)\/(.*?)\)/);
      const nome = withoutQty.replace(/\s*\(.*?\)/, '').trim();
      const tamanho = varMatch ? varMatch[1].trim() : 'Único';
      const cor = varMatch ? varMatch[2].trim() : 'Padrão';

      const prod = products.find(p => p.nome.toLowerCase() === nome.toLowerCase());
      const preco = prod ? prod.preco : 0;

      parsedItems.push({
        produtoId: prod ? prod.id : 0,
        productUuid: prod?.uuid,
        nome: prod ? prod.nome : nome,
        tamanho,
        cor,
        precoUnitario: preco,
        qtd: qty,
        motivo: 'Tamanho Incorreto'
      });
    });

    setReturnItems(parsedItems);
  };

  const handleAddCustomItem = () => {
    const prod = products[selectedProductIdx];
    if (!prod) return;

    const sku = prod.skus[selectedSkuIdx] || prod.skus[0] || { tamanho: 'Único', cor: 'Padrão' };

    setReturnItems(prev => [
      ...prev,
      {
        produtoId: prod.id,
        productUuid: prod.uuid,
        nome: prod.nome,
        tamanho: sku.tamanho,
        cor: sku.cor,
        precoUnitario: prod.preco,
        qtd: customQty,
        motivo: customReason
      }
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setReturnItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateItem = (index: number, field: keyof ReturnItem, value: any) => {
    setReturnItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const totalReturnVal = returnItems.reduce(
    (sum, item) => sum + item.precoUnitario * item.qtd,
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (returnItems.length === 0) {
      alert('Selecione ao menos 1 item para devolução.');
      return;
    }

    if (!customerName.trim()) {
      alert('Informe o nome do cliente para vincular a troca/crédito.');
      return;
    }

    const result = await processReturn({
      clienteNome: customerName.trim(),
      clienteCpf: customerCpf.trim() || 'Não informado',
      vendaOriginalId: mode === 'sale' ? selectedSaleId : undefined,
      itens: returnItems,
      tipoResolucao: resolutionType,
      observacoes: observacoes.trim() || undefined
    });

    if (result.success) {
      setCompletedReturn(result.returnRecord);
      if (onSuccess) onSuccess(result.returnRecord);
    } else {
      alert(result.message);
    }
  };

  const handleResetAndClose = () => {
    setCompletedReturn(null);
    setSelectedSaleId('');
    setReturnItems([]);
    setCustomerName('');
    setCustomerCpf('');
    setObservacoes('');
    onClose();
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleResetAndClose}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RotateCcw size={18} style={{ color: 'var(--primary)' }} />
            <span>Registrar Troca ou Devolução</span>
          </div>
        }
        maxWidth="680px"
      >
        {completedReturn ? (
          <div style={{ textAlign: 'center', padding: '16px 8px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--radius-full)',
                background: 'var(--badge-green-bg)',
                color: 'var(--badge-green)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}
            >
              <Check size={28} />
            </div>

            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Troca/Devolução Registrada com Sucesso!
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Código do Vale: <strong style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{completedReturn.codigo}</strong>
            </p>

            <div
              style={{
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                textAlign: 'left',
                marginBottom: '20px',
                fontSize: '13px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Cliente:</span>
                <strong>{completedReturn.clienteNome}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Valor Total do Crédito:</span>
                <strong style={{ color: 'var(--badge-green)', fontSize: '15px', fontFamily: 'var(--font-mono)' }}>
                  {formatMoeda(completedReturn.valorTotal)}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Destino do Crédito:</span>
                <span>
                  {completedReturn.tipoResolucao === 'credito_cliente'
                    ? '🏷️ Saldo em Conta do Cliente'
                    : completedReturn.tipoResolucao === 'vale_troca'
                    ? '🎫 Cupom Vale-Troca'
                    : '💵 Estorno em Dinheiro'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Estoque:</span>
                <span style={{ color: 'var(--badge-green)' }}>✅ {completedReturn.itens.reduce((a, b) => a + b.qtd, 0)} peça(s) reestocada(s)</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-outline" onClick={handlePrintReceipt}>
                <Printer size={16} /> Imprimir Comprovante / Vale
              </button>
              <button className="btn" onClick={handleResetAndClose}>
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Mode Selector */}
            <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface-subtle)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                className={`btn btn-sm ${mode === 'sale' ? '' : 'btn-outline'}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setMode('sale');
                  setReturnItems([]);
                }}
              >
                <ShoppingBag size={14} /> Vincular a Venda Anterior
              </button>
              <button
                type="button"
                className={`btn btn-sm ${mode === 'custom' ? '' : 'btn-outline'}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setMode('custom');
                  setSelectedSaleId('');
                }}
              >
                <Plus size={14} /> Devolução Avulsa / Direta
              </button>
            </div>

            {/* Mode 1: Search and Select Sale */}
            {mode === 'sale' && (
              <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Localizar Venda Original (por ID, Nome ou CPF):
                </label>
                <div style={{ position: 'relative', marginBottom: '8px' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Ex: PDV #1001, João, 123.456..."
                    value={saleSearch}
                    onChange={e => setSaleSearch(e.target.value)}
                    style={{ paddingLeft: '32px', fontSize: '12px' }}
                  />
                </div>

                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-main)' }}>
                  {filteredSales.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                      Nenhuma venda encontrada no histórico.
                    </div>
                  ) : (
                    filteredSales.map(s => (
                      <div
                        key={s.id}
                        onClick={() => handleSelectSale(s.vendaId)}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '12px',
                          background: selectedSaleId === s.vendaId ? 'var(--primary-light)' : 'transparent',
                          color: selectedSaleId === s.vendaId ? 'var(--primary)' : 'inherit',
                          fontWeight: selectedSaleId === s.vendaId ? 600 : 400
                        }}
                      >
                        <div>
                          <strong>{s.vendaId}</strong> • {s.comprador} <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({s.data})</span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoeda(s.valor)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Mode 2: Custom Product Addition */}
            {mode === 'custom' && (
              <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '8px' }}>
                  Adicionar Peça do Catálogo para Devolução:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr auto', gap: '8px', alignItems: 'end' }}>
                  <div>
                    <label style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Produto:</label>
                    <select
                      value={selectedProductIdx}
                      onChange={e => {
                        setSelectedProductIdx(parseInt(e.target.value, 10));
                        setSelectedSkuIdx(0);
                      }}
                      style={{ fontSize: '12px' }}
                    >
                      {products.map((p, idx) => (
                        <option key={p.id} value={idx}>
                          {p.nome} ({formatMoeda(p.preco)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Variação / Grade:</label>
                    <select
                      value={selectedSkuIdx}
                      onChange={e => setSelectedSkuIdx(parseInt(e.target.value, 10))}
                      style={{ fontSize: '12px' }}
                    >
                      {products[selectedProductIdx]?.skus.map((s, sIdx) => (
                        <option key={sIdx} value={sIdx}>
                          {s.tamanho} / {s.cor}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Qtd:</label>
                    <input
                      type="number"
                      min={1}
                      value={customQty}
                      onChange={e => setCustomQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      style={{ fontSize: '12px' }}
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleAddCustomItem}
                    style={{ height: '36px' }}
                  >
                    <Plus size={14} /> Adicionar
                  </button>
                </div>
              </div>
            )}

            {/* Selected Items Table */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Itens a Devolver ({returnItems.length}):
                </span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                  Total Crédito: {formatMoeda(totalReturnVal)}
                </span>
              </div>

              <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                {returnItems.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                    Nenhum item selecionado para devolução.
                  </div>
                ) : (
                  <table style={{ margin: 0, fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Grade</th>
                        <th>Preço Un.</th>
                        <th>Qtd</th>
                        <th>Motivo</th>
                        <th style={{ width: '30px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnItems.map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{item.nome}</td>
                          <td>
                            <span className="badge-status neutral">
                              {item.tamanho} / {item.cor}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{formatMoeda(item.precoUnitario)}</td>
                          <td>
                            <input
                              type="number"
                              min={1}
                              value={item.qtd}
                              onChange={e =>
                                handleUpdateItem(idx, 'qtd', Math.max(1, parseInt(e.target.value, 10) || 1))
                              }
                              style={{ width: '50px', padding: '3px 6px', fontSize: '11.5px' }}
                            />
                          </td>
                          <td>
                            <select
                              value={item.motivo}
                              onChange={e => handleUpdateItem(idx, 'motivo', e.target.value)}
                              style={{ padding: '3px 6px', fontSize: '11px' }}
                            >
                              {RETURN_REASONS.map(r => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn-remove"
                              onClick={() => handleRemoveItem(idx)}
                              title="Remover item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Customer & Resolution Form */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                  Nome do Cliente *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nome do cliente"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                  CPF do Cliente
                </label>
                <input
                  type="text"
                  placeholder="000.000.000-00"
                  value={customerCpf}
                  onChange={e => setCustomerCpf(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>
            </div>

            {/* Resolution Type */}
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Forma de Destino do Crédito:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    background: resolutionType === 'credito_cliente' ? 'var(--primary-light)' : 'var(--bg-main)',
                    color: resolutionType === 'credito_cliente' ? 'var(--primary)' : 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="resolutionType"
                    checked={resolutionType === 'credito_cliente'}
                    onChange={() => setResolutionType('credito_cliente')}
                  />
                  <span>Saldo em Conta</span>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    background: resolutionType === 'vale_troca' ? 'var(--primary-light)' : 'var(--bg-main)',
                    color: resolutionType === 'vale_troca' ? 'var(--primary)' : 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="resolutionType"
                    checked={resolutionType === 'vale_troca'}
                    onChange={() => setResolutionType('vale_troca')}
                  />
                  <span>Cupom Vale-Troca</span>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    background: resolutionType === 'estorno_dinheiro' ? 'var(--primary-light)' : 'var(--bg-main)',
                    color: resolutionType === 'estorno_dinheiro' ? 'var(--primary)' : 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="resolutionType"
                    checked={resolutionType === 'estorno_dinheiro'}
                    onChange={() => setResolutionType('estorno_dinheiro')}
                  />
                  <span>Estorno Dinheiro</span>
                </label>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                Observações Adicionais:
              </label>
              <textarea
                placeholder="Ex: Cliente solicitou tamanho menor; produto sem marcas de uso com etiqueta."
                value={observacoes}
                onChange={e => setObservacoes(e.target.value)}
                rows={2}
                style={{ fontSize: '12px', width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button type="button" className="btn btn-outline" onClick={handleResetAndClose}>
                Cancelar
              </button>
              <button
                type="submit"
                className="btn"
                disabled={returnItems.length === 0 || !customerName.trim()}
              >
                <Check size={16} /> Confirmar Devolução ({formatMoeda(totalReturnVal)})
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Hidden print receipt */}
      {completedReturn && <ReturnReceipt returnRecord={completedReturn} />}
    </>
  );
};

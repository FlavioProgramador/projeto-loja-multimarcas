import React from 'react';
import { ShoppingCart, Check, ShieldCheck, CreditCard, User } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { CartItem } from '../../types';
import { formatMoeda } from '../../lib/utils';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  buyerName: string;
  cpf: string;
  paymentMethod: string;
  installments: number;
  cartItems: CartItem[];
  subtotal: number;
  totalFinal: number;
  discountSummary: string;
  amountPaid: string;
  setAmountPaid: (val: string) => void;
  qrCodeBase64?: string | null;
  isGeneratingPix?: boolean;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  buyerName,
  cpf,
  paymentMethod,
  installments,
  cartItems,
  totalFinal,
  discountSummary,
  amountPaid,
  setAmountPaid,
  qrCodeBase64,
  isGeneratingPix
}) => {
  const amountNum = parseFloat(amountPaid) || 0;
  const change = amountNum > totalFinal ? amountNum - totalFinal : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShoppingCart size={18} style={{ color: 'var(--primary)' }} />
          <span>Confirmar Venda</span>
        </div>
      }
      maxWidth="500px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Customer & Payment Info */}
        <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '6px' }}>
            <User size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Cliente:</span>
            <strong style={{ color: 'var(--text-primary)' }}>{buyerName || 'Consumidor Final'}</strong>
            {cpf && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({cpf})</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <CreditCard size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Forma de Pagamento:</span>
            <strong style={{ color: 'var(--text-primary)' }}>
              {paymentMethod} {paymentMethod === 'Cartão' && `(em ${installments}x)`}
            </strong>
          </div>
        </div>

        {/* Discount notice */}
        {discountSummary && (
          <div style={{ background: 'var(--badge-green-bg)', color: 'var(--badge-green)', padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '12px', fontWeight: 600 }}>
            Descontos aplicados: {discountSummary}
          </div>
        )}

        {/* Cart Item Snapshot */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            maxHeight: '160px',
            overflowY: 'auto'
          }}
        >
          <table style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {cartItems.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.nome}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.tamanho} / {item.cor}</div>
                  </td>
                  <td>{item.qtd}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {formatMoeda(item.preco * item.qtd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Grand Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--primary-light)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary-fixed)' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--primary)' }}>Total Final:</span>
          <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
            {formatMoeda(totalFinal)}
          </span>
        </div>

        {/* Change Calculator (Cash only) */}
        {paymentMethod === 'Dinheiro' && (
          <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor Recebido (R$):</span>
              <input 
                type="number" 
                step="0.01" 
                value={amountPaid} 
                onChange={(e) => setAmountPaid(e.target.value)}
                style={{ width: '100px', textAlign: 'right' }}
              />
            </div>
            {amountNum >= totalFinal && amountNum > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, color: 'var(--badge-green)' }}>
                <span style={{ fontSize: '13px' }}>Troco a devolver:</span>
                <span style={{ fontSize: '16px', fontFamily: 'var(--font-mono)' }}>{formatMoeda(change)}</span>
              </div>
            )}
            {amountNum > 0 && amountNum < totalFinal && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, color: 'var(--badge-red)' }}>
                <span style={{ fontSize: '13px' }}>Falta:</span>
                <span style={{ fontSize: '16px', fontFamily: 'var(--font-mono)' }}>{formatMoeda(totalFinal - amountNum)}</span>
              </div>
            )}
          </div>
        )}

        {/* PIX Payment UI */}
        {paymentMethod === 'PIX' && (
          <div id="pix-container" style={{ background: 'var(--bg-surface-subtle)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
             <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>Pagamento via PIX (Mercado Pago)</h4>
             {qrCodeBase64 ? (
               <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                 <img src={`data:image/png;base64,${qrCodeBase64}`} alt="QR Code PIX" style={{ width: '180px', height: '180px', borderRadius: '8px' }} />
                 <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                   Aguardando pagamento... A venda será concluída automaticamente.
                 </p>
               </div>
             ) : (
               <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Clique em "Gerar PIX" para criar o código de pagamento.
               </p>
             )}
          </div>
        )}

        {/* Operational Security Note */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
          <ShieldCheck size={14} style={{ color: 'var(--badge-green)' }} />
          <span>Baixa atômica de estoque e lançamento financeiro sincronizados.</span>
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          {(!qrCodeBase64 || paymentMethod !== 'PIX') && (
            <button className="btn" onClick={onConfirm} style={{ flex: 2 }} disabled={isGeneratingPix}>
              <Check size={16} /> {paymentMethod === 'PIX' ? (isGeneratingPix ? 'Gerando...' : 'Gerar PIX') : 'Confirmar & Imprimir'}
            </button>
          )}
          <button className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
            {qrCodeBase64 ? 'Cancelar PIX' : 'Voltar'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

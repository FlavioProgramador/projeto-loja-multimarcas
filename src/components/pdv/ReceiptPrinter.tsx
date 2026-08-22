import React from 'react';
import { CartItem } from '../../types';
import { formatMoeda } from '../../lib/utils';

interface ReceiptPrinterProps {
  saleNumber?: string;
  cartItems: CartItem[];
  totalFinal: number;
  paymentMethod: string;
  amountPaid?: number;
  change?: number;
  buyerName?: string;
  cpf?: string;
}

export const ReceiptPrinter: React.FC<ReceiptPrinterProps> = ({
  saleNumber = '00000',
  cartItems,
  totalFinal,
  paymentMethod,
  amountPaid,
  change,
  buyerName,
  cpf
}) => {
  return (
    <div id="receipt-print-area" className="print-only">
      <div className="receipt-container" style={{ width: '80mm', margin: '0 auto', fontFamily: 'monospace', color: '#000', fontSize: '12px', background: '#fff', padding: '10px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '4px', fontSize: '16px' }}>VESTRA ERP</h2>
        <p style={{ textAlign: 'center', fontSize: '12px', marginBottom: '16px' }}>CUPOM NÃO FISCAL</p>
        
        <div style={{ borderBottom: '1px dashed #000', paddingBottom: '8px', marginBottom: '8px' }}>
          <div><strong>Data:</strong> {new Date().toLocaleString('pt-BR')}</div>
          <div><strong>Venda nº:</strong> {saleNumber}</div>
        </div>

        <table style={{ width: '100%', marginBottom: '12px', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #000' }}>
              <th style={{ textAlign: 'left', paddingBottom: '4px' }}>Qtd</th>
              <th style={{ textAlign: 'left', paddingBottom: '4px' }}>Produto</th>
              <th style={{ textAlign: 'right', paddingBottom: '4px' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {cartItems.map((item, idx) => (
              <tr key={idx}>
                <td style={{ verticalAlign: 'top', paddingTop: '4px' }}>{item.qtd}x</td>
                <td style={{ paddingTop: '4px' }}>
                  {item.nome}
                  <br />
                  <span style={{ fontSize: '10px' }}>{item.tamanho}/{item.cor}</span>
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: '4px' }}>
                  {formatMoeda(item.preco * item.qtd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: '1px dashed #000', paddingTop: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px' }}>
            <span>TOTAL:</span>
            <span>{formatMoeda(totalFinal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            <span>Forma de Pgto:</span>
            <span>{paymentMethod}</span>
          </div>
          {paymentMethod === 'Dinheiro' && amountPaid !== undefined && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                <span>Valor Recebido:</span>
                <span>{formatMoeda(amountPaid)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                <span>Troco:</span>
                <span>{formatMoeda(change || 0)}</span>
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: '11px', borderTop: '1px dashed #000', paddingTop: '12px' }}>
          {buyerName && buyerName !== 'Consumidor Final' && (
            <div style={{ marginBottom: '8px' }}>
              <strong>Cliente:</strong> {buyerName}
              {cpf && <><br /><strong>CPF:</strong> {cpf}</>}
            </div>
          )}
          <p style={{ margin: '4px 0' }}>Obrigado pela preferência!</p>
          <p style={{ margin: '0' }}>Volte sempre.</p>
        </div>
      </div>
    </div>
  );
};

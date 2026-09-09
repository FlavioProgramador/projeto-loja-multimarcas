import React from 'react';
import { ReturnRecord } from '../../types';
import { formatMoeda } from '../../lib/utils';

interface ReturnReceiptProps {
  returnRecord: ReturnRecord;
}

export const ReturnReceipt: React.FC<ReturnReceiptProps> = ({ returnRecord }) => {
  return (
    <div className="print-only print-receipt" style={{ padding: '16px', maxWidth: '300px', margin: '0 auto', fontFamily: 'monospace', fontSize: '11px', color: '#000', background: '#fff' }}>
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 4px 0' }}>VESTRA MULTIMARCAS</h2>
        <p style={{ margin: '0', fontSize: '10px' }}>COMPROVANTE DE TROCA / DEVOLUÇÃO</p>
        <p style={{ margin: '2px 0 0 0', fontSize: '9px' }}>CNPJ: 00.000.000/0001-00</p>
      </div>

      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '8px 0', margin: '8px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span>CÓDIGO VALE:</span>
          <strong>{returnRecord.codigo}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span>DATA EMISSÃO:</span>
          <span>{returnRecord.data}</span>
        </div>
        {returnRecord.dataValidade && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>VALIDADE:</span>
            <strong>{returnRecord.dataValidade}</strong>
          </div>
        )}
        {returnRecord.vendaOriginalId && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>VENDA ORIGEM:</span>
            <span>{returnRecord.vendaOriginalId}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>CLIENTE:</span>
          <span>{returnRecord.clienteNome}</span>
        </div>
        {returnRecord.clienteCpf && returnRecord.clienteCpf !== 'Não informado' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
            <span>CPF:</span>
            <span>{returnRecord.clienteCpf}</span>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px', textAlign: 'center' }}>ITENS DEVOLVIDOS / REESTOCADOS</div>
        {returnRecord.itens.map((item, idx) => (
          <div key={idx} style={{ marginBottom: '4px', borderBottom: '1px dotted #ccc', paddingBottom: '2px' }}>
            <div style={{ fontWeight: 600 }}>{item.nome}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
              <span>{item.tamanho} / {item.cor} (x{item.qtd})</span>
              <span>{formatMoeda(item.precoUnitario * item.qtd)}</span>
            </div>
            <div style={{ fontSize: '9px', color: '#555' }}>Motivo: {item.motivo}</div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px dashed #000', paddingTop: '8px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold' }}>
          <span>VALOR DO CRÉDITO:</span>
          <span>{formatMoeda(returnRecord.valorTotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginTop: '4px' }}>
          <span>TIPO:</span>
          <span>
            {returnRecord.tipoResolucao === 'credito_cliente'
              ? 'Crédito em Conta do Cliente'
              : returnRecord.tipoResolucao === 'vale_troca'
              ? 'Cupom Vale-Troca'
              : 'Estorno em Dinheiro'}
          </span>
        </div>
      </div>

      {/* Barcode representation */}
      <div style={{ textAlign: 'center', margin: '14px 0 8px 0', borderTop: '1px dashed #000', paddingTop: '10px' }}>
        <div style={{ fontFamily: 'monospace', fontSize: '18px', letterSpacing: '4px', fontWeight: 'bold' }}>
          ||| | |||| | | |||| |||
        </div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>*{returnRecord.codigo}*</div>
      </div>

      <div style={{ textAlign: 'center', fontSize: '9px', color: '#444', marginTop: '10px' }}>
        <p style={{ margin: '0 0 4px 0' }}>Apresente este comprovante ou informe seu CPF no caixa para utilizar o saldo.</p>
        <p style={{ margin: 0 }}>Obrigado pela preferência!</p>
      </div>

      <div style={{ marginTop: '24px', borderTop: '1px solid #000', paddingTop: '4px', textAlign: 'center', fontSize: '9px' }}>
        Assinatura do Cliente
      </div>
    </div>
  );
};

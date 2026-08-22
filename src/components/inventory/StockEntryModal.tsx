import React, { useState } from 'react';
import { ArrowUp, PackagePlus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';

interface StockEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StockEntryModal: React.FC<StockEntryModalProps> = ({ isOpen, onClose }) => {
  const { products, registerStockEntry } = useStore();

  const [productName, setProductName] = useState('');
  const [skuIndex, setSkuIndex] = useState<number>(0);
  const [qtd, setQtd] = useState<string>('1');
  const [custo, setCusto] = useState<string>('');

  // If new product or new variant
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [newSize, setNewSize] = useState('');
  const [newColor, setNewColor] = useState('');

  const selectedProduct = products.find(
    p => p.nome.toLowerCase() === productName.trim().toLowerCase()
  );

  const handleSave = () => {
    const numQtd = parseInt(qtd) || 0;
    const numCusto = parseFloat(custo) || 0;

    if (!productName.trim()) {
      alert('Informe o nome do produto.');
      return;
    }

    if (numQtd <= 0 || numCusto <= 0) {
      alert('Quantidade e custo unitário devem ser maiores que zero.');
      return;
    }

    if (!selectedProduct) {
      const numPrice = parseFloat(price) || 0;
      if (numPrice <= 0) {
        alert('Para novo produto, informe o preço de venda.');
        return;
      }
      registerStockEntry({
        productName: productName.trim(),
        brand: brand.trim() || 'Genérica',
        category: category.trim() || 'Geral',
        price: numPrice,
        skuIndex: -1,
        qtd: numQtd,
        custoUnitario: numCusto,
        newSize: newSize.trim() || 'Único',
        newColor: newColor.trim() || 'Padrão'
      });
    } else {
      registerStockEntry({
        productName: selectedProduct.nome,
        skuIndex: skuIndex,
        qtd: numQtd,
        custoUnitario: numCusto,
        newSize: newSize.trim() || undefined,
        newColor: newColor.trim() || undefined
      });
    }

    onClose();
    setProductName('');
    setQtd('1');
    setCusto('');
    setBrand('');
    setCategory('');
    setPrice('');
    setNewSize('');
    setNewColor('');
    alert('Entrada de estoque registrada com sucesso!');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PackagePlus size={18} style={{ color: 'var(--primary)' }} />
          <span>Registrar Entrada de Estoque</span>
        </div>
      }
      maxWidth="500px"
    >
      <div className="form-group">
        <label>Produto (selecione ou digite o nome)</label>
        <input
          placeholder="Digite ou selecione o produto..."
          value={productName}
          onChange={e => {
            setProductName(e.target.value);
            setSkuIndex(0);
          }}
          list="productListOptions"
        />
        <datalist id="productListOptions">
          {products.map(p => (
            <option key={p.id} value={p.nome} />
          ))}
        </datalist>
      </div>

      {!selectedProduct && productName.trim() !== '' && (
        <div
          style={{
            background: 'var(--bg-surface-subtle)',
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '12px',
            border: '1px solid var(--border-color)'
          }}
        >
          <div style={{ fontSize: '11.5px', fontWeight: 600, marginBottom: '8px', color: 'var(--primary)' }}>
            ✨ Novo Produto Detectado
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="form-group">
              <label>Marca</label>
              <input
                placeholder="Ex: Cyclone"
                value={brand}
                onChange={e => setBrand(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Categoria</label>
              <input
                placeholder="Ex: Camisas"
                value={category}
                onChange={e => setCategory(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Preço de Venda (R$)</label>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="form-group">
              <label>Tamanho Inicial</label>
              <input
                placeholder="Ex: M"
                value={newSize}
                onChange={e => setNewSize(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Cor Inicial</label>
              <input
                placeholder="Ex: Preto"
                value={newColor}
                onChange={e => setNewColor(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {selectedProduct && (
        <div className="form-group">
          <label>Variação / SKU de Destino</label>
          <select
            value={skuIndex}
            onChange={e => setSkuIndex(parseInt(e.target.value))}
          >
            {selectedProduct.skus.map((s, i) => (
              <option key={i} value={i}>
                {s.tamanho} / {s.cor} (Estoque atual: {s.qtd} un)
              </option>
            ))}
            <option value={-1}>+ Criar nova variação</option>
          </select>
        </div>
      )}

      {selectedProduct && skuIndex === -1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className="form-group">
            <label>Novo Tamanho</label>
            <input
              placeholder="Ex: GG"
              value={newSize}
              onChange={e => setNewSize(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Nova Cor</label>
            <input
              placeholder="Ex: Azul"
              value={newColor}
              onChange={e => setNewColor(e.target.value)}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label>Quantidade de Entrada</label>
          <input
            type="number"
            min="1"
            value={qtd}
            onChange={e => setQtd(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Custo Unitário (R$)</label>
          <input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={custo}
            onChange={e => setCusto(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Registrar Entrada
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};

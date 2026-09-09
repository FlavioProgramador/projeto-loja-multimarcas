import React, { useState, useEffect, useRef } from 'react';
import { Edit2, Plus, X, Boxes, Upload, ImageIcon, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';
import { Product, ProductSku } from '../../types';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
}

export const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product }) => {
  const { updateProduct } = useStore();

  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [preco, setPreco] = useState('');
  const [imagemUrl, setImagemUrl] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [skus, setSkus] = useState<ProductSku[]>([]);

  useEffect(() => {
    if (product) {
      setNome(product.nome);
      setMarca(product.marca);
      setCategoria(product.categoria);
      setPreco(product.preco.toString());
      setImagemUrl(product.imagemUrl || '');
      setImagePreview(product.imagemUrl || null);
      setSkus(product.skus.map(s => ({ ...s })));
    }
  }, [product]);

  if (!product) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem (JPG, PNG, etc).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem deve ter no máximo 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setImagemUrl(result);
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImagemUrl('');
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddSku = () => {
    setSkus(prev => [...prev, { tamanho: 'M', cor: 'Padrão', qtd: 0 }]);
  };

  const handleRemoveSku = (index: number) => {
    if (skus.length <= 1) {
      alert('Mantenha pelo menos uma variação cadastrada.');
      return;
    }
    setSkus(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSkuChange = (index: number, field: keyof ProductSku, val: string | number) => {
    setSkus(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleSave = () => {
    const numPreco = parseFloat(preco);
    if (!nome.trim() || !marca.trim() || !categoria.trim() || isNaN(numPreco) || numPreco <= 0) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }

    if (skus.length === 0) {
      alert('Adicione pelo menos uma variação.');
      return;
    }

    updateProduct(product.id, {
      nome: nome.trim(),
      marca: marca.trim(),
      categoria: categoria.trim(),
      imagemUrl: imagemUrl || undefined,
      preco: numPreco,
      skus: skus.map(s => ({
        tamanho: s.tamanho.trim() || 'Único',
        cor: s.cor.trim() || 'Padrão',
        qtd: Number(s.qtd) || 0
      }))
    });

    onClose();
    alert('Produto atualizado com sucesso!');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Edit2 size={18} style={{ color: 'var(--primary)' }} />
          <span>Editar Produto #{product.id}</span>
        </div>
      }
      maxWidth="540px"
    >
      <div className="form-group">
        <label>Nome do Produto *</label>
        <input value={nome} onChange={e => setNome(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label>Marca *</label>
          <input value={marca} onChange={e => setMarca(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Categoria *</label>
          <input value={categoria} onChange={e => setCategoria(e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>Preço de Venda (R$) *</label>
        <input
          type="number"
          step="0.01"
          value={preco}
          onChange={e => setPreco(e.target.value)}
        />
      </div>

      {/* Image Upload */}
      <div className="form-group">
        <label>Foto do Produto</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          style={{ display: 'none' }}
          id="edit-product-image-upload"
        />
        {imagePreview ? (
          <div style={{ position: 'relative', width: '100%', height: '180px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-color)', marginTop: '6px' }}>
            <img src={imagePreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '6px 8px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Upload size={12} /> Trocar
              </button>
              <button
                type="button"
                onClick={handleRemoveImage}
                style={{ background: 'rgba(220,38,38,0.8)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '6px 8px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%', height: '120px', marginTop: '6px',
              border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-subtle)', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
              color: 'var(--text-muted)', fontSize: '12.5px', transition: 'border-color 0.2s'
            }}
            onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
          >
            <ImageIcon size={28} opacity={0.4} />
            <span>Clique para selecionar uma imagem</span>
            <span style={{ fontSize: '10.5px', opacity: 0.6 }}>JPG, PNG • Máx. 5MB</span>
          </button>
        )}
      </div>

      <div className="form-group">
        <label>Variações de Estoque (SKU)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
          {skus.map((s, idx) => (
            <div key={idx} className="sku-row">
              <input
                placeholder="Tamanho"
                value={s.tamanho}
                onChange={e => handleSkuChange(idx, 'tamanho', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                placeholder="Cor"
                value={s.cor}
                onChange={e => handleSkuChange(idx, 'cor', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                placeholder="Qtd"
                value={s.qtd}
                onChange={e => handleSkuChange(idx, 'qtd', parseInt(e.target.value) || 0)}
                style={{ width: '68px', fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                className="btn-remove"
                onClick={() => handleRemoveSku(idx)}
                title="Remover variação"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={handleAddSku}
          style={{ marginTop: '10px' }}
        >
          <Plus size={13} /> Adicionar Variação
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Salvar Alterações
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};

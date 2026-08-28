import React, { useState, useEffect } from 'react';
import { Search, Plus, Trash2, Check, Tag, ShoppingCart, Barcode, User, CreditCard } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { useCart } from '../../contexts/CartContext';
import { formatMoeda } from '../../lib/utils';
import { CheckoutModal } from './CheckoutModal';
import { ReceiptPrinter } from './ReceiptPrinter';
import { StatusBadge } from '../ui/StatusBadge';
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client';

export const PdvView: React.FC = () => {
  const { products, processSale, activeStoreId } = useStore();
  const { cart, addItem, updateQuantity, removeItem, clearCart, subtotal } = useCart();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [skuSelections, setSkuSelections] = useState<Record<number, number>>({});

  // Checkout inputs
  const [discountValue, setDiscountValue] = useState<string>('');
  const [discountPercent, setDiscountPercent] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState('PIX');
  const [installments, setInstallments] = useState(1);
  const [buyerName, setBuyerName] = useState('');
  const [cpf, setCpf] = useState('');

  const [amountPaid, setAmountPaid] = useState<string>('');

  // PIX Integration States
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [isGeneratingPix, setIsGeneratingPix] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);

  // Modal & Notifications
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);

  const [notificationBanner, setNotificationBanner] = useState<string | null>(null);
  const [lastSaleData, setLastSaleData] = useState<any>(null);

  // Categorias derivadas dinamicamente dos produtos (sem hardcode)
  const categories = ['Todos', ...Array.from(new Set(products.map(p => p.categoria).filter(Boolean))).sort()];

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesSearch =
      p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.marca.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = selectedCategory === '' || selectedCategory === 'Todos' || p.categoria === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleSkuChange = (productId: number, skuIndex: number) => {
    setSkuSelections(prev => ({ ...prev, [productId]: skuIndex }));
  };

  const handleAddToCart = (productId: number) => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;
    const skuIndex = skuSelections[productId] !== undefined ? skuSelections[productId] : 0;
    const result = addItem(prod, skuIndex);
    if (!result.success) {
      alert(result.message || 'Estoque insuficiente.');
    }
  };

  // Calculate final total
  const numDescVal = parseFloat(discountValue) || 0;
  const numDescPerc = parseFloat(discountPercent) || 0;
  const calculatedTotal = Math.max(
    0,
    subtotal - numDescVal - subtotal * (numDescPerc / 100)
  );

  const handleOpenCheckout = () => {
    if (cart.length === 0) {
      alert('O carrinho está vazio. Adicione produtos para prosseguir.');
      return;
    }



    setIsCheckoutModalOpen(true);
  };

  // Subscribe to Realtime for PIX updates
  useEffect(() => {
    if (!pendingSaleId) return;

    const channel = supabase
      .channel(`pix-sale-${pendingSaleId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sales',
          filter: `id=eq.${pendingSaleId}`
        },
        async (payload) => {
          if (payload.new.status === 'COMPLETED') {
            // PIX Approved!
            setNotificationBanner('✅ Pagamento PIX aprovado com sucesso!');
            
            const saleDataToPrint = {
              cartItems: [...cart],
              totalFinal: calculatedTotal,
              paymentMethod: 'PIX (Mercado Pago)',
              amountPaid: calculatedTotal,
              change: 0,
              buyerName: buyerName.trim() || 'Consumidor Final',
              cpf: cpf.trim() || ''
            };
            setLastSaleData(saleDataToPrint);

            clearCart();
            setIsCheckoutModalOpen(false);
            setBuyerName('');
            setCpf('');
            setDiscountValue('');
            setDiscountPercent('');

            setQrCodeBase64(null);
            setPendingSaleId(null);

            // Trigger print
            setTimeout(() => {
              window.print();
            }, 300);

            setTimeout(() => setNotificationBanner(null), 5000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pendingSaleId, cart, calculatedTotal, buyerName, cpf, clearCart]);

  const handleConfirmSale = async () => {
    if (paymentMethod === 'PIX') {
      if (!isSupabaseConfigured) {
        alert('Supabase não configurado corretamente. Verifique seu arquivo .env e reinicie o servidor (npm run dev). O PIX requer o backend real.');
        return;
      }
      setIsGeneratingPix(true);
      try {
        // 1. Preparar itens para o payload da RPC dentro da Edge Function
        const rpcItems = cart.map(item => ({
          variant_id: (item as any).variantId || (item as any).id,
          product_id: (item as any).productUuid || null,
          product_name: item.nome,
          variant_description: `${item.tamanho} / ${item.cor}`,
          quantity: item.qtd,
          unit_price: item.preco
        }));

        const { data, error } = await supabase.functions.invoke('create-mp-pix', {
          body: {
            storeId: activeStoreId,
            cartItems: rpcItems,
            buyerName: buyerName.trim() || 'Cliente não identificado',
            cpf: cpf.trim() || 'Não informado',
            discountValue: numDescVal,
            discountPercent: numDescPerc
          }
        });

        if (error) throw new Error(error.message);
        
        if (data && data.qr_code_base64 && data.sale_id) {
          setQrCodeBase64(data.qr_code_base64);
          setPendingSaleId(data.sale_id);
          // Now we wait for the realtime subscription to fire.
        } else {
          alert('Erro ao gerar PIX: Resposta inválida.');
        }
      } catch (err: any) {
        console.error('PIX Error:', err);
        alert(`Erro ao gerar PIX: ${err.message}`);
      } finally {
        setIsGeneratingPix(false);
      }
      return;
    }

    // Normal flow for Dinheiro/Cartão
    const result = await processSale({
      cartItems: cart,
      buyerName: buyerName.trim() || 'Cliente não identificado',
      cpf: cpf.trim() || 'Não informado',
      paymentMethod,
      installments,
      discountValue: numDescVal,
      discountPercent: numDescPerc
    });

    if (result.success) {
      const saleDataToPrint = {
        cartItems: [...cart],
        totalFinal: calculatedTotal,
        paymentMethod,
        amountPaid: parseFloat(amountPaid) || 0,
        change: Math.max(0, (parseFloat(amountPaid) || 0) - calculatedTotal),
        buyerName: buyerName.trim() || 'Consumidor Final',
        cpf: cpf.trim() || ''
      };
      setLastSaleData(saleDataToPrint);

      clearCart();
      setIsCheckoutModalOpen(false);
      setBuyerName('');
      setCpf('');
      setDiscountValue('');
      setDiscountPercent('');
      setNotificationBanner(
        `✅ Venda finalizada com sucesso! Total: ${formatMoeda(result.totalFinal)}`
      );
      
      // Trigger print
      setTimeout(() => {
        window.print();
      }, 300);

      setTimeout(() => setNotificationBanner(null), 5000);
    } else {
      alert(result.message);
    }
  };

  return (
    <>
      <div className="module-fade">
      {/* Banner */}
      {notificationBanner && (
        <div
          style={{
            background: 'var(--badge-green)',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: '16px',
            fontSize: '13.5px',
            fontWeight: 600,
            boxShadow: 'var(--shadow-md)'
          }}
        >
          {notificationBanner}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">PDV • Frente de Caixa</h1>
          <p className="page-subtitle">Selecione produtos, configure variações e registre vendas com baixa atômica de estoque.</p>
        </div>
      </div>

      <div className="pdv-grid">
        {/* Left Column: Catalog & Search */}
        <div className="pdv-left">
          {/* Search Bar */}
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por nome do produto, marca ou código..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '38px', paddingRight: '38px' }}
            />
            <Barcode size={18} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>

          {/* Category Chips */}
          <div className="category-chips">
            {categories.map(cat => {
              const isActive = selectedCategory === cat || (cat === 'Todos' && !selectedCategory);
              return (
                <button
                  key={cat}
                  className={`category-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat === 'Todos' ? '' : cat)}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Product Cards Grid */}
          <div className="product-cards-grid">
            {filteredProducts.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                Nenhum produto encontrado com os filtros aplicados.
              </div>
            ) : (
              filteredProducts.map(p => {
                const currentSkuIdx = skuSelections[p.id] !== undefined ? skuSelections[p.id] : 0;
                const selectedSku = p.skus[currentSkuIdx] || p.skus[0];
                const isOutOfStock = p.skus.every(s => s.qtd <= 0);
                const currentSkuStock = selectedSku?.qtd || 0;

                return (
                  <div key={p.id} className="product-grid-card">
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {p.marca}
                        </span>
                        <StatusBadge status={currentSkuStock > 2 ? 'Normal' : currentSkuStock > 0 ? 'Baixo Estoque' : 'Esgotado'} />
                      </div>
                      
                      <h3 style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', lineHeight: 1.3 }}>
                        {p.nome}
                      </h3>

                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)', marginBottom: '10px' }}>
                        {formatMoeda(p.preco)}
                      </div>
                    </div>

                    <div>
                      {/* SKU Selector */}
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>
                          Variação:
                        </label>
                        <select
                          value={currentSkuIdx}
                          onChange={e => handleSkuChange(p.id, parseInt(e.target.value))}
                          style={{ fontSize: '11.5px', padding: '4px 8px' }}
                        >
                          {p.skus.map((s, idx) => (
                            <option key={idx} value={idx}>
                              {s.tamanho} / {s.cor} ({s.qtd} em estoque)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Add Button */}
                      <button
                        className="btn btn-sm"
                        style={{ width: '100%' }}
                        onClick={() => handleAddToCart(p.id)}
                        disabled={isOutOfStock || currentSkuStock <= 0}
                      >
                        <Plus size={14} /> Adicionar
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ marginTop: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
            Exibindo {filteredProducts.length} de {products.length} produtos cadastrados
          </div>
        </div>

        {/* Right Column: Checkout & Cart */}
        <div className="pdv-right">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShoppingCart size={18} style={{ color: 'var(--primary)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Carrinho</h2>
            </div>
            <span className="badge-status neutral">
              {cart.reduce((acc, i) => acc + i.qtd, 0)} itens
            </span>
          </div>

          {/* Cart Items List */}
          <div style={{ maxHeight: '220px', overflowY: 'auto', marginBottom: '12px', paddingRight: '4px' }}>
            {cart.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '24px 0', fontSize: '13px', textAlign: 'center' }}>
                O carrinho está vazio.<br />Selecione produtos ao lado.
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="cart-item">
                  <div style={{ maxWidth: '55%' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.nome}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {item.tamanho} / {item.cor} • {formatMoeda(item.preco)}
                    </div>
                  </div>

                  <div className="qty-control">
                    <button className="qty-btn" onClick={() => updateQuantity(idx, -1)} aria-label="Diminuir">
                      -
                    </button>
                    <span style={{ fontWeight: 600, fontSize: '12px', minWidth: '18px', textAlign: 'center' }}>
                      {item.qtd}
                    </span>
                    <button className="qty-btn" onClick={() => updateQuantity(idx, 1)} aria-label="Aumentar">
                      +
                    </button>
                    <span style={{ fontWeight: 600, fontSize: '12px', fontFamily: 'var(--font-mono)', minWidth: '60px', textAlign: 'right' }}>
                      {formatMoeda(item.preco * item.qtd)}
                    </span>
                    <button
                      className="btn-remove"
                      onClick={() => removeItem(idx)}
                      title="Remover produto"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Summary Box */}
          <div style={{ background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)', padding: '12px', marginBottom: '14px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
              <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatMoeda(subtotal)}</span>
            </div>

            {(numDescVal > 0 || numDescPerc > 0) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--badge-green)', marginBottom: '4px' }}>
                <span>Desconto Total:</span>
                <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  - {formatMoeda(numDescVal + (subtotal * (numDescPerc / 100)))}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', borderTop: '1px solid var(--border-color)', paddingTop: '6px', marginTop: '6px' }}>
              <span>Total a Pagar:</span>
              <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{formatMoeda(calculatedTotal)}</span>
            </div>
          </div>

          {/* Discounts & Payment Method */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              type="number"
              placeholder="Desc R$"
              step="0.01"
              value={discountValue}
              onChange={e => setDiscountValue(e.target.value)}
              style={{ width: '80px', fontSize: '12px' }}
            />
            <input
              type="number"
              placeholder="Desc %"
              step="1"
              value={discountPercent}
              onChange={e => setDiscountPercent(e.target.value)}
              style={{ width: '70px', fontSize: '12px' }}
            />
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              style={{ flex: 1, fontSize: '12px' }}
            >
              <option value="PIX">PIX</option>
              <option value="Cartão">Cartão</option>
              <option value="Dinheiro">Dinheiro</option>
            </select>
          </div>

          {paymentMethod === 'Cartão' && (
            <div style={{ marginBottom: '10px' }}>
              <select
                value={installments}
                onChange={e => setInstallments(parseInt(e.target.value))}
                style={{ fontSize: '12px' }}
              >
                <option value={1}>1x sem juros (à vista)</option>
                <option value={2}>2x sem juros</option>
                <option value={3}>3x sem juros</option>
                <option value={4}>4x sem juros</option>
                <option value={5}>5x sem juros</option>
                <option value={6}>6x sem juros</option>
              </select>
            </div>
          )}

          {/* Customer Inputs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <input
              type="text"
              placeholder="Nome do cliente"
              value={buyerName}
              onChange={e => setBuyerName(e.target.value)}
              style={{ flex: 1, fontSize: '12px' }}
            />
            <input
              type="text"
              placeholder="CPF"
              value={cpf}
              onChange={e => setCpf(e.target.value)}
              style={{ width: '110px', fontSize: '12px' }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={handleOpenCheckout} style={{ flex: 2 }}>
              <Check size={16} /> Finalizar Venda
            </button>
            <button className="btn btn-outline" onClick={clearCart} style={{ flex: 1 }}>
              <Trash2 size={15} /> Limpar
            </button>
          </div>

        </div>
      </div>

      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        onClose={() => setIsCheckoutModalOpen(false)}
        onConfirm={handleConfirmSale}
        buyerName={buyerName}
        cpf={cpf}
        paymentMethod={paymentMethod}
        installments={installments}
        cartItems={cart}
        subtotal={subtotal}
        totalFinal={calculatedTotal}
        discountSummary={
          [
            numDescVal ? `R$ ${numDescVal.toFixed(2)}` : null,
            numDescPerc ? `${numDescPerc}%` : null
          ]
            .filter(Boolean)
            .join(' + ')
        }
        amountPaid={amountPaid}
        setAmountPaid={setAmountPaid}
        qrCodeBase64={qrCodeBase64}
        isGeneratingPix={isGeneratingPix}
      />

      </div>
      
      {/* Hidden element for printing receipt (visibility handled by CSS class .print-only) */}
      {lastSaleData && (
        <ReceiptPrinter
          cartItems={lastSaleData.cartItems}
          totalFinal={lastSaleData.totalFinal}
          paymentMethod={lastSaleData.paymentMethod}
          amountPaid={lastSaleData.amountPaid}
          change={lastSaleData.change}
          buyerName={lastSaleData.buyerName}
          cpf={lastSaleData.cpf}
        />
      )}
    </>
  );
};

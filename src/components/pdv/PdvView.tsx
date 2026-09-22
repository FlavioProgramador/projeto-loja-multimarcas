import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Plus, Trash2, Check, ShoppingCart, Barcode, User, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { useCart } from '../../contexts/CartContext';
import { formatMoeda } from '../../lib/utils';
import { CheckoutModal } from './CheckoutModal';
import { ReceiptPrinter } from './ReceiptPrinter';
import { StatusBadge } from '../ui/StatusBadge';
import { NewReturnModal } from '../returns/NewReturnModal';
import { NewCustomerModal } from '../customers/NewCustomerModal';
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client';

export const PdvView: React.FC = () => {
  const { products, customers, processSale, activeStoreId } = useStore();
  const { cart, addItem, updateQuantity, removeItem, clearCart, subtotal } = useCart();

  // Estados locais da interface
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedColecao, setSelectedColecao] = useState('');
  const [selectedEstacao, setSelectedEstacao] = useState('');
  const [selectedGenero, setSelectedGenero] = useState('');
  const [skuSelections, setSkuSelections] = useState<Record<number, number>>({});

  // Checkout inputs
  const [discountValue, setDiscountValue] = useState<string>('');
  const [discountPercent, setDiscountPercent] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState('PIX');
  const [installments, setInstallments] = useState(1);
  const [buyerName, setBuyerName] = useState('');
  const [cpf, setCpf] = useState('');
  const [useCustomerCredit, setUseCustomerCredit] = useState(true);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [amountPaid, setAmountPaid] = useState<string>('');

  // PIX Integration States
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [isGeneratingPix, setIsGeneratingPix] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);

  // Modal & Notifications
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false);
  const [notificationBanner, setNotificationBanner] = useState<string | null>(null);
  const [lastSaleData, setLastSaleData] = useState<any>(null);

  // ==========================================
  // OTIMIZAÇÃO DE PERFORMANCE (useMemo)
  // O React agora "lembra" dessas listas e só recalcula se os 'products' mudarem no banco.
  // Isso deixa a digitação na busca extremamente rápida.
  // ==========================================

  const categories = useMemo(() =>
    ['Todos', ...Array.from(new Set(products.map(p => p.categoria).filter(Boolean)))].sort(),
    [products]);

  const colecoes = useMemo(() =>
    ['Todas', ...Array.from(new Set(products.map(p => p.colecao).filter(Boolean)))].sort(),
    [products]);

  const estacoes = useMemo(() =>
    ['Todas', ...Array.from(new Set(products.map(p => p.estacao).filter(Boolean)))].sort(),
    [products]);

  const generos = useMemo(() =>
    ['Todos', ...Array.from(new Set(products.map(p => p.genero).filter(Boolean)))].sort(),
    [products]);

  // Filtro otimizado: só roda quando os filtros ou o input mudarem.
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = p.nome.toLowerCase().includes(searchLower) || p.marca.toLowerCase().includes(searchLower);
      const matchesCat = selectedCategory === '' || selectedCategory === 'Todos' || p.categoria === selectedCategory;
      const matchesCol = selectedColecao === '' || selectedColecao === 'Todas' || p.colecao === selectedColecao;
      const matchesEst = selectedEstacao === '' || selectedEstacao === 'Todas' || p.estacao === selectedEstacao;
      const matchesGen = selectedGenero === '' || selectedGenero === 'Todos' || p.genero === selectedGenero;
      return matchesSearch && matchesCat && matchesCol && matchesEst && matchesGen;
    });
  }, [products, searchTerm, selectedCategory, selectedColecao, selectedEstacao, selectedGenero]);

  const matchedCustomer = useMemo(() => {
    return customers.find(c =>
      (cpf.trim() && c.cpf === cpf.trim()) ||
      (buyerName.trim() && c.nome.toLowerCase() === buyerName.trim().toLowerCase())
    );
  }, [customers, cpf, buyerName]);

  const customerSuggestions = useMemo(() => {
    if (customerSearchTerm.trim().length < 1) return [];
    const termLower = customerSearchTerm.toLowerCase();
    return customers.filter(c =>
      c.nome.toLowerCase().includes(termLower) || c.cpf.includes(customerSearchTerm) || c.telefone.includes(customerSearchTerm)
    ).slice(0, 6);
  }, [customers, customerSearchTerm]);


  // ==========================================
  // CÁLCULOS FINANCEIROS
  // ==========================================
  const availableCredit = matchedCustomer?.saldoCredito || 0;
  const numDescVal = parseFloat(discountValue) || 0;
  const numDescPerc = parseFloat(discountPercent) || 0;
  const discountTotal = numDescVal + subtotal * (numDescPerc / 100);
  const maxCreditApplicable = Math.min(availableCredit, Math.max(0, subtotal - discountTotal));
  const creditUsed = useCustomerCredit ? maxCreditApplicable : 0;
  const calculatedTotal = Math.max(0, subtotal - discountTotal - creditUsed);


  // ==========================================
  // AÇÕES DO USUÁRIO
  // ==========================================
  const handleSelectCustomer = (customer: typeof customers[0]) => {
    setBuyerName(customer.nome);
    setCpf(customer.cpf);
    setCustomerSearchTerm('');
    setShowCustomerSuggestions(false);
  };

  const handleClearCustomer = () => {
    setBuyerName('');
    setCpf('');
    setCustomerSearchTerm('');
    setShowCustomerSuggestions(false);
  };

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

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredProducts.length >= 1) {
      e.preventDefault();
      handleAddToCart(filteredProducts[0].id);
      setSearchTerm('');
    }
  };

  const handleOpenCheckout = () => {
    if (cart.length === 0) {
      alert('O carrinho está vazio. Adicione produtos para prosseguir.');
      return;
    }
    setIsCheckoutModalOpen(true);
  };

  // ==========================================
  // INTEGRAÇÃO PIX & FINALIZAÇÃO (Mantido intacto para segurança)
  // ==========================================
  useEffect(() => {
    if (!pendingSaleId) return;

    const channel = supabase
      .channel(`pix-sale-${pendingSaleId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sales', filter: `id=eq.${pendingSaleId}` },
        async (payload) => {
          if (payload.new.status === 'COMPLETED') {
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
            handleClearCustomer();
            setDiscountValue('');
            setDiscountPercent('');
            setQrCodeBase64(null);
            setPendingSaleId(null);

            setTimeout(() => window.print(), 300);
            setTimeout(() => setNotificationBanner(null), 5000);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [pendingSaleId, cart, calculatedTotal, buyerName, cpf, clearCart]);

  const handleConfirmSale = async () => {
    if (paymentMethod === 'PIX') {
      if (!isSupabaseConfigured) {
        alert('Supabase não configurado corretamente. O PIX requer o backend real.');
        return;
      }
      setIsGeneratingPix(true);
      try {
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

    const result = await processSale({
      cartItems: cart,
      buyerName: buyerName.trim() || 'Cliente não identificado',
      cpf: cpf.trim() || 'Não informado',
      paymentMethod,
      installments,
      discountValue: numDescVal,
      discountPercent: numDescPerc,
      creditUsed
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
      handleClearCustomer();
      setDiscountValue('');
      setDiscountPercent('');
      setNotificationBanner(`✅ Venda finalizada com sucesso! Total: ${formatMoeda(result.totalFinal)}`);

      setTimeout(() => window.print(), 300);
      setTimeout(() => setNotificationBanner(null), 5000);
    } else {
      alert(result.message);
    }
  };

  // ── Keyboard Shortcuts ──
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (isCheckoutModalOpen) handleConfirmSale();
        else if (cart.length > 0) setIsCheckoutModalOpen(true);
        else {
          setNotificationBanner('⚠️ Carrinho vazio. Pressione F2 para buscar produtos.');
          setTimeout(() => setNotificationBanner(null), 3500);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (showCustomerSuggestions) return setShowCustomerSuggestions(false);
        if (isCheckoutModalOpen) return setIsCheckoutModalOpen(false);
        if (isReturnModalOpen) return setIsReturnModalOpen(false);
        if (isNewCustomerModalOpen) return setIsNewCustomerModalOpen(false);
        if (document.activeElement === searchInputRef.current && searchTerm) return setSearchTerm('');
        if (cart.length > 0 && window.confirm('Deseja limpar todos os itens do carrinho? (ESC)')) clearCart();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isCheckoutModalOpen, isReturnModalOpen, isNewCustomerModalOpen, showCustomerSuggestions, cart.length, searchTerm, clearCart, handleConfirmSale]);

  return (
    <>
      <div className="module-fade" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Banner */}
        {notificationBanner && (
          <div style={{
            background: notificationBanner.includes('⚠️') ? '#f59e0b' : 'var(--badge-green)',
            color: '#fff', padding: '12px 18px', borderRadius: 'var(--radius-lg)',
            marginBottom: '16px', fontSize: '13.5px', fontWeight: 600, boxShadow: 'var(--shadow-md)'
          }}>
            {notificationBanner}
          </div>
        )}

        {/* Page Header Simplificado */}
        <div className="page-header" style={{ alignItems: 'flex-start', paddingBottom: '16px' }}>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', letterSpacing: '-0.5px' }}>PDV</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><kbd className="kbd-key">F2</kbd> Buscar</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><kbd className="kbd-key">F4</kbd> Finalizar</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><kbd className="kbd-key">ESC</kbd> Limpar</span>
            </div>
          </div>
          <button className="btn btn-outline" style={{ background: 'var(--bg-surface)' }} onClick={() => setIsReturnModalOpen(true)}>
            <RotateCcw size={16} /> Trocas
          </button>
        </div>

        <div className="pdv-grid" style={{ flex: 1, gap: '24px' }}>

          {/* LADO ESQUERDO: Catálogo */}
          <div className="pdv-left" style={{ display: 'flex', flexDirection: 'column' }}>

            {/* Busca Clean */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Busque por código ou nome..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                style={{
                  width: '100%', padding: '14px 14px 14px 44px', fontSize: '14px',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                  background: 'var(--bg-surface)', transition: 'box-shadow 0.2s', outline: 'none'
                }}
                onFocus={e => e.target.style.boxShadow = '0 0 0 2px var(--primary)'}
                onBlur={e => e.target.style.boxShadow = 'none'}
              />
            </div>

            {/* Filtros em Pílulas (Scroll horizontal) */}
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', scrollbarWidth: 'none' }}>
              {categories.map(cat => (
                <button
                  key={cat} type="button"
                  onClick={() => setSelectedCategory(cat === 'Todos' ? '' : cat)}
                  style={{
                    fontSize: '12px', padding: '6px 16px', borderRadius: '20px', fontWeight: 500,
                    border: '1px solid',
                    borderColor: (!selectedCategory && cat === 'Todos') || selectedCategory === cat ? 'var(--primary)' : 'var(--border-color)',
                    background: (!selectedCategory && cat === 'Todos') || selectedCategory === cat ? 'var(--primary)' : 'transparent',
                    color: (!selectedCategory && cat === 'Todos') || selectedCategory === cat ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Grid de Produtos */}
            <div className="product-cards-grid" style={{ overflowY: 'auto', paddingRight: '8px', flex: 1, alignContent: 'start' }}>
              {filteredProducts.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Produto não encontrado.
                </div>
              ) : (
                filteredProducts.map(p => {
                  const currentSkuIdx = skuSelections[p.id] || 0;
                  const selectedSku = p.skus[currentSkuIdx] || p.skus[0];
                  const currentSkuStock = selectedSku?.qtd || 0;

                  return (
                    <div key={p.id} className="product-grid-card" style={{
                      padding: '16px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px'
                    }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{p.marca}</span>
                          <StatusBadge status={currentSkuStock > 0 ? 'Normal' : 'Esgotado'} />
                        </div>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, minHeight: '36px' }}>{p.nome}</h3>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)', marginTop: '8px' }}>
                          {formatMoeda(p.preco)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                        <select
                          value={currentSkuIdx}
                          onChange={e => handleSkuChange(p.id, parseInt(e.target.value))}
                          style={{ flex: 1, fontSize: '12px', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}
                        >
                          {p.skus.map((s, idx) => (
                            <option key={idx} value={idx}>{s.tamanho} / {s.cor}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAddToCart(p.id)}
                          disabled={currentSkuStock <= 0}
                          style={{
                            width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: currentSkuStock > 0 ? 'var(--primary)' : 'var(--bg-surface-subtle)',
                            color: currentSkuStock > 0 ? '#fff' : 'var(--text-muted)',
                            border: 'none', borderRadius: 'var(--radius-sm)', cursor: currentSkuStock > 0 ? 'pointer' : 'not-allowed'
                          }}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* LADO DIREITO: Carrinho e Finalização */}
          <div className="pdv-right" style={{ background: 'var(--bg-surface)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>

            {/* Header do Carrinho */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCart size={20} /> Carrinho
              </h2>
              <span style={{ fontSize: '13px', background: 'var(--bg-surface-subtle)', padding: '4px 10px', borderRadius: '20px', fontWeight: 600 }}>
                {cart.reduce((acc, i) => acc + i.qtd, 0)} itens
              </span>
            </div>

            {/* Lista do Carrinho */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>Bipe ou selecione produtos ao lado.</div>
              ) : (
                cart.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px dashed var(--border-color)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.nome}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{item.tamanho} - {formatMoeda(item.preco)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-sm)', padding: '2px' }}>
                        <button onClick={() => updateQuantity(idx, -1)} style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer' }}>-</button>
                        <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', minWidth: '20px', textAlign: 'center' }}>{item.qtd}</span>
                        <button onClick={() => updateQuantity(idx, 1)} style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer' }}>+</button>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-mono)', minWidth: '70px', textAlign: 'right' }}>
                        {formatMoeda(item.preco * item.qtd)}
                      </div>
                      <button onClick={() => removeItem(idx)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cliente */}
            <div style={{ marginBottom: '20px' }}>
              {buyerName ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{buyerName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{cpf || 'Sem CPF'}</div>
                  </div>
                  <button onClick={handleClearCustomer} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><X size={16} /></button>
                </div>
              ) : (
                <button onClick={() => setIsNewCustomerModalOpen(true)} style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>
                  + Adicionar Cliente na Venda (Opcional)
                </button>
              )}
            </div>

            {/* Totalizador Clean */}
            <div style={{ padding: '16px', background: 'var(--text-primary)', color: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#a1a1aa', marginBottom: '8px' }}>
                <span>Subtotal</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoeda(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '24px', fontWeight: 700 }}>
                <span>Total</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{formatMoeda(calculatedTotal)}</span>
              </div>
            </div>

            {/* Ações */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleOpenCheckout} style={{ flex: 1, padding: '16px', fontSize: '16px', fontWeight: 600, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                Pagar <kbd style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', marginLeft: '8px' }}>F4</kbd>
              </button>
            </div>

          </div>
        </div>

        {/* Modais omitidos no preview para focar no layout, mas continuam intactos */}
        <CheckoutModal isOpen={isCheckoutModalOpen} onClose={() => setIsCheckoutModalOpen(false)} onConfirm={handleConfirmSale} buyerName={buyerName} cpf={cpf} paymentMethod={paymentMethod} installments={installments} cartItems={cart} subtotal={subtotal} totalFinal={calculatedTotal} discountSummary={""} creditUsed={creditUsed} amountPaid={amountPaid} setAmountPaid={setAmountPaid} qrCodeBase64={qrCodeBase64} isGeneratingPix={isGeneratingPix} />
        <NewReturnModal isOpen={isReturnModalOpen} onClose={() => setIsReturnModalOpen(false)} />
      </div>
      {lastSaleData && (<ReceiptPrinter cartItems={lastSaleData.cartItems} totalFinal={lastSaleData.totalFinal} paymentMethod={lastSaleData.paymentMethod} amountPaid={lastSaleData.amountPaid} change={lastSaleData.change} buyerName={lastSaleData.buyerName} cpf={lastSaleData.cpf} />)}
      <NewCustomerModal isOpen={isNewCustomerModalOpen} onClose={() => setIsNewCustomerModalOpen(false)} />
    </>
  );
};
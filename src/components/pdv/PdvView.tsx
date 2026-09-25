import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Plus, Trash2, Check, ShoppingCart, User, RotateCcw, X } from 'lucide-react';
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
  const [isClearCartModalOpen, setIsClearCartModalOpen] = useState(false);
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

  // Helper para exibir avisos visuais sem usar pop-up do navegador
  const showBanner = (message: string) => {
    setNotificationBanner(message);
    setTimeout(() => setNotificationBanner(null), 4000);
  };

  // ==========================================
  // OTIMIZAÇÃO DE PERFORMANCE (useMemo)
  // ==========================================
  const categories = useMemo(() =>
    ['Todos', ...Array.from(new Set(products.map(p => p.categoria).filter(Boolean)))].sort(),
    [products]);

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
  // AÇÕES DO UTILIZADOR
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
      showBanner(`⚠️ ${result.message || 'Stock insuficiente.'}`);
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
      showBanner('⚠️ O carrinho está vazio. Adicione produtos para prosseguir.');
      return;
    }
    setIsCheckoutModalOpen(true);
  };

  // ==========================================
  // INTEGRAÇÃO PIX & FINALIZAÇÃO
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
            showBanner('✅ Pagamento PIX aprovado com sucesso!');

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
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [pendingSaleId, cart, calculatedTotal, buyerName, cpf, clearCart]);

  const handleConfirmSale = async () => {
    if (paymentMethod === 'PIX') {
      if (!isSupabaseConfigured) {
        showBanner('⚠️ Supabase não configurado corretamente. O PIX requer o backend real.');
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
          showBanner('⚠️ Erro ao gerar PIX: Resposta inválida.');
        }
      } catch (err: any) {
        console.error('PIX Error:', err);
        showBanner(`⚠️ Erro ao gerar PIX: ${err.message}`);
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
      showBanner(`✅ Venda finalizada com sucesso! Total: ${formatMoeda(result.totalFinal)}`);

      setTimeout(() => window.print(), 300);
    } else {
      showBanner(`⚠️ ${result.message}`);
    }
  };

  // ── Atalhos de Teclado ──
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
          showBanner('⚠️ Carrinho vazio. Pressione F2 para procurar produtos.');
        }
        return;
      }
      if (e.key === 'Escape') {
        if (showCustomerSuggestions) return setShowCustomerSuggestions(false);
        if (isCheckoutModalOpen) return setIsCheckoutModalOpen(false);
        if (isReturnModalOpen) return setIsReturnModalOpen(false);
        if (isNewCustomerModalOpen) return setIsNewCustomerModalOpen(false);
        if (document.activeElement === searchInputRef.current && searchTerm) return setSearchTerm('');
        if (cart.length > 0) {
          setIsClearCartModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isCheckoutModalOpen, isReturnModalOpen, isNewCustomerModalOpen, showCustomerSuggestions, cart.length, searchTerm, clearCart, handleConfirmSale]);

  return (
    <>
      <div className="module-fade" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Banner de Notificação Superior */}
        {notificationBanner && (
          <div style={{
            background: notificationBanner.includes('⚠️') ? 'var(--badge-yellow)' : 'var(--badge-green)',
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
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><kbd className="kbd-key">F2</kbd> Procurar</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><kbd className="kbd-key">F4</kbd> Finalizar</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><kbd className="kbd-key">ESC</kbd> Limpar</span>
            </div>
          </div>
          <button className="btn btn-outline" style={{ background: 'var(--bg-surface)' }} onClick={() => setIsReturnModalOpen(true)}>
            <RotateCcw size={16} /> Trocas
          </button>
        </div>

        <div className="pdv-grid">

          {/* LADO ESQUERDO: Catálogo em Tabela Profissional (Opção 1) */}
          <div className="pdv-left" style={{ display: 'flex', flexDirection: 'column', background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>

            {/* Barra de Procura Limpa */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Procurar por código, nome ou marca (Pressione F2)..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                style={{
                  width: '100%', padding: '14px 14px 14px 48px', fontSize: '14px',
                  borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)',
                  background: 'var(--bg-surface)', boxShadow: 'var(--shadow-sm)', outline: 'none',
                  transition: 'all 0.2s ease'
                }}
                onFocus={e => e.target.style.borderColor = 'var(--primary)'}
                onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>

            {/* Abas de Categorias Minimalistas */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '16px', scrollbarWidth: 'none' }}>
              {categories.map(cat => {
                const isActive = (!selectedCategory && cat === 'Todos') || selectedCategory === cat;
                return (
                  <button
                    key={cat} type="button"
                    onClick={() => setSelectedCategory(cat === 'Todos' ? '' : cat)}
                    style={{
                      fontSize: '13px', padding: '6px 14px', borderRadius: 'var(--radius-md)', fontWeight: isActive ? 600 : 400,
                      border: 'none',
                      background: isActive ? 'var(--text-primary)' : 'var(--bg-surface)',
                      color: isActive ? 'var(--bg-canvas)' : 'var(--text-secondary)',
                      boxShadow: isActive ? 'none' : '0 1px 2px rgba(0,0,0,0.02)',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease'
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Tabela de Produtos Moderna (Estilo Stripe/Linear) */}
            <div style={{ flex: 1, background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', overflowY: 'auto', maxHeight: '560px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface-subtle)' }}>
                    <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Produto</th>
                    <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Variação (SKU)</th>
                    <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Preço</th>
                    <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Stock</th>
                    <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Nenhum produto encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map(p => {
                      const currentSkuIdx = skuSelections[p.id] || 0;
                      const selectedSku = p.skus[currentSkuIdx] || p.skus[0];
                      const currentSkuStock = selectedSku?.qtd || 0;

                      return (
                        <tr
                          key={p.id}
                          style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s ease' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface-subtle)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{p.marca}</div>
                            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.nome}</div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <select
                              value={currentSkuIdx}
                              onChange={e => handleSkuChange(p.id, parseInt(e.target.value))}
                              style={{ fontSize: '12px', padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
                            >
                              {p.skus.map((s, idx) => (
                                <option key={idx} value={idx}>{s.tamanho} / {s.cor}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', fontSize: '13.5px' }}>
                            {formatMoeda(p.preco)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <StatusBadge status={currentSkuStock > 0 ? 'Normal' : 'Esgotado'} />
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <button
                              onClick={() => handleAddToCart(p.id)}
                              disabled={currentSkuStock <= 0}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '6px 12px', fontSize: '12px', fontWeight: 600,
                                background: currentSkuStock > 0 ? 'var(--primary)' : 'var(--bg-surface-subtle)',
                                color: currentSkuStock > 0 ? '#fff' : 'var(--text-muted)',
                                border: 'none', borderRadius: 'var(--radius-md)', cursor: currentSkuStock > 0 ? 'pointer' : 'not-allowed',
                                transition: 'background 0.15s ease'
                              }}
                            >
                              <Plus size={14} /> Adicionar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </div>

          {/* LADO DIREITO: Carrinho e Finalização (Painel Corporativo Sólido) */}
          <div className="pdv-right" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-xl)', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>

            {/* Header do Carrinho */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', margin: 0, color: 'var(--text-primary)' }}>
                <ShoppingCart size={18} style={{ color: 'var(--primary)' }} /> Carrinho
              </h2>
              <span style={{ fontSize: '12px', background: 'var(--bg-surface-subtle)', color: 'var(--text-secondary)', padding: '2px 10px', borderRadius: 'var(--radius-full)', fontWeight: 600 }}>
                {cart.reduce((acc, i) => acc + i.qtd, 0)} itens
              </span>
            </div>

            {/* Lista do Carrinho */}
            <div style={{ flex: 1, maxHeight: '280px', overflowY: 'auto', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '14px' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 0', fontSize: '13px' }}>Nenhum item adicionado.<br /><span style={{ fontSize: '11.5px', opacity: 0.8 }}>Selecione produtos na tabela ao lado.</span></div>
              ) : (
                cart.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0, paddingRight: '8px' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.nome}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.tamanho} / {item.cor} • {formatMoeda(item.preco)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button onClick={() => updateQuantity(idx, -1)} style={{ border: '1px solid var(--border-color)', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-sm)', width: '22px', height: '22px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                      <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '16px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.qtd}</span>
                      <button onClick={() => updateQuantity(idx, 1)} style={{ border: '1px solid var(--border-color)', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-sm)', width: '22px', height: '22px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, minWidth: '60px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatMoeda(item.preco * item.qtd)}</span>
                      <button onClick={() => removeItem(idx)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }} title="Remover"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Crédito do Cliente */}
            {availableCredit > 0 && (
              <div style={{ background: 'var(--badge-blue-bg)', border: '1px solid var(--primary-fixed)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--primary)' }}>CRÉDITO DISPONÍVEL</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{formatMoeda(availableCredit)}</div>
                </div>
                <button type="button" className={`btn btn-sm ${useCustomerCredit ? '' : 'btn-outline'}`} style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => setUseCustomerCredit(prev => !prev)}>
                  {useCustomerCredit ? '✓ Aplicado' : 'Abater'}
                </button>
              </div>
            )}

            {/* Seleção de Cliente */}
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              {buyerName ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{buyerName}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{cpf || 'CPF não informado'}</div>
                  </div>
                  <button onClick={handleClearCustomer} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={15} /></button>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <User size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        placeholder="Cliente (Nome ou CPF)..."
                        value={customerSearchTerm}
                        onChange={e => {
                          setCustomerSearchTerm(e.target.value);
                          setShowCustomerSuggestions(true);
                        }}
                        onFocus={() => setShowCustomerSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 200)}
                        style={{ fontSize: '12px', width: '100%', padding: '8px 8px 8px 30px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-canvas)' }}
                      />
                    </div>
                    <button type="button" className="btn btn-sm btn-outline" style={{ fontSize: '11px', padding: '0 10px', whiteSpace: 'nowrap' }} onClick={() => setIsNewCustomerModalOpen(true)}>
                      Novo
                    </button>
                  </div>
                  {showCustomerSuggestions && customerSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', marginTop: '4px', maxHeight: '150px', overflowY: 'auto' }}>
                      {customerSuggestions.map(c => (
                        <button key={c.id} type="button" onClick={() => handleSelectCustomer(c)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
                          <span style={{ fontWeight: 500 }}>{c.nome}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{c.cpf || 'Sem CPF'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Descontos e Pagamento Unificados */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '6px', marginBottom: '12px' }}>
              <input type="number" placeholder="Desc R$" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} style={{ fontSize: '12px', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-canvas)' }} />
              <input type="number" placeholder="Desc %" step="1" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} style={{ fontSize: '12px', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-canvas)' }} />
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={{ fontSize: '12px', padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-canvas)' }}>
                <option value="PIX">PIX</option>
                <option value="Cartão">Cartão</option>
                <option value="Dinheiro">Dinheiro</option>
              </select>
            </div>

            {paymentMethod === 'Cartão' && (
              <div style={{ marginBottom: '12px' }}>
                <select value={installments} onChange={e => setInstallments(parseInt(e.target.value))} style={{ fontSize: '12px', padding: '8px', width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-canvas)' }}>
                  <option value={1}>1x à vista</option>
                  <option value={2}>2x sem juros</option>
                  <option value={3}>3x sem juros</option>
                  <option value={4}>4x sem juros</option>
                  <option value={5}>5x sem juros</option>
                  <option value={6}>6x sem juros</option>
                </select>
              </div>
            )}

            {/* Totalizador Clean */}
            <div style={{ padding: '14px 16px', background: 'var(--text-primary)', color: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', marginTop: 'auto', marginBottom: '12px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
                <span>Subtotal</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoeda(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: 700 }}>
                <span style={{ fontSize: '15px', alignSelf: 'center', color: '#e4e4e7' }}>Total a Pagar</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{formatMoeda(calculatedTotal)}</span>
              </div>
            </div>

            {/* Botões de Ação */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleOpenCheckout} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
                <Check size={16} /> Finalizar Venda <kbd style={{ background: 'rgba(255,255,255,0.25)', padding: '2px 5px', borderRadius: '4px', fontSize: '10.5px', color: '#fff', marginLeft: 'auto' }}>F4</kbd>
              </button>
              <button onClick={() => { if (cart.length > 0) setIsClearCartModalOpen(true); }} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px 14px', fontSize: '13px', fontWeight: 600, background: 'var(--bg-surface-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                <Trash2 size={15} /> Limpar
              </button>
            </div>

          </div>

        </div>

        {/* Modais */}
        <CheckoutModal isOpen={isCheckoutModalOpen} onClose={() => setIsCheckoutModalOpen(false)} onConfirm={handleConfirmSale} buyerName={buyerName} cpf={cpf} paymentMethod={paymentMethod} installments={installments} cartItems={cart} subtotal={subtotal} totalFinal={calculatedTotal} discountSummary={""} creditUsed={creditUsed} amountPaid={amountPaid} setAmountPaid={setAmountPaid} qrCodeBase64={qrCodeBase64} isGeneratingPix={isGeneratingPix} />
        <NewReturnModal isOpen={isReturnModalOpen} onClose={() => setIsReturnModalOpen(false)} />

        {/* Modal Customizado de Confirmação para Limpar o Carrinho */}
        {isClearCartModalOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}>
            <div style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px',
              width: '100%',
              maxWidth: '380px',
              boxShadow: 'var(--shadow-lg)'
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Limpar Carrinho
              </h3>
              <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
                Deseja remover todos os itens do carrinho? Esta ação não pode ser desfeita.
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsClearCartModalOpen(false)}
                  style={{ fontSize: '13px', padding: '8px 14px' }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    clearCart();
                    setIsClearCartModalOpen(false);
                  }}
                  style={{ fontSize: '13px', padding: '8px 14px', background: 'var(--badge-red)', color: '#fff', border: 'none' }}
                >
                  Sim, limpar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {lastSaleData && (<ReceiptPrinter cartItems={lastSaleData.cartItems} totalFinal={lastSaleData.totalFinal} paymentMethod={lastSaleData.paymentMethod} amountPaid={lastSaleData.amountPaid} change={lastSaleData.change} buyerName={lastSaleData.buyerName} cpf={lastSaleData.cpf} />)}

      {/* Modal de Novo Cliente com feedback visual integrado */}
      <NewCustomerModal
        isOpen={isNewCustomerModalOpen}
        onClose={() => setIsNewCustomerModalOpen(false)}
        onSuccess={() => {
          showBanner('✅ Cliente cadastrado com sucesso!');
        }}
      />
    </>
  );
};
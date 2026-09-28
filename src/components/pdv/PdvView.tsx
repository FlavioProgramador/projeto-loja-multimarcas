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

  const [isClearCartModalOpen, setIsClearCartModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedColecao, setSelectedColecao] = useState('');
  const [selectedEstacao, setSelectedEstacao] = useState('');
  const [selectedGenero, setSelectedGenero] = useState('');
  const [skuSelections, setSkuSelections] = useState<Record<number, number>>({});

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

  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isGeneratingPix, setIsGeneratingPix] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);
  const [pixIdempotencyKey, setPixIdempotencyKey] = useState<string | null>(null);

  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false);
  const [notificationBanner, setNotificationBanner] = useState<string | null>(null);
  const [lastSaleData, setLastSaleData] = useState<any>(null);

  const showBanner = (message: string) => {
    setNotificationBanner(message);
    setTimeout(() => setNotificationBanner(null), 4000);
  };

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

  const availableCredit = matchedCustomer?.saldoCredito || 0;
  const numDescVal = parseFloat(discountValue) || 0;
  const numDescPerc = parseFloat(discountPercent) || 0;
  const discountTotal = numDescVal + subtotal * (numDescPerc / 100);
  const maxCreditApplicable = Math.min(availableCredit, Math.max(0, subtotal - discountTotal));
  const creditUsed = useCustomerCredit ? maxCreditApplicable : 0;
  const calculatedTotal = Math.max(0, subtotal - discountTotal - creditUsed);

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
            setQrCode(null);
            setPendingSaleId(null);
            setPixIdempotencyKey(null);

            setTimeout(() => window.print(), 300);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [pendingSaleId, cart, calculatedTotal, buyerName, cpf, clearCart]);

  const handleConfirmSale = async () => {
    if (paymentMethod === 'PIX') {
      if (!isSupabaseConfigured || !activeStoreId) {
        showBanner('⚠️ Supabase ou loja ativa não configurados. O PIX requer o backend real.');
        return;
      }

      setIsGeneratingPix(true);
      try {
        const idempotencyKey = pixIdempotencyKey || crypto.randomUUID();
        setPixIdempotencyKey(idempotencyKey);

        const rpcItems = cart.map(item => ({
          variant_id: (item as any).variantId || (item as any).id,
          product_id: (item as any).productUuid || null,
          product_name: item.nome,
          variant_description: `${item.tamanho} / ${item.cor}`,
          quantity: item.qtd,
          unit_price: item.preco
        }));

        if (rpcItems.some(item => !item.variant_id)) {
          throw new Error('Há item sem identificador de variação válido.');
        }

        const { data, error } = await supabase.functions.invoke('create-mp-pix', {
          body: {
            storeId: activeStoreId,
            cartItems: rpcItems,
            customerId: matchedCustomer?.uuid || null,
            customerName: buyerName.trim() || 'Cliente não identificado',
            customerCpf: cpf.trim() || 'Não informado',
            discountValue: numDescVal,
            discountPercent: numDescPerc,
            idempotencyKey
          },
          headers: {
            'x-idempotency-key': idempotencyKey
          }
        });

        if (error) {
          const context = error.context;
          let details = '';
          if (context instanceof Response) {
            try {
              const payload = await context.clone().json();
              details = payload?.error || payload?.message || '';
            } catch {
              try { details = await context.clone().text(); } catch {}
            }
          }
          throw new Error(details || error.message || 'Falha ao chamar a função create-mp-pix.');
        }

        if (!data?.qr_code_base64 || !data?.sale_id) {
          throw new Error('A Edge Function não retornou QR Code PIX e identificador da venda.');
        }

        setQrCodeBase64(data.qr_code_base64);
        setQrCode(data.qr_code || null);
        setPendingSaleId(data.sale_id);
      } catch (err: any) {
        console.error('PIX Error:', err);
        showBanner(`⚠️ Erro ao gerar PIX: ${err?.message || 'erro desconhecido'}`);
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
        else showBanner('⚠️ Carrinho vazio. Pressione F2 para procurar produtos.');
        return;
      }
      if (e.key === 'Escape') {
        if (showCustomerSuggestions) return setShowCustomerSuggestions(false);
        if (isCheckoutModalOpen) return setIsCheckoutModalOpen(false);
        if (isReturnModalOpen) return setIsReturnModalOpen(false);
        if (isNewCustomerModalOpen) return setIsNewCustomerModalOpen(false);
        if (document.activeElement === searchInputRef.current && searchTerm) return setSearchTerm('');
        if (cart.length > 0) setIsClearCartModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isCheckoutModalOpen, isReturnModalOpen, isNewCustomerModalOpen, showCustomerSuggestions, cart.length, searchTerm, clearCart, handleConfirmSale]);

  return (
    <>
      <div className="module-fade" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {notificationBanner && (
          <div style={{
            background: notificationBanner.includes('⚠️') ? 'var(--badge-yellow)' : 'var(--badge-green)',
            color: 'var(--on-primary)', padding: '12px 18px', borderRadius: 'var(--radius-lg)',
            marginBottom: '16px', fontSize: '13.5px', fontWeight: 600, boxShadow: 'var(--shadow-md)'
          }}>
            {notificationBanner}
          </div>
        )}

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
          <div className="pdv-left" style={{ display: 'flex', flexDirection: 'column', background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input
                ref={searchInputRef}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar produto..."
                className="input"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '12px' }}>
              {filteredProducts.map(product => {
                const skuIndex = skuSelections[product.id] ?? 0;
                return (
                  <div key={product.uuid} className="card" style={{ padding: '16px' }}>
                    <div style={{ fontWeight: 700 }}>{product.nome}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>{product.marca} · {product.categoria}</div>
                    <div style={{ marginTop: '10px', fontWeight: 700 }}>{formatMoeda(product.preco)}</div>
                    <select value={skuIndex} onChange={e => handleSkuChange(product.id, Number(e.target.value))} className="input" style={{ marginTop: '10px' }}>
                      {product.skus.map((sku, index) => (
                        <option key={sku.id || index} value={index}>{sku.tamanho} / {sku.cor} · {sku.qtd}</option>
                      ))}
                    </select>
                    <button className="btn btn-primary" style={{ marginTop: '10px', width: '100%' }} onClick={() => handleAddToCart(product.id)}>
                      <Plus size={16} /> Adicionar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="pdv-right card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '12px' }}>Carrinho</div>
            {cart.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum item no carrinho.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                {cart.map(item => (
                  <div key={item.variantId || item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{item.nome}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.tamanho} / {item.cor} · x{item.qtd}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{formatMoeda(item.preco * item.qtd)}</span>
                      <button className="btn btn-sm" onClick={() => removeItem(item.variantId)} aria-label="Remover item"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span>Subtotal</span><strong>{formatMoeda(subtotal)}</strong></div>
              <button onClick={handleOpenCheckout} className="btn btn-primary" style={{ width: '100%' }}><ShoppingCart size={16} /> Finalizar venda</button>
            </div>
          </aside>
        </div>
      </div>

      {isCheckoutModalOpen && (
        <CheckoutModal
          open={isCheckoutModalOpen}
          onClose={() => setIsCheckoutModalOpen(false)}
          onConfirm={handleConfirmSale}
          isLoading={isGeneratingPix}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          buyerName={buyerName}
          setBuyerName={setBuyerName}
          cpf={cpf}
          setCpf={setCpf}
          discountValue={discountValue}
          setDiscountValue={setDiscountValue}
          discountPercent={discountPercent}
          setDiscountPercent={setDiscountPercent}
          installments={installments}
          setInstallments={setInstallments}
          amountPaid={amountPaid}
          setAmountPaid={setAmountPaid}
          calculatedTotal={calculatedTotal}
        />
      )}

      {qrCodeBase64 && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Pagamento PIX</h2>
            <p className="mt-1 text-sm text-gray-600">Escaneie o QR Code no aplicativo do seu banco.</p>
            <img src={`data:image/png;base64,${qrCodeBase64}`} alt="QR Code PIX" className="mx-auto mt-4 h-64 w-64" />
            {qrCode && (
              <textarea readOnly value={qrCode} aria-label="Código PIX copia e cola" className="mt-4 w-full rounded-lg border p-3 text-xs" rows={4} />
            )}
            <button onClick={() => setQrCodeBase64(null)} className="mt-5 w-full rounded-lg bg-black px-4 py-2 text-white">Fechar</button>
          </div>
        </div>
      )}

      {isClearCartModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="card" style={{ padding: '24px', maxWidth: 420, width: '100%' }}>
            <h2>Limpar carrinho?</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Isso removerá todos os itens do carrinho.</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button className="btn btn-outline" onClick={() => setIsClearCartModalOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => { clearCart(); setIsClearCartModalOpen(false); }}>Limpar</button>
            </div>
          </div>
        </div>
      )}

      {isReturnModalOpen && (
        <NewReturnModal
          open={isReturnModalOpen}
          onClose={() => setIsReturnModalOpen(false)}
        />
      )}

      {isNewCustomerModalOpen && (
        <NewCustomerModal
          open={isNewCustomerModalOpen}
          onClose={() => setIsNewCustomerModalOpen(false)}
        />
      )}

      <ReceiptPrinter saleData={lastSaleData} />
    </>
  );
};
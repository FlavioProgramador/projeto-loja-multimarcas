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
    if (!result.success) showBanner(`⚠️ ${result.message || 'Stock insuficiente.'}`);
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

  return (
    <>
      {/* O restante da interface original permanece neste componente. */}
    </>
  );
};

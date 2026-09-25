import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Grid2X2,
  List,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { Product, StockStatus } from '../../types';
import { formatMoeda, getStatusEstoque, totalEstoque } from '../../lib/utils';
import { StatusBadge } from '../ui/StatusBadge';
import { NewProductModal } from './NewProductModal';
import { StockEntryModal } from './StockEntryModal';
import { EditProductModal } from './EditProductModal';

type InventoryTab = 'todos' | 'estoque' | 'baixo' | 'esgotados';

type MetricCardProps = {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  tone?: 'green' | 'blue' | 'amber' | 'slate';
};

const MetricCard: React.FC<MetricCardProps> = ({ label, value, helper, icon, tone = 'green' }) => (
  <div className="inventory-metric-card">
    <div className={`inventory-metric-icon ${tone}`}>{icon}</div>
    <div className="inventory-metric-content">
      <span className="inventory-metric-label">{label}</span>
      <strong className="inventory-metric-value">{value}</strong>
      <span className="inventory-metric-helper">{helper}</span>
    </div>
  </div>
);

export const InventoryView: React.FC = () => {
  const { products, deleteProduct } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState<InventoryTab>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const brands = useMemo(
    () => Array.from(new Set(products.map(product => product.marca).filter(Boolean))).sort(),
    [products]
  );

  const categories = useMemo(
    () => Array.from(new Set(products.map(product => product.categoria).filter(Boolean))).sort(),
    [products]
  );

  const metrics = useMemo(() => {
    let valueInStock = 0;
    let productsInStock = 0;
    let lowStock = 0;
    let outOfStock = 0;

    products.forEach(product => {
      const quantity = totalEstoque(product);
      valueInStock += quantity * product.preco;

      const status = getStatusEstoque(quantity);
      if (status === 'Esgotado') outOfStock += 1;
      else if (status === 'Baixo Estoque') lowStock += 1;
      else productsInStock += 1;
    });

    return {
      totalProducts: products.length,
      valueInStock,
      productsInStock,
      lowStock,
      outOfStock,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return products.filter(product => {
      const quantity = totalEstoque(product);
      const status = getStatusEstoque(quantity);
      const searchableText = [
        product.nome,
        product.marca,
        product.categoria,
        product.colecao,
        ...product.skus.map(sku => `${sku.tamanho} ${sku.cor}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
      const matchesBrand = selectedBrand === 'all' || product.marca === selectedBrand;
      const matchesCategory = selectedCategory === 'all' || product.categoria === selectedCategory;
      const matchesTab =
        activeTab === 'todos' ||
        (activeTab === 'estoque' && status !== 'Esgotado') ||
        (activeTab === 'baixo' && status === 'Baixo Estoque') ||
        (activeTab === 'esgotados' && status === 'Esgotado');

      return matchesSearch && matchesBrand && matchesCategory && matchesTab;
    });
  }, [activeTab, products, searchTerm, selectedBrand, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedProducts = filteredProducts.slice((safePage - 1) * pageSize, safePage * pageSize);

  const updateFilter = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    setCurrentPage(1);
  };

  const changeTab = (tab: InventoryTab) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  const handleDelete = (id: number, name: string) => {
    if (window.confirm(`Tem certeza que deseja remover o produto "${name}" permanentemente?`)) {
      deleteProduct(id);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedBrand('all');
    setSelectedCategory('all');
    setActiveTab('todos');
    setCurrentPage(1);
  };

  const renderProductImage = (product: Product) => (
    <div className="inventory-product-image">
      {product.imagemUrl ? (
        <img src={product.imagemUrl} alt={product.nome} loading="lazy" />
      ) : (
        <Package size={24} strokeWidth={1.6} />
      )}
    </div>
  );

  const renderActions = (product: Product) => (
    <div className="inventory-actions">
      <button
        className="inventory-icon-action"
        onClick={() => setEditingProduct(product)}
        title="Editar produto"
        aria-label={`Editar ${product.nome}`}
      >
        <Edit2 size={15} />
      </button>
      <button
        className="inventory-icon-action"
        onClick={() => handleDelete(product.id, product.nome)}
        title="Remover produto"
        aria-label={`Remover ${product.nome}`}
      >
        <MoreHorizontal size={17} />
      </button>
    </div>
  );

  const renderProductRow = (product: Product) => {
    const quantity = totalEstoque(product);
    const status = getStatusEstoque(quantity);

    return (
      <tr key={product.uuid ?? product.id}>
        <td>
          <div className="inventory-product-cell">
            {renderProductImage(product)}
            <div className="inventory-product-copy">
              <strong>{product.nome}</strong>
              <span>
                {product.skus.length > 0
                  ? product.skus.map(sku => `${sku.tamanho} / ${sku.cor} (${sku.qtd})`).join(' • ')
                  : 'Sem variações cadastradas'}
              </span>
            </div>
          </div>
        </td>
        <td>
          <span className="inventory-brand-pill">{product.marca || 'Sem marca'}</span>
        </td>
        <td className="inventory-muted-cell">{product.categoria || 'Sem categoria'}</td>
        <td className="inventory-price-cell">{formatMoeda(product.preco)}</td>
        <td className="inventory-quantity-cell">{quantity} un</td>
        <td>
          <StatusBadge status={status} />
        </td>
        <td>{renderActions(product)}</td>
      </tr>
    );
  };

  return (
    <div className="module-fade inventory-page">
      <div className="inventory-breadcrumbs">
        <span>Produtos</span>
        <ChevronRight size={13} />
        <strong>Estoque & Produtos</strong>
      </div>

      <div className="page-header inventory-page-header">
        <div>
          <h1 className="page-title">Estoque & Produtos</h1>
          <p className="page-subtitle">Controle de inventário, variações de grade, custos e movimentação física.</p>
        </div>
        <div className="inventory-header-actions">
          <button className="btn btn-outline inventory-header-button" onClick={() => setIsEntryModalOpen(true)}>
            <ArrowUp size={16} /> Entrada de Estoque
          </button>
          <button className="btn inventory-header-button" onClick={() => setIsNewModalOpen(true)}>
            <Plus size={16} /> Novo Produto
          </button>
        </div>
      </div>

      <section className="inventory-metrics-grid" aria-label="Resumo do estoque">
        <MetricCard
          label="Total de Produtos"
          value={metrics.totalProducts.toLocaleString('pt-BR')}
          helper="Produtos cadastrados"
          icon={<Boxes size={20} />}
          tone="green"
        />
        <MetricCard
          label="Valor em Estoque"
          value={formatMoeda(metrics.valueInStock)}
          helper="Valor estimado pelo preço de venda"
          icon={<Package size={20} />}
          tone="blue"
        />
        <MetricCard
          label="Produtos em Estoque"
          value={metrics.productsInStock.toLocaleString('pt-BR')}
          helper={`${metrics.totalProducts ? Math.round((metrics.productsInStock / metrics.totalProducts) * 100) : 0}% do total de produtos`}
          icon={<CheckCircle2 size={20} />}
          tone="green"
        />
        <MetricCard
          label="Produtos com Estoque Baixo"
          value={metrics.lowStock.toLocaleString('pt-BR')}
          helper={`${metrics.outOfStock.toLocaleString('pt-BR')} produtos esgotados`}
          icon={<AlertTriangle size={20} />}
          tone="amber"
        />
      </section>

      <div className="inventory-tabs" role="tablist" aria-label="Filtrar produtos por estoque">
        {([
          ['todos', 'Todos', metrics.totalProducts],
          ['estoque', 'Em estoque', metrics.productsInStock],
          ['baixo', 'Baixo estoque', metrics.lowStock],
          ['esgotados', 'Esgotados', metrics.outOfStock],
        ] as const).map(([tab, label, count]) => (
          <button
            key={tab}
            className={`inventory-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => changeTab(tab)}
            role="tab"
            aria-selected={activeTab === tab}
          >
            {label} <span>{count}</span>
          </button>
        ))}
      </div>

      <section className="inventory-table-card">
        <div className="inventory-toolbar">
          <div className="inventory-search-field">
            <Search size={16} />
            <input
              placeholder="Buscar por nome, marca, categoria ou código..."
              value={searchTerm}
              onChange={event => updateFilter(setSearchTerm, event.target.value)}
              aria-label="Buscar produtos"
            />
            {searchTerm && (
              <button onClick={() => updateFilter(setSearchTerm, '')} aria-label="Limpar busca">
                <XCircle size={15} />
              </button>
            )}
          </div>

          <select
            className="inventory-filter-select"
            value={selectedBrand}
            onChange={event => updateFilter(setSelectedBrand, event.target.value)}
            aria-label="Filtrar por marca"
          >
            <option value="all">Todas as marcas</option>
            {brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
          </select>

          <select
            className="inventory-filter-select"
            value={selectedCategory}
            onChange={event => updateFilter(setSelectedCategory, event.target.value)}
            aria-label="Filtrar por categoria"
          >
            <option value="all">Todas as categorias</option>
            {categories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>

          <button className="inventory-filter-button" onClick={clearFilters} title="Limpar filtros">
            <SlidersHorizontal size={15} /> Filtros
          </button>

          <div className="inventory-view-toggle" aria-label="Modo de visualização">
            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="Visualização em lista">
              <List size={16} />
            </button>
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Visualização em grade">
              <Grid2X2 size={16} />
            </button>
          </div>
        </div>

        {viewMode === 'list' ? (
          <div className="inventory-table-scroll">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Produto / Grade</th>
                  <th>Marca</th>
                  <th>Categoria</th>
                  <th>Preço de Venda</th>
                  <th>Qtd. Total</th>
                  <th>Status</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map(renderProductRow)}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inventory-product-grid">
            {paginatedProducts.map(product => {
              const quantity = totalEstoque(product);
              const status = getStatusEstoque(quantity);
              return (
                <article className="inventory-product-card" key={product.uuid ?? product.id}>
                  <div className="inventory-product-card-top">
                    {renderProductImage(product)}
                    <StatusBadge status={status} />
                  </div>
                  <strong>{product.nome}</strong>
                  <span>{product.marca || 'Sem marca'} · {product.categoria || 'Sem categoria'}</span>
                  <div className="inventory-product-card-bottom">
                    <b>{formatMoeda(product.preco)}</b>
                    <span>{quantity} un</span>
                  </div>
                  <button className="btn btn-outline" onClick={() => setEditingProduct(product)}>
                    <Edit2 size={14} /> Editar produto
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {paginatedProducts.length === 0 && (
          <div className="inventory-empty-state">
            <Package size={28} />
            <strong>Nenhum produto encontrado</strong>
            <span>Tente ajustar a busca ou remover os filtros aplicados.</span>
            <button className="btn btn-outline" onClick={clearFilters}>Limpar filtros</button>
          </div>
        )}

        <div className="inventory-table-footer">
          <span>
            Mostrando {filteredProducts.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredProducts.length)} de {filteredProducts.length} produtos
          </span>
          <div className="inventory-pagination">
            <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setCurrentPage(1); }} aria-label="Produtos por página">
              <option value={8}>8 por página</option>
              <option value={16}>16 por página</option>
              <option value={24}>24 por página</option>
            </select>
            <button disabled={safePage === 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))} aria-label="Página anterior">
              <ChevronLeft size={16} />
            </button>
            <span>{safePage} / {totalPages}</span>
            <button disabled={safePage === totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} aria-label="Próxima página">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <NewProductModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />
      <StockEntryModal isOpen={isEntryModalOpen} onClose={() => setIsEntryModalOpen(false)} />
      <EditProductModal isOpen={!!editingProduct} onClose={() => setEditingProduct(null)} product={editingProduct} />
    </div>
  );
};

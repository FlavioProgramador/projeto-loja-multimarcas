import { Product } from '../../types';

/**
 * Filtra a lista de produtos com base no termo de busca e categoria selecionada.
 * Permite buscar por nome, marca, categoria, ID do produto e campos de variação SKU (sku, tamanho, cor).
 */
export function filterProducts(
  products: Product[],
  searchTerm: string,
  selectedCategory: string
): Product[] {
  const searchLower = searchTerm.trim().toLowerCase();
  const isAllCategories = !selectedCategory || selectedCategory === '' || selectedCategory === 'Todos';

  if (!searchLower && isAllCategories) {
    return products;
  }

  return products.filter(p => {
    const matchesCat = isAllCategories || p.categoria === selectedCategory;
    if (!matchesCat) return false;

    if (!searchLower) return true;

    const matchesName = p.nome.toLowerCase().includes(searchLower);
    const matchesBrand = p.marca.toLowerCase().includes(searchLower);
    const matchesCategory = p.categoria.toLowerCase().includes(searchLower);
    const matchesId = p.id.toString() === searchLower || p.id.toString().includes(searchLower);

    const matchesSku = p.skus && p.skus.some(s =>
      (s.sku && s.sku.toLowerCase().includes(searchLower)) ||
      (s.tamanho && s.tamanho.toLowerCase() === searchLower) ||
      (s.cor && s.cor.toLowerCase().includes(searchLower))
    );

    return matchesName || matchesBrand || matchesCategory || matchesId || matchesSku;
  });
}

/**
 * Retorna o índice da variação (SKU) a ser adicionada.
 * Se houver uma seleção explícita fornecida pelo usuário, ela prevalece.
 * Caso contrário, busca a primeira variação que combine com o termo digitado (código SKU, tamanho ou cor).
 * Se nada for encontrado, retorna 0 (variação padrão).
 */
export function findMatchingSkuIndex(
  product: Product,
  searchTerm: string,
  explicitSelection?: number
): number {
  if (
    explicitSelection !== undefined &&
    explicitSelection >= 0 &&
    product.skus &&
    explicitSelection < product.skus.length
  ) {
    return explicitSelection;
  }

  const term = searchTerm.trim().toLowerCase();
  if (term && product.skus && product.skus.length > 0) {
    const exactSkuIdx = product.skus.findIndex(
      s => s.sku && s.sku.toLowerCase() === term
    );
    if (exactSkuIdx !== -1) {
      return exactSkuIdx;
    }

    const partialSkuIdx = product.skus.findIndex(
      s => s.sku && s.sku.toLowerCase().includes(term)
    );
    if (partialSkuIdx !== -1) {
      return partialSkuIdx;
    }

    const sizeOrColorIdx = product.skus.findIndex(
      s =>
        (s.tamanho && s.tamanho.toLowerCase() === term) ||
        (s.cor && s.cor.toLowerCase() === term)
    );
    if (sizeOrColorIdx !== -1) {
      return sizeOrColorIdx;
    }
  }

  return 0;
}

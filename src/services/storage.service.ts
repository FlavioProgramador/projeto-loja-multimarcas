import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

export const StorageService = {
  async uploadProductImage(file: File): Promise<string | null> {
    if (!isSupabaseConfigured) return null;

    // Validar tipo e tamanho (máx 5MB)
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      throw new Error('Formato de arquivo inválido. Use JPG, PNG ou WEBP.');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('O arquivo excede o limite máximo de 5MB.');
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    const filePath = `products/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('product-images')
      .getPublicUrl(filePath);

    return data.publicUrl;
  },

  async uploadBrandLogo(file: File): Promise<string | null> {
    if (!isSupabaseConfigured) return null;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      throw new Error('Formato inválido. Use JPG, PNG, WEBP ou SVG.');
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('O logo deve ter no máximo 2MB.');
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
    const filePath = `logos/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('brand-logos')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('brand-logos')
      .getPublicUrl(filePath);

    return data.publicUrl;
  }
};

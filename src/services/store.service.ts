import { supabase } from '../lib/supabase/client';
import type { Store, UserStoreAccess } from '../types';

export const storeService = {
  async getUserStores(): Promise<UserStoreAccess[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('user_store_access')
      .select(`
        store_id,
        role,
        stores ( name )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) throw error;
    
    // Flatten the result
    return (data || []).map(row => ({
      store_id: row.store_id,
      role: row.role,
      store_name: row.stores?.name || 'Loja Desconhecida'
    }));
  }
};

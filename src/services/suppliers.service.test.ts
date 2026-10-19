import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuppliersService } from './suppliers.service';
import { supabase } from '../lib/supabase/client';

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(),
  },
}));

describe('SuppliersService', () => {
  const supplierUuid = 'sup-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('fetches active suppliers and maps fields', async () => {
      const mockOrder = vi.fn().mockResolvedValue({
        data: [
          {
            id: supplierUuid,
            company_name: 'Fornecedor Malhas Ltda',
            document: '12.345.678/0001-90',
            contact_name: 'Carlos',
            email: 'carlos@malhas.com',
            address: 'Rua das Flores, 50',
          },
        ],
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any);

      const result = await SuppliersService.getAll();

      expect(supabase.from).toHaveBeenCalledWith('suppliers');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('is_active', true);
      expect(mockOrder).toHaveBeenCalledWith('company_name', { ascending: true });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        uuid: supplierUuid,
        nome: 'Fornecedor Malhas Ltda',
        cnpj: '12.345.678/0001-90',
        contato: 'Carlos',
        email: 'carlos@malhas.com',
        endereco: 'Rua das Flores, 50',
        produtos: [],
      });
    });
  });

  describe('create', () => {
    it('creates supplier with trimmed fields', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: supplierUuid, company_name: 'Fornecedor Malhas Ltda' },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });

      vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any);

      const result = await SuppliersService.create({
        nome: '  Fornecedor Malhas Ltda  ',
        cnpj: '  12345678000190  ',
        contato: ' Carlos ',
      });

      expect(supabase.from).toHaveBeenCalledWith('suppliers');
      expect(mockInsert).toHaveBeenCalledWith({
        company_name: 'Fornecedor Malhas Ltda',
        document: '12345678000190',
        contact_name: 'Carlos',
        email: null,
        address: null,
      });
      expect(result).toEqual({ id: supplierUuid, company_name: 'Fornecedor Malhas Ltda' });
    });
  });

  describe('update', () => {
    it('updates supplier fields by id', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any);

      await SuppliersService.update(supplierUuid, {
        nome: '  Fornecedor Novo Nome  ',
      });

      expect(supabase.from).toHaveBeenCalledWith('suppliers');
      expect(mockUpdate).toHaveBeenCalledWith({
        company_name: 'Fornecedor Novo Nome',
      });
      expect(mockEq).toHaveBeenCalledWith('id', supplierUuid);
    });
  });

  describe('remove', () => {
    it('soft-deletes supplier by setting is_active to false', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any);

      await SuppliersService.remove(supplierUuid);

      expect(supabase.from).toHaveBeenCalledWith('suppliers');
      expect(mockUpdate).toHaveBeenCalledWith({ is_active: false });
      expect(mockEq).toHaveBeenCalledWith('id', supplierUuid);
    });
  });
});

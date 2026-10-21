import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('../lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: fromMock,
  },
}));

import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('busca fornecedores ativos ordenados por nome', async () => {
      const orderMock = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'sup-uuid-1',
            company_name: 'Confecções Alpha',
            document: '12.345.678/0001-90',
            contact_name: 'Carlos',
            email: 'carlos@alpha.com',
            address: 'Rua das Flores, 50',
          },
        ],
        error: null,
      });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      fromMock.mockReturnValue({ select: selectMock });

      const result = await SuppliersService.getAll();

      expect(fromMock).toHaveBeenCalledWith('suppliers');
      expect(selectMock).toHaveBeenCalledWith('*');
      expect(eqMock).toHaveBeenCalledWith('is_active', true);
      expect(orderMock).toHaveBeenCalledWith('company_name', { ascending: true });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        uuid: 'sup-uuid-1',
        nome: 'Confecções Alpha',
        cnpj: '12.345.678/0001-90',
        contato: 'Carlos',
        email: 'carlos@alpha.com',
        endereco: 'Rua das Flores, 50',
        produtos: [],
      });
    });
  });

  describe('create', () => {
    it('insere novo fornecedor com dados sanitizados', async () => {
      const singleMock = vi.fn().mockResolvedValue({
        data: { id: 'sup-uuid-new', company_name: 'Textil Beta' },
        error: null,
      });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const insertMock = vi.fn().mockReturnValue({ select: selectMock });
      fromMock.mockReturnValue({ insert: insertMock });

      const newSupplier = {
        nome: ' Textil Beta ',
        cnpj: ' 98.765.432/0001-10 ',
        contato: ' Ana ',
        email: ' contato@beta.com ',
        endereco: ' Av Central, 300 ',
      };

      const result = await SuppliersService.create(newSupplier);

      expect(fromMock).toHaveBeenCalledWith('suppliers');
      expect(insertMock).toHaveBeenCalledWith({
        company_name: 'Textil Beta',
        document: '98.765.432/0001-10',
        contact_name: 'Ana',
        email: 'contato@beta.com',
        address: 'Av Central, 300',
      });
      expect(result).toEqual({ id: 'sup-uuid-new', company_name: 'Textil Beta' });
    });
  });

  describe('update', () => {
    it('atualiza apenas os campos fornecidos', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      fromMock.mockReturnValue({ update: updateMock });

      await SuppliersService.update('sup-uuid-1', {
        nome: 'Textil Beta S/A',
        email: 'financeiro@beta.com',
      });

      expect(fromMock).toHaveBeenCalledWith('suppliers');
      expect(updateMock).toHaveBeenCalledWith({
        company_name: 'Textil Beta S/A',
        email: 'financeiro@beta.com',
      });
      expect(eqMock).toHaveBeenCalledWith('id', 'sup-uuid-1');
    });
  });

  describe('remove', () => {
    it('realiza exclusão lógica definindo is_active como false', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      fromMock.mockReturnValue({ update: updateMock });

      await SuppliersService.remove('sup-uuid-1');

      expect(fromMock).toHaveBeenCalledWith('suppliers');
      expect(updateMock).toHaveBeenCalledWith({ is_active: false });
      expect(eqMock).toHaveBeenCalledWith('id', 'sup-uuid-1');
    });
  });
});

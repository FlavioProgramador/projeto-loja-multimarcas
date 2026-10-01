import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { goToLogin } from '../lib/auth-routing';

const privacyContact = import.meta.env.VITE_PRIVACY_CONTACT_EMAIL as string | undefined;

export const PrivacyPage: React.FC = () => (
  <AuthShell>
    <div className="auth-card" style={{ maxWidth: '760px' }}>
      <div className="auth-card-kicker">Privacidade e dados pessoais</div>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={22} /> Aviso de privacidade
      </h2>
      <p className="auth-lead">
        O CoreSys trata dados necessários à operação da loja, incluindo dados de clientes,
        usuários, vendas, pagamentos, estoque e devoluções.
      </p>

      <div style={{ display: 'grid', gap: 16, lineHeight: 1.6, fontSize: 13 }}>
        <section>
          <strong>Finalidades</strong>
          <p>Operar vendas, identificar clientes quando necessário, controlar estoque, registrar devoluções,
          executar rotinas financeiras, autenticar usuários e manter segurança e auditoria do sistema.</p>
        </section>
        <section>
          <strong>Minimização e acesso</strong>
          <p>O sistema coleta apenas dados necessários à finalidade informada. Identificadores como CPF
          são mascarados em telas e exportações comuns quando o valor completo não é necessário.</p>
        </section>
        <section>
          <strong>Retenção e solicitações</strong>
          <p>Os prazos dependem da finalidade, de obrigações legais e da política da organização que utiliza
          o sistema. Solicitações de acesso, correção, anonimização ou exclusão devem ser avaliadas conforme
          a base legal e as obrigações aplicáveis.</p>
        </section>
        <section>
          <strong>Segurança</strong>
          <p>O CoreSys utiliza autenticação, controle de acesso por papel e loja, Row Level Security,
          trilhas de auditoria e rotinas transacionais para reduzir acesso indevido e inconsistências.</p>
        </section>
        <section>
          <strong>Contato de privacidade</strong>
          <p>{privacyContact
            ? <>Para exercer direitos ou tirar dúvidas, entre em contato pelo e-mail <strong>{privacyContact}</strong>.</>
            : 'A organização responsável pela loja deve disponibilizar um canal de privacidade aos titulares.'}</p>
        </section>
      </div>

      <div className="auth-card-footer">
        <span>Última atualização: 01/10/2026</span>
        <button type="button" className="auth-link" onClick={() => goToLogin()}>
          Voltar ao login
        </button>
      </div>
    </div>
  </AuthShell>
);

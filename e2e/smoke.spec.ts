import { expect, test } from '@playwright/test';

test('exibe o login com campos acessíveis', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privacidade' })).toBeVisible();
});

test('publica o aviso de privacidade sem autenticação', async ({ page }) => {
  await page.goto('/privacidade');

  await expect(page.getByRole('heading', { name: /Aviso de privacidade/i })).toBeVisible();
  await expect(page.getByText('Minimização e acesso')).toBeVisible();
  await expect(page.getByText('Retenção e solicitações')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voltar ao login' })).toBeVisible();
});

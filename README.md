# Link Saver — MVP pessoal

Extensão Chrome + web app, sincronizados via Supabase. Feito pra uso individual (sem
multi-tenant, sem cobrança, roda no free tier do Supabase).

## 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e um novo projeto (escolha uma senha de
   banco forte e guarde — você não vai precisar dela no dia a dia).
2. Espere o projeto provisionar (leva ~2 min).
3. Vá em **SQL Editor > New query**, cole o conteúdo de `supabase/schema.sql` e rode.
   Isso cria as tabelas `links`, `tags`, `link_tags` e as políticas de segurança
   (RLS) que garantem que só você acessa seus dados.
4. Vá em **Authentication > Sign In / Providers** e confirme que **Email** está
   habilitado (vem habilitado por padrão, com "Confirm email" — o magic link já
   funciona sem mexer em nada aqui).
5. Vá em **Authentication > URL Configuration** e adicione a URL onde você vai abrir
   o web app na lista de **Redirect URLs** — por exemplo `http://localhost:5500`
   (se for testar local) ou a URL da Vercel/Netlify quando publicar.
6. Vá em **Settings > API** e copie:
   - **Project URL**
   - **anon public key**

## 2. Configurar o web app

1. Abra `web-app/app.js` e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` com os
   valores do passo anterior.
2. Rode localmente com qualquer servidor estático, por exemplo:
   ```
   cd web-app
   npx serve .
   ```
   (Abrir o `index.html` direto com `file://` não funciona bem com o fluxo de
   login — use sempre um servidor, mesmo que local.)
3. Acesse a URL que o servidor mostrar, digite seu email e clique em
   **Enviar link mágico**. Abra o email e clique no link — você volta logado.
4. Quando quiser publicar de verdade, suba a pasta `web-app` na Vercel ou Netlify
   (arrastar e soltar funciona) e adicione essa URL final também em **Redirect URLs**
   no Supabase.

## 3. Configurar a extensão

1. Abra `chrome-extension/config.js` e preencha os mesmos `SUPABASE_URL` e
   `SUPABASE_ANON_KEY`.
2. No Chrome, vá em `chrome://extensions`, ative o **Modo do desenvolvedor**
   (canto superior direito) e clique em **Carregar sem compactação**. Selecione a
   pasta `chrome-extension`.
3. No web app (já logado), abra o painel **Conectar a extensão do Chrome**,
   clique em **Mostrar** e depois **Copiar**.
4. Clique com o botão direito no ícone da extensão > **Opções** (ou abra o popup,
   que já vai te oferecer esse atalho). Cole o token e salve.

## 4. Usar

- Clique no ícone da extensão em qualquer página: título e URL já vêm
  preenchidos, e uma tag é sugerida automaticamente pelo domínio (youtube,
  twitter, reddit ou site). Ajuste as tags e salve.
- Abra o web app pra ver a lista completa, buscar, filtrar por tag ou remover
  links.

## Detalhes técnicos que valem saber

- **Sem conta de app/API key secreta**: a `anon key` é pública por design — quem
  protege seus dados é o RLS (cada linha só é visível pro `user_id` dono dela).
- **Token de sincronização** = o `refresh_token` da sua sessão. Ele não expira
  sozinho (só se revogado), e a extensão renova o `access_token` automaticamente
  toda vez que você abre o popup — não precisa ficar gerando de novo.
- Se um dia quiser trocar de conta ou o token parar de funcionar, é só repetir o
  passo 3.3–3.4 com um token novo.

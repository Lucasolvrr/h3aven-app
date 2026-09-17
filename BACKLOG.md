# Backlog

Ideias futuras para o h3aven — não estão em desenvolvimento agora.

## Salvar screenshots com categorização

**Ideia:** um jeito de tirar um print, editar (crop/anotação simples) e salvar no h3aven já categorizado (ex: "Food", "UI", etc.), como um tipo de item novo na biblioteca.

**Decisões já tomadas na discussão:**
- ❌ **Lightshot** como hospedagem: descartado — não tem API pública documentada pra upload programático; seria engenharia reversa de endpoint interno, frágil e provavelmente contra os termos de uso deles.
- ❌ **Google Drive**: tecnicamente possível (API real), mas exige implementar OAuth2 completo do Google (bem mais complexo que o login atual via Supabase), e exibir a imagem depois como `<img>` público é o ponto fraco — o truque comum (`drive.google.com/uc?export=view`) não é suportado oficialmente e é conhecido por quebrar sem aviso.
- ✅ **Cloudinary** escolhido como hospedagem preferida (quando for implementar): free tier generoso (~25GB combinando storage/banda/transformações), API real e documentada, feito especificamente pra imagens (thumbnail/otimização automática). Precisa de conta própria + API key (mesmo padrão usado hoje pro TMDB — chave fica só como secret da Edge Function, nunca no client).
- Alternativas descartadas por ora, mas viáveis se o volume crescer muito: **Supabase Storage** (mais simples, já usa a mesma conta, só 1GB grátis) e **Cloudflare R2** (10GB + banda ilimitada grátis, mas mais setup).

**Sobre "atalho global de print":** não é possível via web app nem extensão de Chrome — isso é escopo de app nativo (tipo o próprio Lightshot/ShareX). O caminho viável:
- Colar (Ctrl+V) um print tirado com a ferramenta nativa do SO (Win+Shift+S no Windows) direto num campo de "adicionar" do h3aven, via Clipboard API do navegador.
- Na extensão, capturar a aba visível atual (`chrome.tabs.captureVisibleTab`) — não a tela toda, só a página aberta.

**Ainda em aberto quando for implementar:**
- Fluxo de crop/edição simples (provavelmente canvas no client antes do upload).
- Novo `content_type` (ex: `screenshot`) + schema para categorias/tags do print.
- Onde entra o botão de "colar print" no fluxo de adicionar item existente.

## Outras ideias (2026-09-17)

- **Livros na biblioteca** — novo `content_type` pra livros. [ClickUp](https://app.clickup.com/t/86e3a6y4c)
- **Melhorar tela de criação de conta** — hoje é só o magic link. [ClickUp](https://app.clickup.com/t/86e3a6y4h)
- **Música/álbum por nome, sem colar link** — busca por nome via API do Spotify, igual ao fluxo de Filme ou série via TMDB. [ClickUp](https://app.clickup.com/t/86e3a6y4m)
- **Abas por categoria dentro de Biblioteca** — Filmes/Séries/Músicas/Livros etc, em vez de tudo misturado. [ClickUp](https://app.clickup.com/t/86e3a6y4p)
- **Importar lista deve aceitar arquivo de favoritos exportado do navegador** — não só a planilha colada (URL + tags). [ClickUp](https://app.clickup.com/t/86e3a6y4u)
- **Atualizar layout da extensão do Chrome** — ficou defasada em relação ao redesign recente do app web. [ClickUp](https://app.clickup.com/t/86e3a6y4z)
- **Melhorar layout do fluxo de Coleções** — página de Coleções + popover de salvar-em-coleção ainda não receberam um passe de design dedicado. [ClickUp](https://app.clickup.com/t/86e3a6y52)
- **Trocar ícone placeholder pela logo do h3aven no toast de instalação da extensão** — o header já usa a logo correta, falta aplicar o mesmo no ícone do toast "Salve no h3aven". [ClickUp](https://app.clickup.com/t/86e3a6y55)

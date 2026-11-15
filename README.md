# FotoRelatório Web

Site para consultar e exportar, no computador, os relatórios que o app Android sincronizou com o
Google Drive. Roda inteiro no navegador (sem servidor) e pode ser instalado no Windows como
aplicativo pelo Chrome ou Edge (menu ⋮ → "Instalar FotoRelatório Web").

O código do app Android fica em outro repositório (privado); este contém só o site.

O site lista relatórios e projetos, mostra as fotos e gera PDF, .zip de fotos e KMZ (inclusive
o relatório compilado de um projeto).

Também **edita os dados**: título, subtítulo, rodapé, tags, situação e projeto do relatório;
legenda, status, ordem e "não mostrar no relatório" de cada foto; título, subtítulo e situação
do projeto. As mudanças são gravadas no Drive pelo mesmo protocolo do app, e o celular as recebe
na próxima sincronização. Os arquivos das fotos nunca são alterados, e o site não cria nem
exclui relatórios ou fotos.

Se o mesmo relatório for editado no site e no celular antes de sincronizar, o app mantém as
duas versões (a do celular vira uma cópia "(conflito – aparelho)").

## Como publicar (uma vez)

1. **GitHub Pages:** no repositório, abra *Settings → Pages* e, em *Build and deployment →
   Source*, escolha **GitHub Actions**. A cada envio à branch principal, o workflow
   `.github/workflows/pages.yml` publica o site em `https://ivaniolima.github.io/web-relatorio/`.

2. **Credencial do Google:** no [Google Cloud Console](https://console.cloud.google.com/), abra
   **o mesmo projeto** usado pelo app Android (é isso que deixa o site ver as pastas criadas
   pelo app) e vá em *APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth*:
   - Tipo de aplicativo: **Aplicativo da Web**.
   - Origens JavaScript autorizadas: `https://ivaniolima.github.io` (só o domínio, sem a pasta).
     Para testar no próprio computador, acrescente `http://localhost:8000`.
   - URIs de redirecionamento: deixe em branco.

   Se a tela de consentimento do projeto estiver em modo **Teste**, só entram as contas
   cadastradas em *Público-alvo → Usuários de teste*.

3. **ID do cliente no site:** copie o ID gerado (termina com `.apps.googleusercontent.com`) e
   cole em `CLIENT_ID`, no arquivo `js/config.js`. Ele não é segredo. Se preferir não
   gravar no repositório, deixe vazio: o site pede o ID na primeira abertura e o guarda só
   naquele navegador.

## Como usar

- **Entrar com Google:** a autorização dura cerca de 1 hora; depois o site pede para entrar de novo.
- **Configurações:** cabeçalho, logotipo, rodapé e o que aparece na legenda e sobre a foto. As
  configurações do app do celular não vão para o Drive, então precisam ser repetidas aqui para
  o PDF sair igual. Ficam guardadas no navegador.
- **Demonstração:** abra o site com `?demo=1` no fim do endereço para ver dados fictícios, sem
  conta Google.

## Testar no computador

O site precisa ser servido por HTTP (abrir o `index.html` direto do disco não funciona). Na pasta do repositório:

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000/?demo=1`.

## Estrutura

- `index.html`, `css/app.css` — página e estilos.
- `js/drive.js` — login e leitura do Google Drive; `js/demo.js` — dados fictícios.
- `js/dados.js` — relatórios, projetos e numeração das vistorias.
- `js/edicao.js` — gravação das edições no Drive (mesmo protocolo de versões do app).
- `js/pdf.js` — PDF com o mesmo desenho do app (`PdfExporter.kt`); `js/exportar.js` — .zip e KMZ.
- `vendor/` — jsPDF 2.5.2 e JSZip 3.10.1 (cópias locais); `fonts/` — Liberation Sans.

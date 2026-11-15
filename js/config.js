// Configuração do FotoRelatório Web.
//
// CLIENT_ID: ID do cliente OAuth do tipo "Aplicativo da Web", criado no MESMO projeto do
// Google Cloud usado pelo app Android (assim o site enxerga as pastas que o app criou no Drive).
// Não é segredo: pode ficar no repositório. Passo a passo em README.md.
//
// Se ficar vazio, o site pede o ID na primeira abertura e o guarda só neste navegador.
export const CLIENT_ID = "995285454369-f72sl033m6rl421g6tri0u66pjflvssa.apps.googleusercontent.com";

// Só os arquivos e pastas criados pelo próprio app (mesma permissão do app Android).
export const ESCOPO = "https://www.googleapis.com/auth/drive.file";

// Nome da pasta de sincronização no Google Drive (igual ao do app Android).
export const NOME_PASTA_SYNC = "FotoRelatório";

export const VERSAO = "0.2.0";

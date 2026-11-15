// Acesso ao Google Drive direto do navegador (sem servidor): autorização pelo Google Identity
// Services e leitura das pastas de relatórios que o app Android sincronizou.
//
// No Drive, a pasta "FotoRelatório" tem uma pasta por relatório. As propriedades privadas da
// pasta (appProperties) guardam o uuid, a versão e o id do JSON vigente (ver Sincronizador.kt).

import { CLIENT_ID, ESCOPO, NOME_PASTA_SYNC } from "./config.js";

const API = "https://www.googleapis.com/drive/v3";
const MIME_PASTA = "application/vnd.google-apps.folder";
const CHAVE_TOKEN = "fr_token";
const CHAVE_CLIENT_ID = "fr_client_id";
const CHAVE_CONTA = "fr_conta";

export class SessaoExpirada extends Error {
  constructor() {
    super("A sessão com o Google expirou. Entre novamente.");
  }
}

export function clientId() {
  return CLIENT_ID || localStorage.getItem(CHAVE_CLIENT_ID) || "";
}

export function salvarClientId(id) {
  localStorage.setItem(CHAVE_CLIENT_ID, id.trim());
}

export const contaLembrada = () => localStorage.getItem(CHAVE_CONTA) || "";

function lerToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(CHAVE_TOKEN) || "null");
    // Margem de 1 minuto: não começa uma operação com o token quase vencendo.
    return t && t.expira > Date.now() + 60_000 ? t.valor : null;
  } catch {
    return null;
  }
}

export const temSessao = () => lerToken() != null;

export function sair() {
  const token = lerToken();
  sessionStorage.removeItem(CHAVE_TOKEN);
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
}

function carregarGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = ok;
    s.onerror = () => falha(new Error("Não foi possível carregar o login do Google. Confira a internet."));
    document.head.appendChild(s);
  });
}

/**
 * Abre a janela de autorização do Google. Deve ser chamado a partir de um clique (os navegadores
 * bloqueiam a janela fora de um gesto do usuário). A autorização dura cerca de 1 hora.
 */
export async function entrar() {
  await carregarGis();
  const token = await new Promise((ok, falha) => {
    const cliente = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: ESCOPO,
      hint: contaLembrada() || undefined,
      callback: (r) => (r.error ? falha(new Error(r.error_description || r.error)) : ok(r)),
      error_callback: (e) => falha(new Error(e.message || "Login cancelado.")),
    });
    cliente.requestAccessToken({ prompt: "" });
  });
  sessionStorage.setItem(
    CHAVE_TOKEN,
    JSON.stringify({ valor: token.access_token, expira: Date.now() + (token.expires_in || 3600) * 1000 })
  );
  try {
    const sobre = await json(`${API}/about?fields=user(emailAddress)`);
    localStorage.setItem(CHAVE_CONTA, sobre.user?.emailAddress || "");
  } catch {
    // O e-mail é só para exibir e facilitar o próximo login.
  }
}

async function requisitar(url, tentativa = 0) {
  const token = lerToken();
  if (!token) throw new SessaoExpirada();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    sessionStorage.removeItem(CHAVE_TOKEN);
    throw new SessaoExpirada();
  }
  // Limite de uso ou falha passageira do Drive: espera e tenta de novo.
  if ((r.status === 429 || r.status >= 500 || r.status === 403) && tentativa < 4) {
    const corpo = r.status === 403 ? await r.clone().text() : "";
    if (r.status !== 403 || /rateLimit|userRateLimit/i.test(corpo)) {
      await new Promise((ok) => setTimeout(ok, 600 * 2 ** tentativa + Math.random() * 300));
      return requisitar(url, tentativa + 1);
    }
  }
  if (!r.ok) throw new Error(`Google Drive respondeu ${r.status}`);
  return r;
}

const json = async (url) => (await requisitar(url)).json();

async function paginar(q, campos) {
  const itens = [];
  let pagina = "";
  do {
    const url =
      `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${campos})`)}` +
      `&pageSize=1000&spaces=drive${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`;
    const r = await json(url);
    itens.push(...(r.files || []));
    pagina = r.nextPageToken || "";
  } while (pagina);
  return itens;
}

/** Executa [tarefa] para cada item, no máximo [limite] por vez. */
export async function emParalelo(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const operario = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await tarefa(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, operario));
  return resultados;
}

/** Fonte de dados "Google Drive". A fonte de demonstração (demo.js) tem os mesmos métodos. */
export const drive = {
  nome: "drive",

  /** Pastas de relatórios: [{ id, nome, uuid, versao, jsonId }]. */
  async listarPastas() {
    const nome = NOME_PASTA_SYNC.replace(/'/g, "\\'");
    const raizes = await paginar(`mimeType='${MIME_PASTA}' and name='${nome}' and trashed=false`, "id");
    const listas = await emParalelo(raizes, 2, (raiz) =>
      paginar(`'${raiz.id}' in parents and trashed=false and mimeType='${MIME_PASTA}'`, "id,name,appProperties")
    );
    return listas
      .flat()
      .filter((p) => p.appProperties?.fr_uuid)
      .map((p) => ({
        id: p.id,
        nome: p.name,
        uuid: p.appProperties.fr_uuid,
        versao: p.appProperties.fr_versao || "",
        jsonId: p.appProperties.fr_json || "",
      }));
  },

  /** Dados do relatório (JSON gravado pelo app). */
  async lerJson(pasta) {
    let id = pasta.jsonId;
    if (!id) {
      const arquivos = await this.listarArquivos(pasta.id);
      const candidatos = arquivos
        .filter((a) => /^relatorio_\d+\.json$/.test(a.nome))
        .sort((a, b) => Number(b.nome.replace(/\D/g, "")) - Number(a.nome.replace(/\D/g, "")));
      if (!candidatos.length) throw new Error(`Pasta sem dados do relatório: ${pasta.nome}`);
      id = candidatos[0].id;
    }
    return json(`${API}/files/${id}?alt=media`);
  },

  /** Arquivos de uma pasta de relatório: [{ id, nome, miniatura }]. */
  async listarArquivos(pastaId) {
    const itens = await paginar(`'${pastaId}' in parents and trashed=false`, "id,name,thumbnailLink");
    return itens.map((a) => ({ id: a.id, nome: a.name, miniatura: a.thumbnailLink || "" }));
  },

  async baixar(arquivoId) {
    return (await requisitar(`${API}/files/${arquivoId}?alt=media`)).blob();
  },
};

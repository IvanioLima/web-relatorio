// Modelo de dados do site: relatórios lidos do Drive (com cache por versão), projetos derivados
// dos relatórios e numeração das vistorias.

import { emParalelo, SessaoExpirada } from "./drive.js";

const CHAVE_CACHE = "fr_cache_v1";

function lerCache() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CACHE) || "{}");
  } catch {
    return {};
  }
}

function gravarCache(cache) {
  try {
    localStorage.setItem(CHAVE_CACHE, JSON.stringify(cache));
  } catch {
    // Sem espaço no navegador: segue sem cache (só fica mais lento na próxima abertura).
    localStorage.removeItem(CHAVE_CACHE);
  }
}

export function limparCache() {
  localStorage.removeItem(CHAVE_CACHE);
}

const num = (v, padrao = 0) => (typeof v === "number" && isFinite(v) ? v : padrao);
const numOuNulo = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/** Converte o JSON do app para o formato usado no site (sem o que o site não usa, como os traços das marcações). */
function converter(pasta, bruto) {
  const r = bruto.relatorio || {};
  const projeto = r.projeto && r.projeto.uuid ? r.projeto : null;
  return {
    pastaId: pasta.id,
    uuid: r.uuid || pasta.uuid,
    versao: pasta.versao,
    titulo: r.titulo || "",
    subtitulo: r.subtitulo || "",
    equipeSetor: r.equipeSetor || "",
    dataCriacao: num(r.dataCriacao, Date.now()),
    dataAtualizacao: num(r.dataAtualizacao),
    status: r.status === "FINALIZADO" ? "FINALIZADO" : "RASCUNHO",
    tags: r.tags || "",
    criador: r.dispositivoCriador || "",
    projeto: projeto && {
      uuid: projeto.uuid,
      titulo: projeto.titulo || "",
      subtitulo: projeto.subtitulo || "",
      status: projeto.status === "FINALIZADO" ? "FINALIZADO" : "RASCUNHO",
      dataCriacao: num(projeto.dataCriacao),
      dataAtualizacao: num(projeto.dataAtualizacao),
    },
    fotos: (bruto.fotos || []).map((f) => ({
      uuid: f.uuid,
      legenda: f.legenda || "",
      dataHoraCaptura: num(f.dataHoraCaptura, Date.now()),
      temLocalizacao: !!f.temLocalizacao,
      latitude: num(f.latitude),
      longitude: num(f.longitude),
      utmZona: f.utmZona || "",
      utmEste: num(f.utmEste),
      utmNorte: num(f.utmNorte),
      altitude: numOuNulo(f.altitude),
      precisao: numOuNulo(f.precisao),
      status: f.status || null,
      oculta: !!f.ocultaNoRelatorio,
      // Nomes dos arquivos na pasta do relatório (ver Sincronizador.nomeOriginal / nomeAnotada).
      arquivoOriginal: `${f.uuid}_o${num(f.versaoOriginal)}.jpg`,
      arquivoAnotada: f.temAnotada ? `${f.uuid}_a${num(f.versaoAnotada)}.jpg` : null,
    })),
  };
}

/**
 * Lê todos os relatórios da fonte. Só baixa o JSON dos que mudaram desde a última vez
 * (compara a versão guardada nas propriedades da pasta).
 * @returns {{relatorios: object[], falhas: number}}
 */
export async function carregarRelatorios(fonte, aoProgredir = () => {}) {
  const pastas = await fonte.listarPastas();
  const usarCache = fonte.nome === "drive";
  const cache = usarCache ? lerCache() : {};
  const novo = {};
  let feitos = 0;
  let falhas = 0;
  const relatorios = await emParalelo(pastas, 6, async (pasta) => {
    let dados = null;
    const guardado = cache[pasta.id];
    if (guardado && guardado.versao === pasta.versao && pasta.versao) {
      dados = guardado.dados;
    } else {
      try {
        dados = converter(pasta, await fonte.lerJson(pasta));
      } catch (e) {
        if (e instanceof SessaoExpirada) throw e;
        falhas++;
      }
    }
    if (dados) novo[pasta.id] = { versao: pasta.versao, dados };
    aoProgredir(++feitos, pastas.length);
    return dados;
  });
  if (usarCache) gravarCache(novo);
  const lista = relatorios.filter(Boolean).sort((a, b) => b.dataCriacao - a.dataCriacao);
  numerarVistorias(lista);
  return { relatorios: lista, falhas };
}

/** Dentro de cada projeto, o relatório mais antigo é a Vistoria 1. Grava em r.vistoria. */
function numerarVistorias(relatorios) {
  const porProjeto = new Map();
  for (const r of relatorios) {
    r.vistoria = null;
    if (!r.projeto) continue;
    if (!porProjeto.has(r.projeto.uuid)) porProjeto.set(r.projeto.uuid, []);
    porProjeto.get(r.projeto.uuid).push(r);
  }
  for (const grupo of porProjeto.values()) {
    grupo.sort((a, b) => a.dataCriacao - b.dataCriacao || a.uuid.localeCompare(b.uuid));
    grupo.forEach((r, i) => (r.vistoria = i + 1));
  }
}

/**
 * Projetos derivados dos relatórios (cada relatório carrega os dados do seu projeto; vale a
 * cópia mais recente). Cada projeto traz seus relatórios na ordem das vistorias.
 */
export function listarProjetos(relatorios) {
  const mapa = new Map();
  for (const r of relatorios) {
    if (!r.projeto) continue;
    const atual = mapa.get(r.projeto.uuid);
    if (!atual) {
      mapa.set(r.projeto.uuid, { ...r.projeto, relatorios: [r] });
    } else {
      atual.relatorios.push(r);
      if (r.projeto.dataAtualizacao > atual.dataAtualizacao) Object.assign(atual, r.projeto);
    }
  }
  const projetos = [...mapa.values()];
  projetos.forEach((p) => p.relatorios.sort((a, b) => a.vistoria - b.vistoria));
  return projetos.sort((a, b) => b.dataCriacao - a.dataCriacao);
}

/** Fotos que entram nas exportações: todas, menos as marcadas como "não mostrar no relatório". */
export const fotosParaExportar = (relatorio) => relatorio.fotos.filter((f) => !f.oculta);

// Modelo de dados do site: relatórios lidos do Drive (pelo indice.json, com conferência de
// versão), projetos (dos relatórios e do projetos.json) e numeração das vistorias.

import { emParalelo, SessaoExpirada } from "./drive.js";

const CHAVE_CACHE_ANTIGO = "fr_cache_v1";
export const ARQ_INDICE = "indice.json";
export const ARQ_PROJETOS = "projetos.json";

/** Remove o cache das versões anteriores do site (que ficava no navegador). */
export function limparCache() {
  localStorage.removeItem(CHAVE_CACHE_ANTIGO);
}
limparCache();

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

/** Dados do relatório para o índice: como no JSON da pasta, sem os traços das marcações (o site não os usa). */
function entradaIndice(versao, bruto) {
  return {
    versao,
    relatorio: bruto.relatorio || {},
    fotos: (bruto.fotos || []).map(({ anotacoesJson, ...resto }) => resto),
  };
}

/**
 * Lê todos os relatórios. Primeiro o indice.json da raiz (gravado pelo app e por este site):
 * relatórios cuja versão no índice bate com a da pasta saem dali, sem baixar nada; só os
 * demais são lidos pasta por pasta. Se algo mudou, o índice é regravado (não é obrigatório:
 * se falhar, fica para a próxima vez).
 * @returns {{relatorios: object[], projetos: object[], falhas: number}}
 */
export async function carregarRelatorios(fonte, aoProgredir = () => {}) {
  const pastas = await fonte.listarPastas();
  const [indice, arquivoProjetos] = await Promise.all([
    lerOpcional(fonte, ARQ_INDICE),
    lerOpcional(fonte, ARQ_PROJETOS),
  ]);
  const anteriores = indice?.relatorios || {};
  const novo = {};
  let mudou = !indice;
  let feitos = 0;
  let falhas = 0;
  const relatorios = await emParalelo(pastas, 6, async (pasta) => {
    let entrada = anteriores[pasta.id];
    if (!entrada || !pasta.versao || entrada.versao !== pasta.versao) {
      try {
        entrada = entradaIndice(pasta.versao, await fonte.lerJson(pasta));
        mudou = true;
      } catch (e) {
        if (e instanceof SessaoExpirada) throw e;
        entrada = null;
        falhas++;
      }
    }
    aoProgredir(++feitos, pastas.length);
    if (!entrada) return null;
    novo[pasta.id] = entrada;
    return converter(pasta, entrada);
  });
  if (Object.keys(anteriores).some((id) => !novo[id])) mudou = true;
  if (mudou && Object.keys(novo).length) {
    try {
      await fonte.gravarArquivoRaiz(ARQ_INDICE, {
        formato: "fotorelatorio-indice",
        versao: 1,
        atualizadoEm: Date.now(),
        relatorios: novo,
      });
    } catch (e) {
      if (e instanceof SessaoExpirada) throw e;
      // O índice é só um atalho.
    }
  }
  const lista = relatorios.filter(Boolean).sort((a, b) => b.dataCriacao - a.dataCriacao);
  const registros = registrosDeProjetos(arquivoProjetos);
  // Projeto excluído (em algum aparelho) depois dos dados que o relatório carrega: relatório avulso.
  for (const r of lista) {
    const reg = r.projeto && registros.get(r.projeto.uuid);
    if (reg?.excluido && reg.dataAtualizacao >= r.projeto.dataAtualizacao) r.projeto = null;
  }
  numerarVistorias(lista);
  return { relatorios: lista, projetos: listarProjetos(lista, registros), registros, falhas };
}

async function lerOpcional(fonte, nome) {
  try {
    return await fonte.lerArquivoRaiz(nome);
  } catch (e) {
    if (e instanceof SessaoExpirada) throw e;
    return null;
  }
}

/** projetos.json → Map uuid → registro (inclusive as exclusões). */
function registrosDeProjetos(arquivo) {
  const mapa = new Map();
  for (const p of arquivo?.projetos || []) {
    if (!p?.uuid) continue;
    mapa.set(p.uuid, {
      uuid: p.uuid,
      titulo: p.titulo || "",
      subtitulo: p.subtitulo || "",
      status: p.status === "FINALIZADO" ? "FINALIZADO" : "RASCUNHO",
      dataCriacao: num(p.dataCriacao),
      dataAtualizacao: num(p.dataAtualizacao),
      excluido: !!p.excluido,
    });
  }
  return mapa;
}

/**
 * Grava no projetos.json os novos dados de um projeto (lê o arquivo de novo antes, para não
 * perder o que outro aparelho gravou nesse meio-tempo).
 */
export async function gravarProjeto(fonte, projeto) {
  const registros = registrosDeProjetos(await lerOpcional(fonte, ARQ_PROJETOS));
  const atual = registros.get(projeto.uuid);
  if (atual && atual.dataAtualizacao > projeto.dataAtualizacao) return;
  registros.set(projeto.uuid, { ...projeto, excluido: false });
  await fonte.gravarArquivoRaiz(ARQ_PROJETOS, {
    formato: "fotorelatorio-projetos",
    versao: 1,
    projetos: [...registros.values()].sort((a, b) => a.uuid.localeCompare(b.uuid)),
  });
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
export function listarProjetos(relatorios, registros = new Map()) {
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
  // projetos.json: projetos ainda sem relatórios, e dados mais novos que os dos relatórios.
  for (const reg of registros.values()) {
    if (reg.excluido) {
      if (mapa.get(reg.uuid)?.dataAtualizacao <= reg.dataAtualizacao) mapa.delete(reg.uuid);
      continue;
    }
    const atual = mapa.get(reg.uuid);
    if (!atual) mapa.set(reg.uuid, { ...reg, relatorios: [] });
    else if (reg.dataAtualizacao > atual.dataAtualizacao) Object.assign(atual, { ...reg, relatorios: atual.relatorios });
  }
  const projetos = [...mapa.values()];
  projetos.forEach((p) => p.relatorios.sort((a, b) => a.vistoria - b.vistoria));
  return projetos.sort((a, b) => b.dataCriacao - a.dataCriacao);
}

/** Fotos que entram nas exportações: todas, menos as marcadas como "não mostrar no relatório". */
export const fotosParaExportar = (relatorio) => relatorio.fotos.filter((f) => !f.oculta);

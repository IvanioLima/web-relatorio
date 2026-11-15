// Edição dos dados de um relatório pelo site. Segue o mesmo protocolo do app Android
// (backup/Sincronizador.kt), para o celular receber a mudança na próxima sincronização:
//
//   1. confere se a versão no Drive ainda é a que o site leu (senão, alguém editou depois);
//   2. baixa o JSON completo, aplica a mudança e grava um arquivo novo relatorio_<versão>.json;
//   3. troca as propriedades da pasta (versão + id do JSON) — o "ponto de virada".
//
// Só o JSON muda: os arquivos das fotos nunca são tocados. O JSON anterior fica na pasta
// (o app o remove no próximo envio), servindo de cópia de segurança.

const NOME_EDITOR = "FotoRelatório Web";

export class EditadoEmOutroLugar extends Error {
  constructor() {
    super("Este relatório foi alterado em outro aparelho depois que o site o leu. Toque em Atualizar e refaça a edição.");
  }
}

/** Valores das propriedades da pasta têm limite de tamanho (bytes). */
function cortar(texto, maxBytes = 100) {
  const enc = new TextEncoder();
  let t = texto || "";
  while (enc.encode(t).length > maxBytes) t = t.slice(0, -1);
  return t;
}

/**
 * Aplica [mudar] ao JSON do relatório e grava no Drive.
 * @param relatorio relatório como o site o leu (precisa de pastaId e versao)
 * @param mudar função (json) => void que altera json.relatorio / json.fotos
 */
export async function salvarRelatorio(fonte, relatorio, mudar) {
  const pasta = await fonte.lerPasta(relatorio.pastaId);
  if (pasta.versao !== relatorio.versao) throw new EditadoEmOutroLugar();

  const json = await fonte.lerJson({ id: relatorio.pastaId, nome: relatorio.titulo, jsonId: pasta.jsonId });
  if (!json?.relatorio || !Array.isArray(json.fotos)) throw new Error("Dados do relatório ilegíveis no Google Drive.");
  mudar(json);

  // A versão é a data da alteração; nunca menor ou igual à anterior.
  const versao = Math.max(Date.now(), Number(pasta.versao || 0) + 1);
  json.relatorio.dataAtualizacao = versao;
  json.relatorio.dispositivoEditor = NOME_EDITOR;

  const jsonId = await fonte.criarJson(relatorio.pastaId, `relatorio_${versao}.json`, JSON.stringify(json));
  await fonte.atualizarPasta(relatorio.pastaId, {
    fr_versao: String(versao),
    fr_json: jsonId,
    fr_titulo: cortar(json.relatorio.titulo),
    fr_fotos: String(json.fotos.length),
  });
}

const limpar = (t) => (t || "").trim();

/** Dados gerais do relatório. Num relatório de projeto, título e subtítulo não mudam por aqui. */
export function mudarDados({ titulo, subtitulo, equipeSetor, tags, concluido }) {
  return (json) => {
    const r = json.relatorio;
    if (!r.projeto) {
      r.titulo = limpar(titulo);
      r.subtitulo = limpar(subtitulo);
    }
    r.equipeSetor = limpar(equipeSetor) || null;
    r.tags = tags;
    r.status = concluido ? "FINALIZADO" : "RASCUNHO";
  };
}

/** Coloca o relatório no [projeto] (adotando título e subtítulo dele) ou, com nulo, tira do projeto. */
export function mudarProjeto(projeto) {
  return (json) => {
    const r = json.relatorio;
    if (!projeto) {
      r.projeto = null;
      return;
    }
    r.projeto = {
      uuid: projeto.uuid,
      titulo: projeto.titulo,
      subtitulo: projeto.subtitulo,
      status: projeto.status,
      dataCriacao: projeto.dataCriacao,
      dataAtualizacao: projeto.dataAtualizacao,
    };
    r.titulo = projeto.titulo;
    r.subtitulo = projeto.subtitulo;
  };
}

/** Novos dados do projeto dentro de um dos relatórios dele (o status acompanha, se mudou). */
export function mudarDadosDoProjeto(projeto, { titulo, subtitulo, concluido }, agora) {
  const status = concluido ? "FINALIZADO" : "RASCUNHO";
  return (json) => {
    const r = json.relatorio;
    r.projeto = { ...(r.projeto || {}), uuid: projeto.uuid, titulo, subtitulo, status, dataCriacao: projeto.dataCriacao, dataAtualizacao: agora };
    r.titulo = titulo;
    r.subtitulo = subtitulo;
    if (status !== projeto.status) r.status = status;
  };
}

function fotoDoJson(json, uuid) {
  const foto = json.fotos.find((f) => f.uuid === uuid);
  if (!foto) throw new Error("Esta foto não existe mais no relatório. Toque em Atualizar.");
  return foto;
}

export function mudarFoto(uuid, { legenda, status, oculta }) {
  return (json) => {
    const f = fotoDoJson(json, uuid);
    f.legenda = legenda;
    f.status = status || null;
    f.ocultaNoRelatorio = !!oculta;
  };
}

/** Move a foto uma posição para trás (-1) ou para a frente (+1) na sequência do relatório. */
export function moverFoto(uuid, direcao) {
  return (json) => {
    const de = json.fotos.indexOf(fotoDoJson(json, uuid));
    const para = de + direcao;
    if (para < 0 || para >= json.fotos.length) return;
    [json.fotos[de], json.fotos[para]] = [json.fotos[para], json.fotos[de]];
  };
}

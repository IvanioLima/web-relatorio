// PDF do relatório, com o mesmo desenho do app Android (export/PdfExporter.kt):
// cabeçalho (logo + linhas institucionais, ou imagem única) → título/subtítulo → rótulo →
// grade de fotos (imagem | linha | legenda + dados + selo de status) → rodapé.
// Fotos por página automáticas: 1 foto → 1, 2 → 2, 3 ou mais → 4 (2×2).

import { fotosParaExportar } from "./dados.js";
import { COR_STATUS, ROTULO_STATUS, dataLonga, linhasParaLegenda } from "./formato.js";
import { canvasFinal } from "./imagem.js";

const LARGURA = 595; // A4 em pontos
const ALTURA = 842;
const MARGEM = 24;
const BORDA = 1;
const SEPARADOR = 0.5;
const F_CABECALHO = 14;
const F_TITULO = 14;
const F_SUBTITULO = 14;
const F_ROTULO = 12;
const F_LEGENDA = 8;
const F_SELO = 7.5;
const F_RODAPE = 8;
const ALTURA_MAX_IMAGEM_CABECALHO = 130;
const ALTURA_RODAPE = 24;
const ESPACO_GRADE = 6;
const PAD_TEXTO = 4;
const ESPACO_LEGENDA_DADOS = 3;
const ALTURA_SELO = 12;
const FRACAO_MAX_LEGENDA = 0.4;
const COR_BORDA = "#B0BEC5";
const COR_RODAPE = "#424242";
const PIXELS_POR_PONTO = 3;

// Métricas da Liberation Sans (frações do tamanho da fonte), para posicionar como o Android.
const SUBIDA = 0.905;
const DESCIDA = 0.212;
const ENTRELINHA = 0.033;
const espacoLinha = (t) => (SUBIDA + DESCIDA + ENTRELINHA) * t;
/** Altura de linha dos textos de várias linhas (legenda e dados). */
const LINHA_LEGENDA = (SUBIDA + DESCIDA) * F_LEGENDA;
/** Folga que o Android acrescenta acima da primeira e abaixo da última linha. */
const FOLGA_TOPO = 0.6;
const FOLGA_BASE = 0.7;

const FONTE = "LiberationSans";
let fontes = null; // { regular, negrito } em base64, carregadas uma vez

async function ttfBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Não foi possível carregar a fonte (${url})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

async function novoDocumento() {
  if (!fontes) {
    const [regular, negrito] = await Promise.all([
      ttfBase64("fonts/LiberationSans-Regular.ttf"),
      ttfBase64("fonts/LiberationSans-Bold.ttf"),
    ]);
    fontes = { regular, negrito };
  }
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: [LARGURA, ALTURA], compress: true });
  doc.addFileToVFS("LiberationSans-Regular.ttf", fontes.regular);
  doc.addFont("LiberationSans-Regular.ttf", FONTE, "normal");
  doc.addFileToVFS("LiberationSans-Bold.ttf", fontes.negrito);
  doc.addFont("LiberationSans-Bold.ttf", FONTE, "bold");
  return doc;
}

const nfc = (t) => (t || "").normalize("NFC");

function fonte(doc, tamanho, negrito = false, cor = "#000000") {
  doc.setFont(FONTE, negrito ? "bold" : "normal");
  doc.setFontSize(tamanho);
  doc.setTextColor(cor);
}

/** Texto centralizado em [centroX]; reduz a fonte só se não couber em [larguraMax]. */
function textoCentralizado(doc, texto, centroX, base, larguraMax, tamanho, negrito) {
  const t = nfc(texto);
  fonte(doc, tamanho, negrito);
  const largura = doc.getTextWidth(t);
  if (largura > larguraMax && largura > 0) doc.setFontSize((tamanho * larguraMax) / largura);
  doc.text(t, centroX, base, { align: "center" });
}

function carregarImagem(dataUrl) {
  return new Promise((ok) => {
    if (!dataUrl) return ok(null);
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = dataUrl;
  });
}

/** Encaixa a imagem no retângulo sem distorcer; centralizada ou apoiada na base. */
function desenharAjustada(doc, imagem, largura, altura, r, naBase = false, formato = "PNG") {
  const escala = Math.min(r.w / largura, r.h / altura);
  const w = largura * escala;
  const h = altura * escala;
  const x = r.x + (r.w - w) / 2;
  const y = naBase ? r.y + r.h - h : r.y + (r.h - h) / 2;
  doc.addImage(imagem, formato, x, y, w, h, undefined, "FAST");
}

function retanguloImagemCabecalho(img, yTopo) {
  const util = LARGURA - 2 * MARGEM;
  let w = util;
  let h = (w * img.height) / Math.max(1, img.width);
  if (h > ALTURA_MAX_IMAGEM_CABECALHO) {
    w *= ALTURA_MAX_IMAGEM_CABECALHO / h;
    h = ALTURA_MAX_IMAGEM_CABECALHO;
  }
  return { x: MARGEM + (util - w) / 2, y: yTopo, w, h };
}

const linhasInstitucionais = (cfg) => [cfg.linha1, cfg.linha2, cfg.linha3].filter((l) => l && l.trim());

/** Quebra o texto em linhas que cabem em [largura] (respeitando as quebras do próprio texto). */
function quebrar(doc, texto, largura) {
  fonte(doc, F_LEGENDA);
  return nfc(texto)
    .split("\n")
    .flatMap((paragrafo) => (paragrafo ? doc.splitTextToSize(paragrafo, largura) : [""]));
}

const alturaBloco = (linhas) => (linhas.length ? linhas.length * LINHA_LEGENDA + FOLGA_TOPO + FOLGA_BASE : 0);

function prepararTextos(doc, foto, cfg, largura) {
  const legenda = foto.legenda.trim();
  const dados = linhasParaLegenda(foto, cfg);
  return {
    legenda: legenda ? quebrar(doc, legenda, largura) : [],
    dados: dados.length ? quebrar(doc, dados.join("\n"), largura) : [],
    status: ROTULO_STATUS[foto.status] ? foto.status : null,
  };
}

function alturaNecessaria(t) {
  const hTexto =
    alturaBloco(t.legenda) + alturaBloco(t.dados) + (t.legenda.length && t.dados.length ? ESPACO_LEGENDA_DADOS : 0);
  let h = 0;
  if (hTexto > 0) h += hTexto + 2 * PAD_TEXTO;
  if (t.status) h += ALTURA_SELO + PAD_TEXTO + (hTexto > 0 ? 0 : PAD_TEXTO);
  return h;
}

export const fotosPorPagina = (total) => (total <= 1 ? 1 : total === 2 ? 2 : 4);

function calcularMoldura(doc, secao, cfg, imgCabecalho, porPagina) {
  const util = LARGURA - 2 * MARGEM;
  const alturaCabecalho = imgCabecalho
    ? retanguloImagemCabecalho(imgCabecalho, MARGEM).h
    : Math.max(64, linhasInstitucionais(cfg).length * espacoLinha(F_CABECALHO) + 12);
  const alturaTitulo = secao.subtitulo.trim()
    ? espacoLinha(F_TITULO) + espacoLinha(F_SUBTITULO) + 12
    : espacoLinha(F_TITULO) + 14;
  const alturaRotulo = espacoLinha(F_ROTULO) + 8;
  const aposCabecalho = imgCabecalho ? 4 : 0;
  const yTopoGrade = MARGEM + alturaCabecalho + aposCabecalho + alturaTitulo + alturaRotulo + 4;
  const yBaseGrade = ALTURA - MARGEM - ALTURA_RODAPE - 4;
  const [colunas, linhas] = porPagina === 1 ? [1, 1] : porPagina === 2 ? [1, 2] : [2, 2];
  const larguraCelula = (util - (colunas - 1) * ESPACO_GRADE) / colunas;
  const alturaCelula = (yBaseGrade - yTopoGrade - (linhas - 1) * ESPACO_GRADE) / linhas;
  // Altura fixa da legenda: a maior necessária entre todas as fotos da seção.
  const larguraTexto = Math.max(1, larguraCelula - 2 * PAD_TEXTO);
  const maior = Math.max(0, ...secao.fotos.map((f) => alturaNecessaria(prepararTextos(doc, f, cfg, larguraTexto))));
  return {
    alturaCabecalho,
    alturaTitulo,
    alturaRotulo,
    yTopoGrade,
    colunas,
    linhas,
    larguraCelula,
    alturaCelula,
    alturaLegenda: Math.min(maior, alturaCelula * FRACAO_MAX_LEGENDA),
  };
}

function seloStatus(doc, status, centroX, base) {
  const texto = nfc(ROTULO_STATUS[status].toUpperCase());
  fonte(doc, F_SELO, true, "#FFFFFF");
  const largura = doc.getTextWidth(texto) + 12;
  doc.setFillColor(COR_STATUS[status]);
  doc.roundedRect(centroX - largura / 2, base - ALTURA_SELO, largura, ALTURA_SELO, 3, 3, "F");
  doc.text(texto, centroX, base - 3.5, { align: "center" });
}

async function desenharCelula(doc, fonteDados, secao, foto, cfg, r, alturaLegenda) {
  doc.setDrawColor(COR_BORDA);
  doc.setLineWidth(BORDA);
  doc.rect(r.x, r.y, r.w, r.h);

  const larguraTexto = Math.max(1, r.w - 2 * PAD_TEXTO);
  const textos = prepararTextos(doc, foto, cfg, larguraTexto);
  const yDivisa = r.y + r.h - alturaLegenda;
  const area = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: yDivisa - 2 - (r.y + 2) };

  try {
    const canvas = await canvasFinal(
      fonteDados,
      secao.relatorioDe(foto),
      foto,
      cfg,
      Math.max(1, Math.floor(area.w * PIXELS_POR_PONTO)),
      Math.max(1, Math.floor(area.h * PIXELS_POR_PONTO))
    );
    desenharAjustada(doc, canvas.toDataURL("image/jpeg", 0.85), canvas.width, canvas.height, area, true, "JPEG");
  } catch {
    // Foto ilegível ou ausente no Drive: a área fica em branco, sem interromper a exportação.
    secao.falhas.push(foto);
  }

  if (alturaLegenda > 0) {
    doc.setDrawColor(COR_BORDA);
    doc.setLineWidth(SEPARADOR);
    doc.line(r.x, yDivisa, r.x + r.w, yDivisa);
  }

  if (textos.legenda.length || textos.dados.length) {
    const topo = yDivisa + PAD_TEXTO;
    const fundo = r.y + r.h - (textos.status ? ALTURA_SELO + PAD_TEXTO : PAD_TEXTO);
    fonte(doc, F_LEGENDA);
    let y = topo;
    // Linhas que passariam do fundo da área são cortadas (como o recorte feito no app).
    const escrever = (linhas) => {
      if (!linhas.length) return;
      y += FOLGA_TOPO;
      for (const linha of linhas) {
        if (y + LINHA_LEGENDA > fundo + 0.5) return;
        doc.text(linha, r.x + PAD_TEXTO, y + SUBIDA * F_LEGENDA);
        y += LINHA_LEGENDA;
      }
      y += FOLGA_BASE;
    };
    escrever(textos.legenda);
    if (textos.legenda.length && textos.dados.length) y += ESPACO_LEGENDA_DADOS;
    escrever(textos.dados);
  }

  if (textos.status) seloStatus(doc, textos.status, r.x + r.w / 2, r.y + r.h - PAD_TEXTO);
}

async function desenharPagina(doc, fonteDados, secao, fotos, cfg, logo, imgCabecalho, numero, total, m) {
  const centroX = LARGURA / 2;
  const direita = LARGURA - MARGEM;
  let y = MARGEM;
  doc.setDrawColor(COR_BORDA);
  doc.setLineWidth(BORDA);

  // Cabeçalho
  if (imgCabecalho) {
    desenharAjustada(doc, imgCabecalho, imgCabecalho.width, imgCabecalho.height, retanguloImagemCabecalho(imgCabecalho, y));
    y += m.alturaCabecalho + 4;
  } else {
    const altura = m.alturaCabecalho;
    doc.rect(MARGEM, y, direita - MARGEM, altura);
    let esquerda = MARGEM + 8;
    if (logo) {
      const rl = { x: MARGEM + 6, y: y + 6, w: 96, h: altura - 12 };
      desenharAjustada(doc, logo, logo.width, logo.height, rl);
      doc.line(rl.x + rl.w + 8, y + 4, rl.x + rl.w + 8, y + altura - 4);
      esquerda = rl.x + rl.w + 16;
    }
    const fim = direita - 8;
    const linhas = linhasInstitucionais(cfg);
    const hLinha = espacoLinha(F_CABECALHO);
    let base = y + (altura - hLinha * linhas.length) / 2 + SUBIDA * F_CABECALHO;
    for (const linha of linhas) {
      textoCentralizado(doc, linha, (esquerda + fim) / 2, base, fim - esquerda, F_CABECALHO, true);
      base += hLinha;
    }
    y += altura;
  }

  // Título / subtítulo. Com cabeçalho de imagem única, título e rótulo ficam sem contorno.
  const larguraMax = LARGURA - 2 * MARGEM - 16;
  const contornar = !imgCabecalho;
  if (contornar) doc.rect(MARGEM, y, direita - MARGEM, m.alturaTitulo);
  const spT = espacoLinha(F_TITULO);
  if (secao.subtitulo.trim()) {
    const yTexto = y + (m.alturaTitulo - (spT + espacoLinha(F_SUBTITULO))) / 2;
    textoCentralizado(doc, secao.titulo, centroX, yTexto + SUBIDA * F_TITULO, larguraMax, F_TITULO, true);
    textoCentralizado(doc, secao.subtitulo, centroX, yTexto + spT + SUBIDA * F_SUBTITULO, larguraMax, F_SUBTITULO, false);
  } else {
    const yTexto = y + (m.alturaTitulo - spT) / 2;
    textoCentralizado(doc, secao.titulo, centroX, yTexto + SUBIDA * F_TITULO, larguraMax, F_TITULO, true);
  }
  y += m.alturaTitulo;

  // Rótulo do tipo de documento
  doc.setDrawColor(COR_BORDA);
  doc.setLineWidth(BORDA);
  if (contornar) doc.rect(MARGEM, y, direita - MARGEM, m.alturaRotulo);
  const baseRotulo = y + (m.alturaRotulo - espacoLinha(F_ROTULO)) / 2 + SUBIDA * F_ROTULO;
  textoCentralizado(doc, secao.rotulo, centroX, baseRotulo, larguraMax, F_ROTULO, true);

  // Grade de fotos
  const visiveis = fotos.slice(0, m.colunas * m.linhas);
  for (let i = 0; i < visiveis.length; i++) {
    const coluna = i % m.colunas;
    const linha = Math.floor(i / m.colunas);
    const r = {
      x: MARGEM + coluna * (m.larguraCelula + ESPACO_GRADE),
      y: m.yTopoGrade + linha * (m.alturaCelula + ESPACO_GRADE),
      w: m.larguraCelula,
      h: m.alturaCelula,
    };
    await desenharCelula(doc, fonteDados, secao, visiveis[i], cfg, r, m.alturaLegenda);
  }

  // Rodapé
  const yRodape = ALTURA - MARGEM - ALTURA_RODAPE;
  doc.setDrawColor(COR_BORDA);
  doc.setLineWidth(BORDA);
  doc.line(MARGEM, yRodape, direita, yRodape);
  fonte(doc, F_RODAPE, false, COR_RODAPE);
  const yTexto = yRodape + 15;
  doc.text(dataLonga(secao.dataRodape), MARGEM, yTexto);
  if (secao.equipeSetor.trim()) doc.text(nfc(secao.equipeSetor), centroX, yTexto, { align: "center" });
  doc.text(`Página ${numero} de ${total}`, direita, yTexto, { align: "right" });
}

/** Desenha as seções em sequência (cada uma começa em página nova) e devolve o PDF como Blob. */
async function escrever(fonteDados, secoes, cfg, aoProgredir) {
  const doc = await novoDocumento();
  const imgCabecalho = cfg.cabecalhoComImagem ? await carregarImagem(cfg.imagemCabecalho) : null;
  const logo = imgCabecalho ? null : await carregarImagem(cfg.logo);

  const paginas = secoes.map((s) => {
    const porPagina = fotosPorPagina(s.fotos.length);
    const grupos = [];
    for (let i = 0; i < s.fotos.length; i += porPagina) grupos.push(s.fotos.slice(i, i + porPagina));
    return { porPagina, grupos: grupos.length ? grupos : [[]] };
  });
  const total = paginas.reduce((n, p) => n + p.grupos.length, 0);

  let numero = 0;
  for (let i = 0; i < secoes.length; i++) {
    const moldura = calcularMoldura(doc, secoes[i], cfg, imgCabecalho, paginas[i].porPagina);
    for (const grupo of paginas[i].grupos) {
      if (numero > 0) doc.addPage([LARGURA, ALTURA]);
      numero++;
      aoProgredir(numero, total);
      await desenharPagina(doc, fonteDados, secoes[i], grupo, cfg, logo, imgCabecalho, numero, total, moldura);
    }
  }
  return doc.output("blob");
}

const equipeDe = (relatorio, cfg) => relatorio.equipeSetor.trim() || cfg.equipeSetorPadrao;

/** @returns {{blob: Blob, falhas: number}} falhas = fotos que não puderam ser lidas (ficam em branco). */
export async function gerarPdf(fonteDados, relatorio, cfg, aoProgredir = () => {}) {
  const secao = {
    titulo: relatorio.titulo,
    subtitulo: relatorio.subtitulo,
    rotulo: "RELATÓRIO FOTOGRÁFICO",
    fotos: fotosParaExportar(relatorio),
    equipeSetor: equipeDe(relatorio, cfg),
    dataRodape: relatorio.dataCriacao,
    relatorioDe: () => relatorio,
    falhas: [],
  };
  const blob = await escrever(fonteDados, [secao], cfg, aoProgredir);
  return { blob, falhas: secao.falhas.length };
}

/**
 * Relatório compilado do projeto: os relatórios em sequência (da vistoria mais antiga para a
 * mais nova), numeração de páginas contínua e a data da exportação no rodapé.
 */
export async function gerarPdfCompilado(fonteDados, projeto, relatorios, cfg, dataExportacao, aoProgredir = () => {}) {
  // Vistorias sem fotos não geram página (salvo se nenhuma tiver fotos: sai uma página vazia).
  let usados = relatorios.filter((r) => fotosParaExportar(r).length);
  if (!usados.length) usados = relatorios.slice(0, 1);
  const falhas = [];
  const secoes = usados.map((r) => ({
    titulo: projeto.titulo,
    subtitulo: projeto.subtitulo,
    rotulo: `RELATÓRIO FOTOGRÁFICO – VISTORIA ${r.vistoria}`,
    fotos: fotosParaExportar(r),
    equipeSetor: equipeDe(r, cfg),
    dataRodape: dataExportacao,
    relatorioDe: () => r,
    falhas,
  }));
  const blob = await escrever(fonteDados, secoes, cfg, aoProgredir);
  return { blob, falhas: falhas.length };
}

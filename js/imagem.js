// Fotos: download (com cache em memória), versão final para exportação (com marcações e, se
// configurado, data/hora/coordenadas impressas) e miniaturas.

import { linhasParaFoto } from "./formato.js";

const MAX_BLOBS = 40;
const blobs = new Map(); // id do arquivo -> Promise<Blob> (ordem de inserção = mais antigo primeiro)
const indices = new Map(); // id da pasta -> Promise<Map<nome, {id, miniatura}>>

export function limparCacheDeFotos() {
  blobs.clear();
  indices.clear();
}

/** Arquivos da pasta do relatório, por nome. */
export function indiceDaPasta(fonte, pastaId) {
  if (!indices.has(pastaId)) {
    const p = fonte.listarArquivos(pastaId).then((lista) => new Map(lista.map((a) => [a.nome, a])));
    p.catch(() => indices.delete(pastaId));
    indices.set(pastaId, p);
  }
  return indices.get(pastaId);
}

/** Arquivo que representa a foto: a versão com marcações, se existir; senão, a original. Nulo se não está no Drive. */
export async function arquivoDaFoto(fonte, relatorio, foto) {
  const indice = await indiceDaPasta(fonte, relatorio.pastaId);
  return (foto.arquivoAnotada && indice.get(foto.arquivoAnotada)) || indice.get(foto.arquivoOriginal) || null;
}

function baixar(fonte, arquivoId) {
  if (blobs.has(arquivoId)) {
    const p = blobs.get(arquivoId);
    blobs.delete(arquivoId);
    blobs.set(arquivoId, p);
    return p;
  }
  const p = fonte.baixar(arquivoId);
  p.catch(() => blobs.delete(arquivoId));
  blobs.set(arquivoId, p);
  while (blobs.size > MAX_BLOBS) blobs.delete(blobs.keys().next().value);
  return p;
}

/** Bytes da foto como estão no Drive (JPEG com os metadados EXIF originais). */
export async function blobDaFoto(fonte, relatorio, foto) {
  const arquivo = await arquivoDaFoto(fonte, relatorio, foto);
  if (!arquivo) throw new Error("Foto não encontrada no Google Drive");
  return baixar(fonte, arquivo.id);
}

/** Decodifica já na orientação correta (as originais guardam a rotação no EXIF). */
function decodificar(blob) {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/**
 * Desenha as linhas (marca d'água, data/hora, coordenadas) no canto inferior direito, como o
 * app faz (ImageUtils.desenharInfoSobreFoto): amarelo com sombra, 3% do menor lado × escala.
 */
function desenharInfo(ctx, w, h, linhas, escalaFoto, pct) {
  if (!linhas.length) return;
  const menor = Math.min(w, h);
  const margem = menor * 0.025;
  let tamanho = menor * 0.03 * Math.min(3, Math.max(0.5, pct / 100));
  const fonte = (t) => `${t}px Roboto, "Liberation Sans", Arial, sans-serif`;
  ctx.font = fonte(tamanho);
  const maior = Math.max(...linhas.map((l) => ctx.measureText(l).width));
  const disponivel = w - 2 * margem;
  if (maior > disponivel) tamanho *= disponivel / maior;
  ctx.font = fonte(tamanho);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFEB3B";
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = Math.max(2 * escalaFoto, tamanho * 0.12);
  ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(1, escalaFoto);
  const entrelinha = tamanho * 1.3;
  let y = h - margem - (linhas.length - 1) * entrelinha;
  for (const linha of linhas) {
    ctx.fillText(linha.normalize("NFC"), w - margem, y);
    y += entrelinha;
  }
  ctx.shadowColor = "transparent";
}

/**
 * Foto pronta para exportação num canvas: com marcações e, conforme as configurações, o texto
 * impresso. [maxLargura]/[maxAltura] reduzem a imagem (mantendo a proporção) para caber.
 */
export async function canvasFinal(fonte, relatorio, foto, cfg, maxLargura = Infinity, maxAltura = Infinity) {
  const bitmap = await decodificar(await blobDaFoto(fonte, relatorio, foto));
  const escala = Math.min(1, maxLargura / bitmap.width, maxAltura / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  desenharInfo(ctx, canvas.width, canvas.height, linhasParaFoto(foto, cfg), escala, cfg.tamanhoFonteFotoPct);
  return canvas;
}

export function canvasParaBlob(canvas, qualidade = 0.92) {
  return new Promise((ok, falha) =>
    canvas.toBlob((b) => (b ? ok(b) : falha(new Error("Não foi possível gerar a imagem"))), "image/jpeg", qualidade)
  );
}

/**
 * JPEG final da foto para compartilhar. Sem texto a imprimir, devolve os bytes do Drive como
 * estão (mantém os metadados EXIF da foto); com texto, a imagem é regravada (sem EXIF).
 */
export async function jpegFinal(fonte, relatorio, foto, cfg) {
  if (!linhasParaFoto(foto, cfg).length) return blobDaFoto(fonte, relatorio, foto);
  return canvasParaBlob(await canvasFinal(fonte, relatorio, foto, cfg));
}

/** URL de uma miniatura (até [lado] px) para a grade de fotos. Quem chama deve liberar com URL.revokeObjectURL. */
export async function urlMiniatura(fonte, relatorio, foto, lado = 480) {
  const bitmap = await decodificar(await blobDaFoto(fonte, relatorio, foto));
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return URL.createObjectURL(await canvasParaBlob(canvas, 0.8));
}

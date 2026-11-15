// Configurações do relatório (cabeçalho, rodapé, o que aparece na legenda e sobre a foto).
// No app Android elas ficam só no celular — não vão para o Drive —, então o site tem as suas,
// guardadas neste navegador.

const CHAVE = "fr_config_v1";

export const PADRAO = {
  cabecalhoComImagem: false,
  /** Imagens como data URL (já reduzidas), ou "" se não houver. */
  imagemCabecalho: "",
  logo: "",
  linha1: "",
  linha2: "",
  linha3: "",
  equipeSetorPadrao: "",
  /** "UTM" ou "GRAUS_DECIMAIS". */
  formatoCoordenada: "UTM",
  mostrarDataNaLegenda: true,
  mostrarHoraNaLegenda: true,
  mostrarCoordenadasNaLegenda: true,
  mostrarDataNaFoto: true,
  mostrarHoraNaFoto: true,
  mostrarCoordenadasNaFoto: true,
  textoMarcaDagua: "",
  /** Tamanho do texto impresso na foto, em % do padrão (50 a 300). */
  tamanhoFonteFotoPct: 100,
};

export function lerConfig() {
  try {
    return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE) || "{}") };
  } catch {
    return { ...PADRAO };
  }
}

/** @returns false se não coube no armazenamento do navegador (imagem grande demais). */
export function salvarConfig(cfg) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

/** Lê um arquivo de imagem e devolve um data URL PNG com no máximo [larguraMax] px de largura. */
export async function imagemParaDataUrl(arquivo, larguraMax) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, larguraMax / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/png");
}

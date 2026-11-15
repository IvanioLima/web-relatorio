// Datas, coordenadas e textos de legenda / marca d'água — mesmas regras do app Android
// (util/InfoFormatter.kt e util/DateUtils.kt).

const p2 = (n) => String(n).padStart(2, "0");

export function dataCurta(ms) {
  const d = new Date(ms);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${p2(d.getFullYear() % 100)}`;
}

export function hora(ms) {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export function dataLonga(ms) {
  const d = new Date(ms);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** AAAAMMDD_HHMMSS — começo do nome dos arquivos exportados. */
export function carimbo(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

export function tituloLimpo(titulo) {
  const t = (titulo || "")
    .trim()
    .replace(/[^A-Za-z0-9À-ÿ ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  return t || "relatorio";
}

/** Nome (sem extensão) dos arquivos de um relatório: data de criação + título. */
export const nomeBaseRelatorio = (r) => `${carimbo(r.dataCriacao)}_${tituloLimpo(r.titulo)}`;

/** Nome (sem extensão) do compilado de um projeto: data da exportação + título. */
export const nomeBaseProjeto = (projeto, agora) => `${carimbo(agora)}_${tituloLimpo(projeto.titulo)}`;

export const ROTULO_STATUS = {
  CONFORME: "Conforme",
  NAO_CONFORME: "Não conforme",
  NA: "N/A",
  PENDENTE: "Pendente",
};

export const COR_STATUS = {
  CONFORME: "#2E7D32",
  NAO_CONFORME: "#C62828",
  NA: "#757575",
  PENDENTE: "#EF6C00",
};

/** UTM em metros inteiros (ex.: "23L 186213 8253371"); Lat/Lon com 6 casas. Nulo se a foto não tem localização. */
export function textoCoordenadas(foto, formato, comRotuloUtm = false) {
  if (!foto.temLocalizacao) return null;
  if (formato === "UTM" && foto.utmZona) {
    const t = `${foto.utmZona} ${foto.utmEste.toFixed(0)} ${foto.utmNorte.toFixed(0)}`;
    return comRotuloUtm ? `UTM: ${t}` : t;
  }
  return `Lat/Lon: ${foto.latitude.toFixed(6)}, ${foto.longitude.toFixed(6)}`;
}

function dataEHora(foto, mostrarData, mostrarHora, separador) {
  const partes = [];
  if (mostrarData) partes.push(dataCurta(foto.dataHoraCaptura));
  if (mostrarHora) partes.push(hora(foto.dataHoraCaptura));
  return partes.length ? partes.join(separador) : null;
}

/** Linhas de dados abaixo da legenda (data | hora; coordenada | altitude | precisão). */
export function linhasParaLegenda(foto, cfg) {
  const linhas = [];
  const dh = dataEHora(foto, cfg.mostrarDataNaLegenda, cfg.mostrarHoraNaLegenda, " | ");
  if (dh) linhas.push(dh);
  if (cfg.mostrarCoordenadasNaLegenda) {
    const coord = textoCoordenadas(foto, cfg.formatoCoordenada);
    if (coord) {
      const partes = [coord];
      if (foto.altitude != null) partes.push(`Alt. ${foto.altitude.toFixed(0)} m`);
      if (foto.precisao != null) partes.push(`Precisão ±${foto.precisao.toFixed(0)} m`);
      linhas.push(partes.join(" | "));
    }
  }
  return linhas;
}

/** Linhas impressas sobre a própria foto (marca d'água, data/hora, coordenada). */
export function linhasParaFoto(foto, cfg) {
  const linhas = (cfg.textoMarcaDagua || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const dh = dataEHora(foto, cfg.mostrarDataNaFoto, cfg.mostrarHoraNaFoto, " ");
  if (dh) linhas.push(dh);
  if (cfg.mostrarCoordenadasNaFoto) {
    const coord = textoCoordenadas(foto, cfg.formatoCoordenada);
    if (coord) linhas.push(coord);
  }
  return linhas;
}

export function tags(texto) {
  const vistas = new Set();
  return (texto || "")
    .split(",")
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t && !vistas.has(normalizar(t)) && vistas.add(normalizar(t)));
}

/** Minúsculas e sem acentos — para comparar e buscar. */
export function normalizar(texto) {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

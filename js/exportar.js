// Exportações que são arquivos .zip: fotos (.zip com as imagens) e KMZ (Google Earth).
// Mesmas regras do app Android (export/FotosExporter.kt e export/KmzExporter.kt).

import { fotosParaExportar } from "./dados.js";
import { ROTULO_STATUS, carimbo, dataCurta, hora, textoCoordenadas, tituloLimpo } from "./formato.js";
import { canvasFinal, canvasParaBlob, jpegFinal } from "./imagem.js";

function nomeUnico(base, usados) {
  let nome = base;
  let n = 2;
  while (usados.has(nome.toLowerCase())) nome = `${base}_${n++}`;
  usados.add(nome.toLowerCase());
  return nome;
}

/**
 * .zip com as fotos (JPG com marcações e, conforme as configurações, o texto impresso).
 * @param grupos [{ relatorio, pasta }] — pasta "" = fotos na raiz do .zip; senão, uma pasta por grupo.
 * @returns {{blob: Blob, falhas: number}}
 */
export async function gerarZipDeFotos(fonte, grupos, cfg, aoProgredir = () => {}) {
  const zip = new window.JSZip();
  const total = grupos.reduce((n, g) => n + fotosParaExportar(g.relatorio).length, 0);
  let feitas = 0;
  let gravadas = 0;
  for (const { relatorio, pasta } of grupos) {
    const usados = new Set();
    const titulo = tituloLimpo(relatorio.titulo);
    for (const foto of fotosParaExportar(relatorio)) {
      aoProgredir(++feitas, total);
      try {
        const blob = await jpegFinal(fonte, relatorio, foto, cfg);
        const nome = nomeUnico(`${carimbo(foto.dataHoraCaptura)}_${titulo}`, usados);
        zip.file(`${pasta ? pasta + "/" : ""}${nome}.jpg`, blob, { compression: "STORE" });
        gravadas++;
      } catch {
        // Foto ilegível ou ausente no Drive: pula e continua com as demais.
      }
    }
  }
  if (!gravadas) throw new Error("Nenhuma foto para exportar");
  return { blob: await zip.generateAsync({ type: "blob" }), falhas: total - gravadas };
}

const escXml = (t) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const cdata = (t) => String(t ?? "").replace(/]]>/g, "]] >");

function placemark(foto, cfg, indice, nomeImagem) {
  const legenda = foto.legenda.trim() ? foto.legenda : "(sem legenda)";
  const dataHora = `${dataCurta(foto.dataHoraCaptura)} ${hora(foto.dataHoraCaptura)}`;
  const coordenadas = textoCoordenadas(foto, cfg.formatoCoordenada, true);
  const status = ROTULO_STATUS[foto.status] || null;
  const nomeBase = foto.legenda.trim().replace(/\s+/g, " ") || `Foto ${indice + 1}`;
  const nome = nomeBase + (foto.temLocalizacao ? "" : " (sem localização)");

  let descricao = "";
  if (nomeImagem) descricao += `<img src="files/${nomeImagem}" width="400"/><br/>`;
  descricao += `<b>Legenda:</b> ${cdata(legenda)}<br/>`;
  descricao += `<b>Data/hora:</b> ${cdata(dataHora)}<br/>`;
  if (coordenadas) {
    descricao += `<b>Coordenadas:</b> ${cdata(coordenadas)}<br/>`;
    if (foto.altitude != null) descricao += `<b>Altitude:</b> ${foto.altitude.toFixed(0)} m<br/>`;
    if (foto.precisao != null) descricao += `<b>Precisão do GPS:</b> ±${foto.precisao.toFixed(0)} m<br/>`;
  }
  if (status) descricao += `<b>Status:</b> ${cdata(status)}<br/>`;

  let dados = `<ExtendedData>\n<Data name="legenda"><value>${escXml(legenda)}</value></Data>\n`;
  dados += `<Data name="data_hora"><value>${escXml(dataHora)}</value></Data>\n`;
  if (foto.temLocalizacao) {
    dados += `<Data name="latitude"><value>${foto.latitude.toFixed(6)}</value></Data>\n`;
    dados += `<Data name="longitude"><value>${foto.longitude.toFixed(6)}</value></Data>\n`;
    if (foto.utmZona) {
      dados += `<Data name="utm"><value>${escXml(`${foto.utmZona} ${foto.utmEste.toFixed(2)} ${foto.utmNorte.toFixed(2)}`)}</value></Data>\n`;
    }
  }
  if (status) dados += `<Data name="status"><value>${escXml(status)}</value></Data>\n`;
  dados += "</ExtendedData>";

  const ponto = foto.temLocalizacao
    ? `<Point><coordinates>${foto.longitude.toFixed(8)},${foto.latitude.toFixed(8)},0</coordinates></Point>`
    : "";
  return `<Placemark>\n<name>${escXml(nome)}</name>\n<styleUrl>#estiloFoto</styleUrl>\n<description><![CDATA[${descricao}]]></description>\n${dados}\n${ponto}\n</Placemark>`;
}

/**
 * KMZ com um marcador por foto (imagem embutida e tabela de dados).
 * @param grupos [{ relatorio, pasta }] — pasta "" = marcadores soltos; senão, uma pasta no mapa por grupo.
 * @returns {{blob: Blob, falhas: number}}
 */
export async function gerarKmz(fonte, titulo, descricao, grupos, cfg, aoProgredir = () => {}) {
  const zip = new window.JSZip();
  const total = grupos.reduce((n, g) => n + fotosParaExportar(g.relatorio).length, 0);
  let numero = 0;
  let falhas = 0;
  const blocos = [];
  for (const { relatorio, pasta } of grupos) {
    const marcadores = [];
    const fotos = fotosParaExportar(relatorio);
    for (let i = 0; i < fotos.length; i++) {
      aoProgredir(++numero, total);
      let nomeImagem = null;
      try {
        const canvas = await canvasFinal(fonte, relatorio, fotos[i], cfg, 1000, 1000);
        nomeImagem = `foto${numero}.jpg`;
        zip.file(`files/${nomeImagem}`, await canvasParaBlob(canvas, 0.85), { compression: "STORE" });
      } catch {
        nomeImagem = null;
        falhas++;
      }
      marcadores.push(placemark(fotos[i], cfg, i, nomeImagem));
    }
    const texto = marcadores.join("\n");
    blocos.push(pasta ? `<Folder>\n<name>${escXml(pasta)}</name>\n${texto}\n</Folder>` : texto);
  }
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${escXml(titulo)}</name>
<description>${escXml(descricao)}</description>
<Style id="estiloFoto">
<IconStyle>
<Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon>
</IconStyle>
</Style>
${blocos.join("\n")}
</Document>
</kml>`;
  zip.file("doc.kml", kml);
  return { blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), falhas };
}

/** Entrega o arquivo ao usuário (download do navegador). */
export function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

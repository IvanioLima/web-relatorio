// Fonte de dados de demonstração (abra o site com ?demo=1): relatórios e fotos fictícios,
// gerados no navegador. Serve para conhecer o site e testar as exportações sem conta Google.
// Tem os mesmos métodos da fonte "drive" (drive.js).

const DIA = 86_400_000;
const BASE = new Date(2026, 9, 5, 9, 30).getTime();
const PROJETO = {
  uuid: "proj-1",
  titulo: "Fazenda Boa Vista",
  subtitulo: "Monitoramento dos reservatórios",
  status: "RASCUNHO",
  dataCriacao: BASE,
  dataAtualizacao: BASE + 20 * DIA,
};
const LEGENDAS = [
  "Vista geral do reservatório 01, lado norte.",
  "Detalhe da válvula de alívio com sinais de corrosão na base.",
  "Bacia de contenção limpa e sem acúmulo de água.",
  "Sinalização de segurança instalada conforme o projeto.",
  "Trinca no revestimento do piso, próxima ao dreno.\nRecomenda-se reparo antes do período chuvoso.",
  "",
  "Acesso principal desobstruído.",
  "Painel elétrico identificado e fechado.",
  "Extintor dentro do prazo de validade.",
];
const STATUS = ["CONFORME", "NAO_CONFORME", "CONFORME", null, "PENDENTE", null, "CONFORME", "NA", "CONFORME"];
const CORES = ["#4E7A9C", "#7A9C4E", "#9C6B4E", "#6B4E9C", "#4E9C8B", "#9C4E6B", "#8B9C4E", "#4E5F9C", "#9C8B4E"];

function relatorio(n, titulo, subtitulo, dias, qtdFotos, extras = {}) {
  const criacao = BASE + dias * DIA;
  const fotos = Array.from({ length: qtdFotos }, (_, i) => ({
    uuid: `r${n}f${i + 1}`,
    legenda: LEGENDAS[(i + n) % LEGENDAS.length],
    dataHoraCaptura: criacao + (i + 1) * 97_000,
    temLocalizacao: i % 5 !== 4,
    latitude: -15.7801 - i * 0.0004,
    longitude: -47.9292 + i * 0.0005,
    utmZona: "23L",
    utmEste: 186213.4 + i * 55.4,
    utmNorte: 8253370.8 - i * 44.2,
    altitude: 35 + i,
    precisao: 4 + (i % 3),
    status: STATUS[(i + n) % STATUS.length],
    ocultaNoRelatorio: n === 2 && i === 1,
    versaoOriginal: 1,
    versaoAnotada: 1,
    temAnotada: i % 2 === 0,
  }));
  return {
    pasta: { id: `pasta${n}`, nome: titulo, uuid: `rel-${n}`, versao: "1", jsonId: `json${n}` },
    json: {
      relatorio: {
        uuid: `rel-${n}`,
        titulo,
        subtitulo,
        equipeSetor: extras.equipe || null,
        dataCriacao: criacao,
        dataAtualizacao: criacao + DIA,
        status: extras.status || "RASCUNHO",
        tags: extras.tags || "",
        dispositivoCriador: "Celular (demonstração)",
        projeto: extras.projeto || null,
      },
      fotos,
    },
  };
}

const RELATORIOS = [
  relatorio(1, PROJETO.titulo, PROJETO.subtitulo, 0, 5, { projeto: PROJETO, tags: "Vistoria,Tanques", status: "FINALIZADO" }),
  relatorio(2, PROJETO.titulo, PROJETO.subtitulo, 7, 9, { projeto: PROJETO, tags: "Vistoria,Tanques" }),
  relatorio(3, PROJETO.titulo, PROJETO.subtitulo, 20, 2, { projeto: PROJETO, tags: "Vistoria" }),
  relatorio(4, "Inspeção da subestação", "Unidade Norte", 3, 1, { tags: "Inspeção,Elétrica", status: "FINALIZADO" }),
  relatorio(5, "Obra do galpão B", "Etapa de fundação", 12, 6, { tags: "Obra", equipe: "Engenharia Civil" }),
  relatorio(6, "Visita à comunidade", "", 25, 0, { tags: "Comunidade" }),
];

/** Foto fictícia: fundo colorido, "horizonte", número e, na versão anotada, um círculo vermelho. */
function fotoFicticia(nome) {
  const m = /^r(\d+)f(\d+)_(o|a)/.exec(nome) || [null, "1", "1", "o"];
  const n = Number(m[1]);
  const i = Number(m[2]);
  const emPe = (n + i) % 3 === 0;
  const canvas = document.createElement("canvas");
  canvas.width = emPe ? 900 : 1200;
  canvas.height = emPe ? 1200 : 900;
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, "#BFD9EE");
  g.addColorStop(0.55, CORES[(n * 3 + i) % CORES.length]);
  g.addColorStop(1, "#3B3B3B");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "bold 150px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${n}.${i}`, canvas.width / 2, canvas.height / 2);
  ctx.font = "34px sans-serif";
  ctx.fillText("foto de demonstração", canvas.width / 2, canvas.height / 2 + 60);
  if (m[3] === "a") {
    ctx.strokeStyle = "#FF3B30";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(canvas.width * 0.3, canvas.height * 0.3, 90, 0, Math.PI * 2);
    ctx.stroke();
  }
  return new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
}

/** projetos.json e indice.json da demonstração (um projeto ainda sem relatórios). */
const ARQUIVOS_RAIZ = {
  "projetos.json": {
    formato: "fotorelatorio-projetos",
    versao: 1,
    projetos: [
      PROJETO,
      { uuid: "proj-2", titulo: "Estação de tratamento", subtitulo: "Ampliação 2027", status: "RASCUNHO", dataCriacao: BASE + 30 * DIA, dataAtualizacao: BASE + 30 * DIA, excluido: false },
    ],
  },
};

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

export const demo = {
  nome: "demo",

  async listarPastas() {
    await espera(150);
    return RELATORIOS.map((r) => ({ ...r.pasta }));
  },

  async lerJson(pasta) {
    return structuredClone(RELATORIOS.find((r) => r.pasta.id === pasta.id).json);
  },

  async listarArquivos(pastaId) {
    const r = RELATORIOS.find((x) => x.pasta.id === pastaId);
    // Como no Drive, os arquivos das fotos continuam na pasta mesmo que o JSON mude.
    return (r.fotosIniciais ||= r.json.fotos).flatMap((f) => {
      const itens = [{ id: `${f.uuid}_o1.jpg`, nome: `${f.uuid}_o1.jpg`, miniatura: "" }];
      if (f.temAnotada) itens.push({ id: `${f.uuid}_a1.jpg`, nome: `${f.uuid}_a1.jpg`, miniatura: "" });
      return itens;
    });
  },

  async baixar(arquivoId) {
    await espera(30);
    return fotoFicticia(arquivoId);
  },

  // ---------- escrita (só na memória: recarregar a página desfaz) ----------

  async lerPasta(pastaId) {
    const { pasta } = RELATORIOS.find((r) => r.pasta.id === pastaId);
    return { versao: pasta.versao, jsonId: pasta.jsonId };
  },

  async criarJson(pastaId, nome, texto) {
    await espera(120);
    RELATORIOS.find((r) => r.pasta.id === pastaId).pendente = JSON.parse(texto);
    return `json-${nome}`;
  },

  async atualizarPasta(pastaId, propriedades) {
    const r = RELATORIOS.find((x) => x.pasta.id === pastaId);
    r.json = r.pendente;
    r.pasta.versao = propriedades.fr_versao;
    r.pasta.jsonId = propriedades.fr_json;
  },

  async apagarArquivo() {},

  async lerArquivoRaiz(nome) {
    return ARQUIVOS_RAIZ[nome] ? structuredClone(ARQUIVOS_RAIZ[nome]) : null;
  },

  async gravarArquivoRaiz(nome, objeto) {
    ARQUIVOS_RAIZ[nome] = structuredClone(objeto);
  },
};

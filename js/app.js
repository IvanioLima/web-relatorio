// Interface do FotoRelatório Web: entrada, listas de relatórios e projetos, detalhe e exportações.

import { VERSAO } from "./config.js";
import { lerConfig, salvarConfig, imagemParaDataUrl } from "./configuracoes.js";
import { carregarRelatorios, fotosParaExportar, limparCache, listarProjetos } from "./dados.js";
import { demo } from "./demo.js";
import * as acesso from "./drive.js";
import { moverFoto, mudarDados, mudarDadosDoProjeto, mudarFoto, mudarProjeto, salvarRelatorio } from "./edicao.js";
import { baixarArquivo, gerarKmz, gerarZipDeFotos } from "./exportar.js";
import {
  COR_STATUS, ROTULO_STATUS, dataLonga, esc, linhasParaLegenda, nomeBaseProjeto, nomeBaseRelatorio,
  normalizar, tags,
} from "./formato.js";
import { arquivoDaFoto, blobDaFoto, limparCacheDeFotos, urlMiniatura } from "./imagem.js";
import { gerarPdf, gerarPdfCompilado } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const conteudo = $("conteudo");
const MODO_DEMO = new URLSearchParams(location.search).has("demo");
const fonte = MODO_DEMO ? demo : acesso.drive;

const estado = {
  carregado: false,
  relatorios: [],
  projetos: [],
  busca: "",
  tag: null,
  /** uuid dos relatórios marcados para o compilado, por projeto (ausente = todos). */
  selecao: new Map(),
};

// ---------------------------------------------------------------- avisos

function avisar(texto, erro = false) {
  const el = document.createElement("div");
  el.className = `aviso${erro ? " erro" : ""}`;
  el.textContent = texto;
  $("avisos").appendChild(el);
  setTimeout(() => el.remove(), erro ? 8000 : 4500);
}

/** Erro numa operação: sessão vencida volta para a entrada; o resto vira um aviso. */
function tratarErro(e) {
  if (e instanceof acesso.SessaoExpirada) {
    telaDeEntrada("A sessão com o Google expirou (ela dura cerca de 1 hora). Entre novamente para continuar.");
  } else {
    console.error(e);
    avisar(e.message || "Algo deu errado.", true);
  }
}

// ---------------------------------------------------------------- entrada

function telaDeEntrada(mensagem = "") {
  $("barra").hidden = true;
  estado.carregado = false;
  const semId = !acesso.clientId();
  conteudo.innerHTML = `
    <section class="entrada">
      <h1>FotoRelatório Web</h1>
      <p>Consulte e exporte os relatórios que o app do celular sincronizou com o seu Google Drive. Nada passa por servidores: este site conversa direto com o Drive, a partir do seu navegador.</p>
      ${mensagem ? `<p class="erro">${esc(mensagem)}</p>` : ""}
      ${semId ? `
        <p><strong>Primeiro uso:</strong> informe o ID do cliente OAuth (tipo “Aplicativo da Web”) criado no mesmo projeto do Google Cloud do app. O passo a passo está no arquivo <code>README.md</code> do repositório <code>web-relatorio</code>.</p>
        <label>ID do cliente
          <input type="text" id="campoClientId" placeholder="0000000000-xxxxxxxx.apps.googleusercontent.com" autocomplete="off">
        </label>` : ""}
      <div class="linha">
        <button type="button" class="botao" id="botaoEntrar">Entrar com Google</button>
        <a href="?demo=1">Ver uma demonstração (dados fictícios)</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px">Versão ${esc(VERSAO)}</p>
    </section>`;
  $("botaoEntrar").addEventListener("click", async () => {
    if (semId) {
      const id = $("campoClientId").value.trim();
      if (!/\.apps\.googleusercontent\.com$/.test(id)) {
        avisar("O ID do cliente termina com “.apps.googleusercontent.com”.", true);
        return;
      }
      acesso.salvarClientId(id);
    }
    try {
      await acesso.entrar();
      await iniciarSessao();
    } catch (e) {
      telaDeEntrada(`Não foi possível entrar: ${e.message}`);
    }
  });
}

async function iniciarSessao() {
  $("barra").hidden = false;
  $("conta").textContent = MODO_DEMO ? "Demonstração" : acesso.contaLembrada();
  await recarregar();
}

async function recarregar() {
  conteudo.innerHTML = `<p class="vazio" id="carregando">Lendo os relatórios do Google Drive…</p>`;
  try {
    const { relatorios, falhas } = await carregarRelatorios(fonte, (feitos, total) => {
      const el = $("carregando");
      if (el) el.textContent = `Lendo os relatórios do Google Drive… ${feitos} de ${total}`;
    });
    estado.relatorios = relatorios;
    estado.projetos = listarProjetos(relatorios);
    estado.carregado = true;
    if (falhas) avisar(`${falhas} relatório(s) não puderam ser lidos.`, true);
    rotear();
  } catch (e) {
    tratarErro(e);
  }
}

// ---------------------------------------------------------------- rotas

function rotear() {
  if (!estado.carregado) return;
  liberarMiniaturas();
  const [, secao, id] = location.hash.split("/");
  $("abaRelatorios").classList.toggle("ativa", !secao || secao === "relatorio");
  $("abaProjetos").classList.toggle("ativa", secao === "projetos" || secao === "projeto");
  const faixa = MODO_DEMO
    ? `<div class="faixa-demo">Demonstração com dados fictícios. <a href="./">Sair da demonstração</a></div>`
    : "";
  let html;
  if (secao === "relatorio") html = telaRelatorio(decodeURIComponent(id || ""));
  else if (secao === "projetos") html = telaProjetos();
  else if (secao === "projeto") html = telaProjeto(decodeURIComponent(id || ""));
  else html = telaRelatorios();
  conteudo.innerHTML = faixa + html;
  $("busca").hidden = secao === "relatorio" || secao === "projeto";
  $("busca").placeholder = secao === "projetos" ? "Buscar por título ou subtítulo" : "Buscar por título, subtítulo ou tag";
  ligarEventos();
  window.scrollTo(0, 0);
}

const selo = (status) =>
  `<span class="selo${status === "FINALIZADO" ? " concluido" : ""}">${status === "FINALIZADO" ? "Concluído" : "Em execução"}</span>`;

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function cartaoRelatorio(r, dentroDoProjeto = false) {
  const lista = tags(r.tags);
  const vistoria = r.vistoria ? `<p class="vistoria">${dentroDoProjeto ? "" : "Projeto · "}Vistoria ${r.vistoria}</p>` : "";
  return `
    <div class="topo"><h3>${esc(r.titulo)}</h3>${selo(r.status)}</div>
    ${r.subtitulo ? `<p class="sub">${esc(r.subtitulo)}</p>` : ""}
    ${vistoria}
    ${lista.length ? `<p class="tags">${lista.map((t) => `#${esc(t)}`).join("  ")}</p>` : ""}
    <p class="meta">Criado em ${dataLonga(r.dataCriacao)}${r.criador ? ` por ${esc(r.criador)}` : ""} · ${plural(r.fotos.length, "foto", "fotos")}</p>`;
}

function telaRelatorios() {
  const todasAsTags = [...new Map(estado.relatorios.flatMap((r) => tags(r.tags)).map((t) => [normalizar(t), t])).values()]
    .sort((a, b) => normalizar(a).localeCompare(normalizar(b)));
  if (estado.tag && !todasAsTags.some((t) => normalizar(t) === normalizar(estado.tag))) estado.tag = null;
  const termo = normalizar(estado.busca);
  const tag = estado.tag && normalizar(estado.tag);
  const filtrados = estado.relatorios.filter((r) => {
    const doRelatorio = tags(r.tags).map(normalizar);
    const passaTag = !tag || doRelatorio.includes(tag);
    const passaBusca =
      !termo || normalizar(r.titulo).includes(termo) || normalizar(r.subtitulo).includes(termo) ||
      doRelatorio.some((t) => t.includes(termo));
    return passaTag && passaBusca;
  });
  const chips = todasAsTags.length
    ? `<div class="chips">
        <button type="button" class="chip${estado.tag ? "" : " ativa"}" data-tag="">Todas</button>
        ${todasAsTags.map((t) => `<button type="button" class="chip${tag === normalizar(t) ? " ativa" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
      </div>`
    : "";
  const vazio = estado.relatorios.length
    ? "Nenhum relatório encontrado para esta busca/filtro."
    : "Nenhum relatório no Google Drive ainda. Sincronize pelo app do celular e toque em Atualizar.";
  return `
    <div class="cabecalho-lista"><h1>Relatórios</h1><span class="contagem">${filtrados.length} de ${estado.relatorios.length}</span></div>
    ${chips}
    ${filtrados.length
      ? `<div class="grade">${filtrados.map((r) => `<a class="cartao" href="#/relatorio/${encodeURIComponent(r.uuid)}">${cartaoRelatorio(r)}</a>`).join("")}</div>`
      : `<p class="vazio">${vazio}</p>`}`;
}

function telaProjetos() {
  const termo = normalizar(estado.busca);
  const filtrados = estado.projetos.filter(
    (p) => !termo || normalizar(p.titulo).includes(termo) || normalizar(p.subtitulo).includes(termo)
  );
  const vazio = estado.projetos.length
    ? "Nenhum projeto encontrado para esta busca."
    : "Nenhum projeto ainda. Os projetos aparecem aqui quando têm ao menos um relatório sincronizado.";
  return `
    <div class="cabecalho-lista"><h1>Projetos</h1><span class="contagem">${filtrados.length} de ${estado.projetos.length}</span></div>
    ${filtrados.length
      ? `<div class="grade">${filtrados.map((p) => `
          <a class="cartao" href="#/projeto/${encodeURIComponent(p.uuid)}">
            <div class="topo"><h3>${esc(p.titulo)}</h3>${selo(p.status)}</div>
            ${p.subtitulo ? `<p class="sub">${esc(p.subtitulo)}</p>` : ""}
            <p class="vistoria">${plural(p.relatorios.length, "relatório", "relatórios")}</p>
            <p class="meta">Criado em ${dataLonga(p.dataCriacao || p.relatorios[0].dataCriacao)}</p>
          </a>`).join("")}</div>`
      : `<p class="vazio">${vazio}</p>`}`;
}

function telaRelatorio(uuid) {
  const r = estado.relatorios.find((x) => x.uuid === uuid);
  if (!r) return `<a class="voltar" href="#/">← Relatórios</a><p class="vazio">Relatório não encontrado.</p>`;
  const cfg = lerConfig();
  const lista = tags(r.tags);
  const voltar = r.projeto
    ? `<a class="voltar" href="#/projeto/${encodeURIComponent(r.projeto.uuid)}">← ${esc(r.projeto.titulo)}</a>`
    : `<a class="voltar" href="#/">← Relatórios</a>`;
  const exportaveis = fotosParaExportar(r).length;
  return `
    ${voltar}
    <section class="cabecalho-detalhe">
      <div class="topo"><h1>${esc(r.titulo)}</h1>${selo(r.status)}</div>
      ${r.subtitulo ? `<p class="sub">${esc(r.subtitulo)}</p>` : ""}
      ${r.vistoria ? `<p class="meta"><strong>Projeto · Vistoria ${r.vistoria}</strong></p>` : ""}
      ${lista.length ? `<p class="meta" style="color:var(--primaria)">${lista.map((t) => `#${esc(t)}`).join("  ")}</p>` : ""}
      <p class="meta">Criado em ${dataLonga(r.dataCriacao)}${r.criador ? ` por ${esc(r.criador)}` : ""} · ${plural(r.fotos.length, "foto", "fotos")}${r.equipeSetor ? ` · Rodapé: ${esc(r.equipeSetor)}` : ""}</p>
      <div class="exportar">
        <button type="button" class="botao" data-exportar="pdf" data-relatorio="${esc(r.uuid)}">PDF</button>
        <button type="button" class="botao secundario" data-exportar="zip" data-relatorio="${esc(r.uuid)}" ${exportaveis ? "" : "disabled"}>Fotos (.zip)</button>
        <button type="button" class="botao secundario" data-exportar="kmz" data-relatorio="${esc(r.uuid)}" ${exportaveis ? "" : "disabled"}>KMZ</button>
        <button type="button" class="botao secundario" data-editar-relatorio="${esc(r.uuid)}">Editar dados</button>
      </div>
    </section>
    ${r.fotos.length
      ? `<div class="fotos">${r.fotos.map((f, i) => {
          const dados = linhasParaLegenda(f, cfg);
          return `
          <figure class="foto${f.oculta ? " oculta" : ""}" style="margin:0">
            <button type="button" class="miniatura" data-foto="${i}" aria-label="Ampliar a foto ${i + 1}"><img alt="" data-miniatura="${i}"></button>
            <figcaption class="texto">
              ${f.legenda.trim() ? `<p class="legenda">${esc(f.legenda.trim())}</p>` : ""}
              ${dados.length ? `<p class="dados">${dados.map(esc).join("<br>")}</p>` : ""}
              ${ROTULO_STATUS[f.status] ? `<span class="selo-foto" style="background:${COR_STATUS[f.status]}">${ROTULO_STATUS[f.status].toUpperCase()}</span>` : ""}
              ${f.oculta ? `<p class="nota">Não entra no relatório</p>` : ""}
              <div class="acoes-foto">
                <button type="button" class="botao-pequeno" data-mover="-1" data-indice="${i}" ${i === 0 ? "disabled" : ""} aria-label="Mover a foto ${i + 1} para antes">←</button>
                <button type="button" class="botao-pequeno" data-mover="1" data-indice="${i}" ${i === r.fotos.length - 1 ? "disabled" : ""} aria-label="Mover a foto ${i + 1} para depois">→</button>
                <span class="espaco"></span>
                <button type="button" class="botao-pequeno" data-editar-foto="${i}">Editar</button>
              </div>
            </figcaption>
          </figure>`;
        }).join("")}</div>`
      : `<p class="vazio">Nenhuma foto neste relatório.</p>`}`;
}

function marcadosDoProjeto(p) {
  const marcados = estado.selecao.get(p.uuid);
  return marcados ? p.relatorios.filter((r) => marcados.has(r.uuid)) : p.relatorios;
}

function telaProjeto(uuid) {
  const p = estado.projetos.find((x) => x.uuid === uuid);
  if (!p) return `<a class="voltar" href="#/projetos">← Projetos</a><p class="vazio">Projeto não encontrado.</p>`;
  const marcados = marcadosDoProjeto(p);
  const parcial = marcados.length !== p.relatorios.length;
  const aviso = !marcados.length
    ? "Marque ao menos um relatório para exportar."
    : marcados.length === 1
      ? "Será compilado apenas o relatório selecionado."
      : `Serão compilados apenas os ${marcados.length} relatórios selecionados.`;
  return `
    <a class="voltar" href="#/projetos">← Projetos</a>
    <section class="cabecalho-detalhe">
      <div class="topo"><h1>${esc(p.titulo)}</h1>${selo(p.status)}</div>
      ${p.subtitulo ? `<p class="sub">${esc(p.subtitulo)}</p>` : ""}
      <p class="meta">${plural(p.relatorios.length, "relatório", "relatórios")} · Relatório compilado: todos os relatórios marcados num único arquivo, da vistoria mais antiga para a mais nova.</p>
      <div class="exportar">
        <button type="button" class="botao" data-exportar="pdf" data-projeto="${esc(p.uuid)}" ${marcados.length ? "" : "disabled"}>PDF compilado</button>
        <button type="button" class="botao secundario" data-exportar="zip" data-projeto="${esc(p.uuid)}" ${marcados.length ? "" : "disabled"}>Fotos (.zip)</button>
        <button type="button" class="botao secundario" data-exportar="kmz" data-projeto="${esc(p.uuid)}" ${marcados.length ? "" : "disabled"}>KMZ</button>
        <button type="button" class="botao secundario" data-editar-projeto="${esc(p.uuid)}">Editar projeto</button>
      </div>
      ${parcial ? `<p class="aviso-parcial">${aviso}</p>` : ""}
    </section>
    <div class="grade">${p.relatorios.map((r) => `
      <div class="cartao cartao-vistoria">
        <input type="checkbox" data-marcar="${esc(r.uuid)}" data-projeto="${esc(p.uuid)}" ${marcados.includes(r) ? "checked" : ""} aria-label="Incluir a vistoria ${r.vistoria} no compilado">
        <a href="#/relatorio/${encodeURIComponent(r.uuid)}">${cartaoRelatorio(r, true)}</a>
      </div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- eventos da tela

function ligarEventos() {
  conteudo.querySelectorAll("[data-tag]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.tag = b.dataset.tag || null;
      rotear();
    })
  );
  conteudo.querySelectorAll("[data-marcar]").forEach((c) =>
    c.addEventListener("change", () => {
      const p = estado.projetos.find((x) => x.uuid === c.dataset.projeto);
      const marcados = new Set(marcadosDoProjeto(p).map((r) => r.uuid));
      if (c.checked) marcados.add(c.dataset.marcar);
      else marcados.delete(c.dataset.marcar);
      estado.selecao.set(p.uuid, marcados);
      rotear();
    })
  );
  conteudo.querySelectorAll("[data-exportar]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.projeto) exportarProjeto(b.dataset.projeto, b.dataset.exportar);
      else exportarRelatorio(b.dataset.relatorio, b.dataset.exportar);
    })
  );
  conteudo.querySelectorAll("[data-editar-relatorio]").forEach((b) =>
    b.addEventListener("click", () => editarRelatorio(b.dataset.editarRelatorio))
  );
  conteudo.querySelectorAll("[data-editar-projeto]").forEach((b) =>
    b.addEventListener("click", () => editarProjeto(b.dataset.editarProjeto))
  );
  const [, secao, id] = location.hash.split("/");
  if (secao === "relatorio") {
    const r = estado.relatorios.find((x) => x.uuid === decodeURIComponent(id || ""));
    if (!r) return;
    ligarFotos(r);
    conteudo.querySelectorAll("[data-editar-foto]").forEach((b) =>
      b.addEventListener("click", () => editarFoto(r, r.fotos[Number(b.dataset.editarFoto)]))
    );
    conteudo.querySelectorAll("[data-mover]").forEach((b) =>
      b.addEventListener("click", () => {
        const foto = r.fotos[Number(b.dataset.indice)];
        gravar([{ relatorio: r, mudar: moverFoto(foto.uuid, Number(b.dataset.mover)) }]);
      })
    );
  }
}

// ---------------------------------------------------------------- edição

/**
 * Grava as mudanças no Drive (uma por relatório), mostrando o andamento, e relê os relatórios.
 * @param itens [{ relatorio, mudar }]
 * @returns true se tudo foi gravado
 */
async function gravar(itens) {
  const d = $("dialogoSalvando");
  $("textoSalvando").textContent = "";
  d.showModal();
  let feitos = 0;
  try {
    for (const { relatorio, mudar } of itens) {
      if (itens.length > 1) $("textoSalvando").textContent = `Relatório ${feitos + 1} de ${itens.length}`;
      await salvarRelatorio(fonte, relatorio, mudar);
      feitos++;
    }
  } catch (e) {
    d.close();
    if (e instanceof acesso.SessaoExpirada) {
      tratarErro(e);
      return false;
    }
    console.error(e);
    avisar(
      (feitos ? `${feitos} de ${itens.length} relatórios foram gravados antes do erro. ` : "") + (e.message || "Não foi possível salvar."),
      true
    );
    if (feitos) await recarregar();
    return false;
  }
  d.close();
  // Mantém a posição da tela (ao mover fotos, por exemplo, a lista não volta para o topo).
  const posicao = window.scrollY;
  await recarregar();
  window.scrollTo(0, posicao);
  avisar("Alterações salvas. O celular as recebe na próxima sincronização.");
  return true;
}

/** Liga os botões Cancelar de um diálogo e o abre; [aoSalvar] recebe o formulário. */
function abrirFormulario(idDialogo, idForm, aoSalvar) {
  const d = $(idDialogo);
  const form = $(idForm);
  d.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = () => d.close()));
  form.onsubmit = async (e) => {
    e.preventDefault();
    d.close();
    await aoSalvar(form);
  };
  d.showModal();
  return form;
}

function editarRelatorio(uuid) {
  const r = estado.relatorios.find((x) => x.uuid === uuid);
  if (!r) return;
  const form = $("formRelatorio");
  form.elements.projeto.innerHTML =
    `<option value="">Nenhum (relatório avulso)</option>` +
    estado.projetos.map((p) => `<option value="${esc(p.uuid)}">${esc(p.titulo)}</option>`).join("");
  form.elements.projeto.value = r.projeto?.uuid || "";
  form.elements.equipeSetor.value = r.equipeSetor;
  form.elements.tags.value = tags(r.tags).join(", ");
  form.elements.concluido.checked = r.status === "FINALIZADO";
  let tituloLivre = r.projeto ? "" : r.titulo;
  let subtituloLivre = r.projeto ? "" : r.subtitulo;
  // Com projeto: título e subtítulo são os dele, bloqueados. Sem projeto: editáveis.
  const aplicarProjeto = () => {
    const p = estado.projetos.find((x) => x.uuid === form.elements.projeto.value);
    form.elements.titulo.value = p ? p.titulo : tituloLivre || r.titulo;
    form.elements.subtitulo.value = p ? p.subtitulo : subtituloLivre || (r.projeto ? r.subtitulo : "");
    form.elements.titulo.disabled = form.elements.subtitulo.disabled = !!p;
    $("dicaProjeto").hidden = !p;
  };
  form.elements.titulo.oninput = () => (tituloLivre = form.elements.titulo.value);
  form.elements.subtitulo.oninput = () => (subtituloLivre = form.elements.subtitulo.value);
  form.elements.projeto.onchange = aplicarProjeto;
  aplicarProjeto();

  abrirFormulario("dialogoRelatorio", "formRelatorio", async () => {
    const projeto = estado.projetos.find((x) => x.uuid === form.elements.projeto.value) || null;
    const dados = mudarDados({
      titulo: form.elements.titulo.value,
      subtitulo: form.elements.subtitulo.value,
      equipeSetor: form.elements.equipeSetor.value,
      tags: tags(form.elements.tags.value).join(","),
      concluido: form.elements.concluido.checked,
    });
    const trocouProjeto = (projeto?.uuid || "") !== (r.projeto?.uuid || "");
    await gravar([{
      relatorio: r,
      mudar: (json) => {
        // Primeiro o projeto (define se título/subtítulo ficam livres), depois os demais dados.
        if (trocouProjeto) mudarProjeto(projeto)(json);
        dados(json);
      },
    }]);
  });
}

function editarFoto(relatorio, foto) {
  const form = $("formFoto");
  form.elements.legenda.value = foto.legenda;
  form.elements.status.value = ROTULO_STATUS[foto.status] ? foto.status : "";
  form.elements.oculta.checked = foto.oculta;
  abrirFormulario("dialogoFoto", "formFoto", () =>
    gravar([{
      relatorio,
      mudar: mudarFoto(foto.uuid, {
        legenda: form.elements.legenda.value.trim(),
        status: form.elements.status.value,
        oculta: form.elements.oculta.checked,
      }),
    }])
  );
}

function editarProjeto(uuid) {
  const p = estado.projetos.find((x) => x.uuid === uuid);
  if (!p) return;
  const form = $("formProjeto");
  form.elements.titulo.value = p.titulo;
  form.elements.subtitulo.value = p.subtitulo;
  form.elements.concluido.checked = p.status === "FINALIZADO";
  abrirFormulario("dialogoProjeto", "formProjeto", () => {
    const novo = {
      titulo: form.elements.titulo.value.trim(),
      subtitulo: form.elements.subtitulo.value.trim(),
      concluido: form.elements.concluido.checked,
    };
    const agora = Date.now();
    // O projeto viaja dentro de cada relatório: todos precisam ser regravados.
    return gravar(p.relatorios.map((r) => ({ relatorio: r, mudar: mudarDadosDoProjeto(p, novo, agora) })));
  });
}

// ---------------------------------------------------------------- fotos (miniaturas e visor)

let urlsDeMiniatura = [];
let observador = null;

function liberarMiniaturas() {
  observador?.disconnect();
  observador = null;
  urlsDeMiniatura.forEach((u) => URL.revokeObjectURL(u));
  urlsDeMiniatura = [];
}

/** Carrega as miniaturas conforme entram na tela, poucas por vez (as fotos originais são grandes). */
function ligarFotos(relatorio) {
  const fila = [];
  let ativas = 0;
  const proxima = () => {
    while (ativas < 3 && fila.length) {
      const img = fila.shift();
      if (!img.isConnected) continue;
      ativas++;
      carregarMiniatura(relatorio, relatorio.fotos[Number(img.dataset.miniatura)], img).finally(() => {
        ativas--;
        proxima();
      });
    }
  };
  observador = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        observador.unobserve(e.target);
        fila.push(e.target);
      }
      proxima();
    },
    { rootMargin: "300px" }
  );
  conteudo.querySelectorAll("[data-miniatura]").forEach((img) => observador.observe(img));
  conteudo.querySelectorAll("[data-foto]").forEach((b) =>
    b.addEventListener("click", () => abrirVisor(relatorio, relatorio.fotos[Number(b.dataset.foto)]))
  );
}

async function carregarMiniatura(relatorio, foto, img) {
  try {
    // Primeiro a miniatura pronta do próprio Drive (leve); se o navegador não conseguir
    // mostrá-la, baixa a foto e reduz aqui.
    const arquivo = await arquivoDaFoto(fonte, relatorio, foto);
    if (arquivo?.miniatura) {
      const ok = await new Promise((resolver) => {
        img.referrerPolicy = "no-referrer";
        img.onload = () => resolver(true);
        img.onerror = () => resolver(false);
        img.src = arquivo.miniatura.replace(/=s\d+$/, "=s480");
      });
      if (ok) return;
    }
    const url = await urlMiniatura(fonte, relatorio, foto);
    urlsDeMiniatura.push(url);
    img.onload = img.onerror = null;
    img.src = url;
  } catch (e) {
    if (e instanceof acesso.SessaoExpirada) tratarErro(e);
    else img.alt = "Foto indisponível no Google Drive";
  }
}

let urlDoVisor = null;

async function abrirVisor(relatorio, foto) {
  const visor = $("visor");
  $("imagemVisor").removeAttribute("src");
  $("legendaVisor").textContent = "Carregando…";
  visor.showModal();
  try {
    const blob = await blobDaFoto(fonte, relatorio, foto);
    if (urlDoVisor) URL.revokeObjectURL(urlDoVisor);
    urlDoVisor = URL.createObjectURL(blob);
    $("imagemVisor").src = urlDoVisor;
    $("legendaVisor").textContent = [foto.legenda.trim(), ...linhasParaLegenda(foto, lerConfig())].filter(Boolean).join("\n");
  } catch (e) {
    visor.close();
    tratarErro(e);
  }
}

// ---------------------------------------------------------------- exportações

/** Diálogo com o andamento; ao terminar, mostra os botões para abrir/baixar o arquivo. */
function dialogoDeArquivo(titulo) {
  const d = $("dialogoArquivo");
  $("tituloArquivo").textContent = titulo;
  $("textoArquivo").textContent = "Preparando…";
  $("barraArquivo").hidden = false;
  $("barraArquivo").value = 0;
  $("acoesArquivo").innerHTML = "";
  d.showModal();
  return {
    progresso(atual, total, rotulo) {
      $("textoArquivo").textContent = `${rotulo} ${atual} de ${total}…`;
      $("barraArquivo").value = total ? (atual / total) * 100 : 0;
    },
    pronto(blob, nome, falhas, podeAbrir) {
      $("barraArquivo").hidden = true;
      $("textoArquivo").textContent =
        `${nome} (${(blob.size / 1048576).toFixed(1).replace(".", ",")} MB)` +
        (falhas ? ` — atenção: ${plural(falhas, "foto não pôde ser lida", "fotos não puderam ser lidas")} no Google Drive.` : "");
      const url = URL.createObjectURL(blob);
      const acoes = $("acoesArquivo");
      acoes.innerHTML = `
        <button type="button" class="botao secundario" id="fecharArquivo">Fechar</button>
        ${podeAbrir ? `<a class="botao secundario" href="${url}" target="_blank" rel="noopener">Abrir em nova aba</a>` : ""}
        <button type="button" class="botao" id="baixarArquivo">Baixar</button>`;
      $("baixarArquivo").addEventListener("click", () => baixarArquivo(blob, nome));
      $("fecharArquivo").addEventListener("click", () => {
        d.close();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
    },
    fechar: () => d.close(),
  };
}

async function exportarRelatorio(uuid, formato) {
  const r = estado.relatorios.find((x) => x.uuid === uuid);
  if (!r) return;
  const cfg = lerConfig();
  const base = nomeBaseRelatorio(r);
  const dialogo = dialogoDeArquivo(r.titulo);
  try {
    if (formato === "pdf") {
      const { blob, falhas } = await gerarPdf(fonte, r, cfg, (a, t) => dialogo.progresso(a, t, "Gerando a página"));
      dialogo.pronto(blob, `${base}.pdf`, falhas, true);
    } else if (formato === "zip") {
      const { blob, falhas } = await gerarZipDeFotos(fonte, [{ relatorio: r, pasta: "" }], cfg, (a, t) => dialogo.progresso(a, t, "Preparando a foto"));
      dialogo.pronto(blob, `${base}_fotos.zip`, falhas, false);
    } else {
      const equipe = r.equipeSetor.trim() || cfg.equipeSetorPadrao;
      const descricao = r.subtitulo + (equipe ? ` — ${equipe}` : "");
      const { blob, falhas } = await gerarKmz(fonte, r.titulo, descricao, [{ relatorio: r, pasta: "" }], cfg, (a, t) => dialogo.progresso(a, t, "Preparando a foto"));
      dialogo.pronto(blob, `${base}.kmz`, falhas, false);
    }
  } catch (e) {
    dialogo.fechar();
    tratarErro(e);
  }
}

async function exportarProjeto(uuid, formato) {
  const p = estado.projetos.find((x) => x.uuid === uuid);
  if (!p) return;
  const relatorios = marcadosDoProjeto(p);
  if (!relatorios.length) return;
  const cfg = lerConfig();
  const agora = Date.now();
  const base = nomeBaseProjeto(p, agora);
  const dialogo = dialogoDeArquivo(p.titulo);
  try {
    if (formato === "pdf") {
      const { blob, falhas } = await gerarPdfCompilado(fonte, p, relatorios, cfg, agora, (a, t) => dialogo.progresso(a, t, "Gerando a página"));
      dialogo.pronto(blob, `${base}.pdf`, falhas, true);
    } else {
      const comFotos = relatorios.filter((r) => fotosParaExportar(r).length);
      if (!comFotos.length) throw new Error("Não há fotos para exportar nos relatórios marcados.");
      if (formato === "zip") {
        const grupos = comFotos.map((r) => ({ relatorio: r, pasta: `Vistoria_${r.vistoria}` }));
        const { blob, falhas } = await gerarZipDeFotos(fonte, grupos, cfg, (a, t) => dialogo.progresso(a, t, "Preparando a foto"));
        dialogo.pronto(blob, `${base}_fotos.zip`, falhas, false);
      } else {
        const grupos = comFotos.map((r) => ({ relatorio: r, pasta: `Vistoria ${r.vistoria}` }));
        const { blob, falhas } = await gerarKmz(fonte, p.titulo, p.subtitulo, grupos, cfg, (a, t) => dialogo.progresso(a, t, "Preparando a foto"));
        dialogo.pronto(blob, `${base}.kmz`, falhas, false);
      }
    }
  } catch (e) {
    dialogo.fechar();
    tratarErro(e);
  }
}

// ---------------------------------------------------------------- configurações

function abrirConfiguracoes() {
  const form = $("formConfig");
  const cfg = lerConfig();
  const imagens = { logo: cfg.logo, imagemCabecalho: cfg.imagemCabecalho };

  const mostrarImagens = () => {
    $("previaLogo").hidden = !imagens.logo;
    if (imagens.logo) $("previaLogo").src = imagens.logo;
    $("previaCabecalho").hidden = !imagens.imagemCabecalho;
    if (imagens.imagemCabecalho) $("previaCabecalho").src = imagens.imagemCabecalho;
  };
  const mostrarModo = () => {
    const comImagem = form.elements.cabecalhoComImagem.value === "sim";
    form.querySelectorAll("[data-quando]").forEach((el) => (el.hidden = (el.dataset.quando === "imagem") !== comImagem));
  };

  form.elements.cabecalhoComImagem.value = cfg.cabecalhoComImagem ? "sim" : "nao";
  for (const campo of ["linha1", "linha2", "linha3", "equipeSetorPadrao", "formatoCoordenada", "textoMarcaDagua", "tamanhoFonteFotoPct"]) {
    form.elements[campo].value = cfg[campo];
  }
  for (const campo of ["mostrarDataNaLegenda", "mostrarHoraNaLegenda", "mostrarCoordenadasNaLegenda", "mostrarDataNaFoto", "mostrarHoraNaFoto", "mostrarCoordenadasNaFoto"]) {
    form.elements[campo].checked = cfg[campo];
  }
  $("saidaTamanho").textContent = `${cfg.tamanhoFonteFotoPct}%`;
  $("arquivoLogo").value = "";
  $("arquivoCabecalho").value = "";
  mostrarImagens();
  mostrarModo();

  form.onchange = mostrarModo;
  form.elements.tamanhoFonteFotoPct.oninput = (e) => ($("saidaTamanho").textContent = `${e.target.value}%`);
  const aoEscolher = (campo, largura) => async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    try {
      imagens[campo] = await imagemParaDataUrl(arquivo, largura);
      mostrarImagens();
    } catch {
      avisar("Não foi possível ler esta imagem.", true);
    }
  };
  $("arquivoLogo").onchange = aoEscolher("logo", 600);
  $("arquivoCabecalho").onchange = aoEscolher("imagemCabecalho", 1650);
  $("removerLogo").onclick = () => { imagens.logo = ""; mostrarImagens(); };
  $("removerCabecalho").onclick = () => { imagens.imagemCabecalho = ""; mostrarImagens(); };
  $("cancelarConfig").onclick = () => $("dialogoConfig").close();

  form.onsubmit = (e) => {
    e.preventDefault();
    const novo = {
      ...cfg,
      ...imagens,
      cabecalhoComImagem: form.elements.cabecalhoComImagem.value === "sim",
      tamanhoFonteFotoPct: Number(form.elements.tamanhoFonteFotoPct.value),
    };
    for (const campo of ["linha1", "linha2", "linha3", "equipeSetorPadrao", "formatoCoordenada", "textoMarcaDagua"]) {
      novo[campo] = form.elements[campo].value;
    }
    for (const campo of ["mostrarDataNaLegenda", "mostrarHoraNaLegenda", "mostrarCoordenadasNaLegenda", "mostrarDataNaFoto", "mostrarHoraNaFoto", "mostrarCoordenadasNaFoto"]) {
      novo[campo] = form.elements[campo].checked;
    }
    if (!salvarConfig(novo)) {
      avisar("As imagens são grandes demais para guardar neste navegador. Use arquivos menores.", true);
      return;
    }
    $("dialogoConfig").close();
    avisar("Configurações salvas.");
    rotear();
  };
  $("dialogoConfig").showModal();
}

// ---------------------------------------------------------------- início

$("busca").addEventListener("input", (e) => {
  estado.busca = e.target.value;
  const posicao = e.target.selectionStart;
  rotear();
  e.target.focus();
  e.target.setSelectionRange(posicao, posicao);
});
$("botaoAtualizar").addEventListener("click", () => {
  limparCacheDeFotos();
  recarregar();
});
$("botaoConfig").addEventListener("click", abrirConfiguracoes);
$("botaoSair").addEventListener("click", () => {
  if (MODO_DEMO) {
    location.href = "./";
    return;
  }
  acesso.sair();
  limparCache();
  limparCacheDeFotos();
  telaDeEntrada();
});
$("fecharVisor").addEventListener("click", () => $("visor").close());
$("visor").addEventListener("click", (e) => {
  if (e.target === $("visor")) $("visor").close();
});
window.addEventListener("hashchange", rotear);

if (MODO_DEMO || acesso.temSessao()) iniciarSessao();
else telaDeEntrada();

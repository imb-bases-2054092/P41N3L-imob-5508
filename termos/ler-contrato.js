// v20: leitura de contrato (PDF/DOCX) — mesmo algoritmo dos termos antigos (entrega-chaves.html)
(function(){
function reconstruirTextoPagina(items) {
  let texto = '';
  let anterior = null;
  items.forEach(item => {
    if (!item.str) return;
    if (anterior) {
      const mesmaLinha = Math.abs(item.transform[5] - anterior.transform[5]) < 2;
      if (!mesmaLinha) {
        texto += '\n';
      } else {
        const vao = item.transform[4] - (anterior.transform[4] + anterior.width);
        if (vao > 1) texto += ' ';
      }
    }
    texto += item.str;
    anterior = item;
  });
  return texto;
}

function espacarLetras(texto) {
  return texto.split(' ').map(palavra => palavra.split('').join(' ')).join('    ');
}

function tituloCase(texto) {
  const minusculas = ['da', 'de', 'do', 'das', 'dos', 'e'];
  return texto.toLowerCase().split(' ').filter(Boolean).map((p, i) =>
    (minusculas.includes(p) && i !== 0) ? p : (p.charAt(0).toUpperCase() + p.slice(1))
  ).join(' ');
}

// colapsa títulos com letras separadas por espaço (ex.: "L O C A T Á R I A" -> "LOCATÁRIA"),
// comuns em contratos antigos, tanto em PDF quanto em Word/.doc
function normalizarEspacamentoLetras(texto) {
  return texto.replace(/\b(?:[A-ZÀ-ÖØ-Þ]\s+){2,}[A-ZÀ-ÖØ-Þ]\b/g, m => m.replace(/\s+/g, ''));
}

function mapearEstadoCivil(txt) {
  const t = txt.toLowerCase();
  if (t.startsWith('solteir')) return 'solteiro';
  if (t.startsWith('casad')) return 'casado';
  if (t.startsWith('divorciad')) return 'divorciado';
  if (t.startsWith('vi')) return 'viuvo';
  if (t.startsWith('separad')) return 'separado';
  if (t.includes('uni')) return 'uniao_estavel';
  return '';
}

// encontra o início do quadro/parágrafo do(a) LOCATÁRIO(A) — só considera uma ocorrência
// da palavra se houver um CPF logo em seguida (é o que distingue o quadro de qualificação
// de meras menções soltas ao "LOCATÁRIO" no meio das cláusulas)
function localizarInicioLocatario(texto) {
  const regexLabel = /LOCAT[ÁA]RI[OA]S?/gi;
  let m;
  while ((m = regexLabel.exec(texto)) !== null) {
    // janela maior que o necessário para RG puro, porque a qualificação de um(a)
    // locatário(a) estrangeiro(a) ("...portador da Carteira de Registro Nacional
    // Migratório (RNM) nº...") é bem mais longa que a de RG e pode empurrar o CPF
    // para mais longe do rótulo "LOCATÁRIO"
    const janela = texto.slice(m.index, m.index + 900);
    if (/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(janela)) return m.index;
  }
  return -1;
}

function proximaOcorrencia(texto, apartirDe, regexes) {
  let menor = -1;
  regexes.forEach(fonte => {
    const re = new RegExp(fonte, 'gi');
    re.lastIndex = apartirDe;
    const m = re.exec(texto);
    if (m && (menor === -1 || m.index < menor)) menor = m.index;
  });
  return menor;
}

// recorta apenas o trecho do(a) locatário(a), do início do quadro até a próxima seção
// (imóvel, garantia, fiador, testemunha, cláusula 1ª etc.) — isso é o que evita pegar
// dados da locadora, dos fiadores e das testemunhas junto
function extrairBlocoLocatario(texto) {
  const inicio = localizarInicioLocatario(texto);
  if (inicio === -1) return '';
  const marcadoresFim = [
    'IM[OÓ]VEL', 'GARANTIA', 'FIADOR', 'TESTEMUNHA',
    'CL[ÁA]USULA\\s*1', 'OBJETO\\s+DA', 'VALOR\\s+DO\\s+ALUGUEL',
    'PRAZO\\s+DA\\s+LOCA', 'VIG[ÊE]NCIA'
  ];
  let fim = proximaOcorrencia(texto, inicio + 15, marcadoresFim);
  if (fim === -1 || fim - inicio > 1800) fim = Math.min(texto.length, inicio + 900);
  return texto.slice(inicio, fim);
}

// extrai nome, sexo, estado civil, profissão, RG e CPF de cada pessoa dentro de um bloco de texto
// tenta reconhecer quando o "locatário" do contrato é uma Pessoa Jurídica (empresa),
// no padrão "NOME EMPRESA, natureza jurídica, que destina-se a explorar o ramo de
// atividade..., com contrato social registrado na JUCESP sob o NIRE X e inscrita no
// CNPJ/MF sob nº Y, com sede na..., representada por seu cargo NOME, ..."
// retorna null se não achar sinais de PJ ou não conseguir identificar o representante
function extrairEmpresaDoBloco(bloco) {
  const sinalPJ = /CNPJ\/MF|NIRE|contrato\s+social|sociedade\s+empres[áa]ria/i.test(bloco);
  if (!sinalPJ) return null;

  // remove o rótulo "LOCATÁRIO(A):" do início do bloco, que viria antes do nome da empresa
  const blocoSemRotulo = bloco.replace(/^\s*LOCAT[ÁA]RI[OA]S?\s*:?\s*/i, '');

  // nome da empresa: aceita letras/números e pontuação comum em razão social, incluindo
  // travessão e parênteses (ex.: "FULANA – ME (FILIAL)")
  const mNome = /^\s*([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9.\-\/&()–]*(?:\s+[A-ZÀ-Ý0-9.\-\/&()–]+){1,8})\s*,/.exec(blocoSemRotulo);
  if (!mNome) return null;
  const nomeEmpresa = mNome[1].trim();

  let naturezaJuridica = '';
  const mNatureza = /,\s*([^,]+?)\s*,\s*que\s+(?:se\s+destina|destina-se)/i.exec(bloco);
  if (mNatureza) naturezaJuridica = mNatureza[1].trim();

  // "que destina-se/se destina a explorar o ramo de/do/da ATIVIDADE" — a frase varia bastante
  // de contrato pra contrato, então aceita as duas ordens e as três preposições
  let atividadeEconomica = '';
  const mAtividade = /que\s+(?:se\s+destina|destina-se)\s+a\s+explorar\s+o\s+ramo\s+d[eoa]\s+([\s\S]+?)\s*,\s*com\s+contrato\s+social/i.exec(bloco)
    || /que\s+(?:se\s+destina|destina-se)\s+a\s+explorar\s+o\s+ramo\s+d[eoa]\s+([\s\S]+?)\s*,\s*(?:e\s+)?inscrita\s+no\s+CNPJ/i.exec(bloco)
    || /que\s+(?:se\s+destina|destina-se)\s+a\s+explorar\s+o\s+ramo\s+d[eoa]\s+([\s\S]+?)\s*,\s*(?:com\s+sede|localizada|registrada)/i.exec(bloco);
  if (mAtividade) atividadeEconomica = mAtividade[1].trim();

  // NIRE: às vezes vem "NIRE 123..." e às vezes "NIRE nº 123..." — o "nº"/"n°" entre o
  // rótulo e o número é opcional
  let nire = '';
  const mNire = /NIRE\s*(?:n[ºo°]\.?\s*)?([\dA-Za-z.\-\/]+)/i.exec(bloco);
  if (mNire) nire = mNire[1].replace(/[.,;]+$/, '');

  let cnpj = '';
  const mCnpj = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(bloco);
  if (mCnpj) cnpj = mCnpj[1];

  let enderecoSede = '';
  const mSede = /(?:com\s+sede\s+na|localizada\s+na)\s+([^,]+(?:,\s*[^,]+?)*?)\s*,\s*(?:neste\s+ato|$)/i.exec(bloco);
  if (mSede) enderecoSede = mSede[1].trim();

  // "representada/representado por [seu/sua/seus/suas CARGO] [1)] NOME, ..." — o "neste
  // ato" é opcional (varia de contrato pra contrato), e o conector (seu/sua/seus/suas) é
  // capturado literalmente do texto pra manter a concordância de gênero/número original,
  // em vez de tentar adivinhar. O cargo (e o conector) são opcionais, porque às vezes o
  // contrato só diz "representada por NOME, ..." sem citar cargo nenhum; o número "1)"
  // opcional cobre o caso de vários representantes listados. Sem a flag "i" de propósito —
  // comparar sem diferenciar maiúscula/minúscula faria o cargo (minúsculo) colar no nome
  const mRepr = /(?:neste\s+ato\s+)?representad[ao]\s+(?:através\s+de[^,;]+por\s+|por\s+)?(?:(seu|sua|seus|suas)\s+([a-zà-ÿ][a-zà-ÿ\s]*?)\s+)?(?:\d+\)\s*)?([A-ZÀ-Ý]{2,}(?:\s+[A-ZÀ-Ý]{2,}){1,6})\s*,([\s\S]*)$/.exec(bloco);
  if (!mRepr) return null; // sem representante identificado, não dá pra montar a declaração

  const conectorRepresentante = (mRepr[1] || '').trim();
  const cargoRepresentante = (mRepr[2] || '').trim();
  const nomeRepresentante = mRepr[3].trim();
  const restoAposRepresentante = mRepr[4];

  // reaproveita o padrão principal de pessoa física pra qualificar o representante
  // (nacionalidade, estado civil, profissão, RG/RNM, OE/UF, CPF). Quando há mais de um
  // representante listado (ex.: "seus sócios 1) FULANO...; 2) CICLANA..."), só o primeiro
  // é preenchido automaticamente — os demais precisam ser adicionados manualmente
  const textoRepresentante = nomeRepresentante + ',' + restoAposRepresentante;
  const pessoasRepresentante = extrairPessoasDoBloco(textoRepresentante);
  const representante = pessoasRepresentante.length ? pessoasRepresentante[0] : { nome: nomeRepresentante };
  const multiplosRepresentantes = pessoasRepresentante.length > 1;

  let enderecoRepresentante = '';
  const mResid = /residente\s+n[ao]\s+([\s\S]+)$/i.exec(restoAposRepresentante.trim());
  if (mResid) {
    enderecoRepresentante = mResid[1].trim()
      .replace(/\s*\d{1,3}\)\s*$/, '')
      .replace(/\.\s*$/, '')
      .trim();
    // se houver mais de um representante, o texto residual inclui a qualificação dos
    // demais — corta no primeiro ";" ou "2)" pra pegar só o endereço do 1º representante
    enderecoRepresentante = enderecoRepresentante.split(/;|\s\d\)/)[0].trim();
  }

  return {
    nome: nomeEmpresa,
    naturezaJuridica,
    atividadeEconomica,
    nire,
    cnpj,
    enderecoSede,
    cargoRepresentante,
    conectorRepresentante,
    enderecoRepresentante,
    representante,
    multiplosRepresentantes
  };
}

function extrairPessoasDoBloco(bloco) {
  const pessoas = [];
  const chavesVistas = new Set();

  // nem todo contrato menciona o estado civil na qualificação (às vezes pula direto pra
  // profissão), e alguns usam "Registro Geral" em vez de "Cédula de Identidade", às vezes
  // sem RG separado do CPF — por isso estado civil e RG são opcionais aqui.
  // A nacionalidade é capturada de forma genérica (não só "brasileiro/a") para reconhecer
  // estrangeiros, e o tipo de documento aceita tanto RG/Registro Geral quanto a Carteira de
  // Registro Nacional Migratório (RNM), usada por estrangeiros. O órgão emissor/UF (ex.:
  // "RG/SSP/SP", "RG/SESP/PR") também é capturado quando presente, logo após o tipo de documento.
  // IMPORTANTE: sem a flag "i" aqui de propósito — comparar sem diferenciar maiúscula/minúscula
  // faria palavras minúsculas (como "seu marido") contarem como parte do nome em CAIXA ALTA
  const regexPrincipal = /([A-ZÀ-Ý]{2,}(?:\s+[A-ZÀ-Ý]{2,}){1,6})\s*,\s*([a-zà-ÿ]+)\s*,\s*(?:([Ss]olteir[oa]|[Cc]asad[oa]|[Dd]ivorciad[oa]|[Vv]i[úu]v[oa]|[Ss]eparad[oa](?:\s+judicialmente)?|(?:em\s+)?uni[ãa]o\s+est[áa]vel)\s*,\s*)?([^,]+?)\s*,\s*[Pp]ortador[a]?\s+d[ao]\s+((?:[Cc][ée]dula\s+de\s+[Ii]dentidade|[Rr]egistro\s+[Gg]eral)|(?:[Cc]arteira\s+de\s+[Rr]egistro\s+[Nn]acional\s+[Mm]igrat[óo]rio(?:\s*\(?RNM\)?)?))(?:\s*RG\s*\/\s*([A-Za-zÀ-ÿ]{2,8}\s*\/\s*[A-Za-zÀ-ÿ]{2}))?(?:(?:(?!CPF)[^\d]){0,30}?(?=[A-Za-z0-9.\-\/]*\d)([A-Za-z0-9][A-Za-z0-9.\-\/]{3,15}[A-Za-z0-9]))?(?:[^\d]{0,60}(\d{3}\.\d{3}\.\d{3}-\d{2}))?/g;
  let m;
  while ((m = regexPrincipal.exec(bloco)) !== null) {
    const nome = m[1].trim();
    let cpf = m[8] || '';
    let rg = m[7] || '';
    // quando não há RG separado do CPF (ex.: "portador do Registro Geral - CPF nº X"),
    // o padrão genérico às vezes captura esse número como se fosse "RG" — se o que foi
    // capturado como RG tem exatamente o formato de CPF e não sobrou CPF nenhum, é o CPF
    if (rg && !cpf && /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(rg)) {
      cpf = rg;
      rg = '';
    }
    // sem CPF (acontece às vezes com estrangeiros, cujo RNM já basta como documento no
    // contrato), usa nome + RG como chave alternativa pra não perder nem duplicar a pessoa
    const chave = cpf || (nome + '|' + rg);
    if (chavesVistas.has(chave)) continue;
    chavesVistas.add(chave);
    const textoAntes = bloco.slice(Math.max(0, m.index - 20), m.index);
    const nacionalidadeTxt = m[2].toLowerCase();
    const ehBrasileiro = /^brasileir[oa]$/.test(nacionalidadeTxt);
    const tipoDoc = m[5] || '';
    const estrangeiro = !ehBrasileiro || /migrat[óo]rio/i.test(tipoDoc);
    pessoas.push({
      nome: nome,
      sexo: /a$/i.test(m[2]) ? 'F' : 'M',
      estadoCivil: m[3] ? mapearEstadoCivil(m[3]) : '',
      profissao: m[4].trim(),
      rg: rg,
      oeUf: (m[6] || '').replace(/\s+/g, ''),
      cpf: cpf,
      estrangeiro: estrangeiro,
      nacionalidade: estrangeiro ? nacionalidadeTxt : '',
      viaConjuge: /(sua\s+mulher|seu\s+marido)\s*$/i.test(textoAntes)
    });
  }

  // cônjuge citado como "e sua mulher/seu marido NOME, nacionalidade, profissão, portador..."
  // (comum quando os dois são casados entre si) — não repete estado civil, então assume "casado"
  const regexConjuge = /(?:sua\s+mulher|seu\s+marido)\s+([A-ZÀ-Ý]{2,}(?:\s+[A-ZÀ-Ý]{2,}){1,6})\s*,\s*([a-zà-ÿ]+)\s*,\s*([^,]+?)\s*,\s*[Pp]ortador[a]?\s+d[ao]\s+((?:[Cc][ée]dula\s+de\s+[Ii]dentidade|[Rr]egistro\s+[Gg]eral)|(?:[Cc]arteira\s+de\s+[Rr]egistro\s+[Nn]acional\s+[Mm]igrat[óo]rio(?:\s*\(?RNM\)?)?))(?:\s*RG\s*\/\s*([A-Za-zÀ-ÿ]{2,8}\s*\/\s*[A-Za-zÀ-ÿ]{2}))?(?:(?:(?!CPF)[^\d]){0,30}?(?=[A-Za-z0-9.\-\/]*\d)([A-Za-z0-9][A-Za-z0-9.\-\/]{3,15}[A-Za-z0-9]))?(?:[^\d]{0,60}(\d{3}\.\d{3}\.\d{3}-\d{2}))?/g;
  while ((m = regexConjuge.exec(bloco)) !== null) {
    const nomeConjuge = m[1].trim();
    let cpf = m[7] || '';
    let rg = m[6] || '';
    if (rg && !cpf && /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(rg)) {
      cpf = rg;
      rg = '';
    }
    const chave = cpf || (nomeConjuge + '|' + rg);
    if (chavesVistas.has(chave)) continue;
    chavesVistas.add(chave);
    const nacionalidadeTxt = m[2].toLowerCase();
    const ehBrasileiro = /^brasileir[oa]$/.test(nacionalidadeTxt);
    const tipoDoc = m[4] || '';
    const estrangeiro = !ehBrasileiro || /migrat[óo]rio/i.test(tipoDoc);
    pessoas.push({
      nome: nomeConjuge,
      sexo: /a$/i.test(m[2]) ? 'F' : 'M',
      estadoCivil: 'casado',
      profissao: m[3].trim(),
      rg: rg,
      oeUf: (m[5] || '').replace(/\s+/g, ''),
      cpf: cpf,
      estrangeiro: estrangeiro,
      nacionalidade: estrangeiro ? nacionalidadeTxt : '',
      viaConjuge: true
    });
  }

  return pessoas;
}

// quando a 1ª pessoa não tem estado civil e a 2ª foi encontrada via "seu marido/sua mulher",
// entende-se que são casados entre si — nesse caso, tenta achar também o regime de bens e a
// data do casamento mencionados perto (ex.: "casados sob o regime da comunhão parcial de bens
// no dia 18/10/2013")
function detectarCasadosEntreSi(pessoas, bloco) {
  if (pessoas.length !== 2) return { casadosEntreSi: false, regimeBens: '', dataCasamento: '' };
  const casadosEntreSi = !pessoas[0].estadoCivil && pessoas[1].viaConjuge;
  if (!casadosEntreSi) return { casadosEntreSi: false, regimeBens: '', dataCasamento: '' };

  let regimeBens = '';
  const mRegime = /regime\s+d[ae]\s+(comunh[ãa]o\s+parcial\s+de\s+bens|comunh[ãa]o\s+universal\s+de\s+bens|separa[çc][ãa]o\s+total\s+de\s+bens)/i.exec(bloco);
  if (mRegime) {
    const chave = mRegime[1].toLowerCase();
    if (chave.includes('parcial')) regimeBens = 'comunhao_parcial';
    else if (chave.includes('universal')) regimeBens = 'comunhao_universal';
    else if (chave.includes('separa')) regimeBens = 'separacao_total';
  }

  let dataCasamento = '';
  const mData = /(?:no\s+dia|desde|em)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(bloco);
  if (mData) dataCasamento = mData[1];

  return { casadosEntreSi, regimeBens, dataCasamento };
}

// endereço do imóvel: procura o quadro "IMÓVEL" que tenha "ENDEREÇO" por perto
// (evita pegar uma menção genérica a "imóvel" no cabeçalho do contrato)
function extrairEndereco(texto) {
  const regexImovel = /IM[OÓ]VEL/gi;
  let m0;
  while ((m0 = regexImovel.exec(texto)) !== null) {
    const janela = texto.slice(m0.index, m0.index + 500);
    if (!/ENDERE[ÇC]O/i.test(janela)) continue;
    const m = /ENDERE[ÇC]O[\s\-:]{0,15}([\s\S]{5,250}?)(?:-{3,}|MATR[IÍ]CULA|TRANSCRI[ÇC][ÃA]O|INSCRI[ÇC][ÃA]O\s+MUNICIPAL|FIM\s*\/?\s*DESTINA|DESTINA[ÇC][ÃA]O|VALOR\s+DO\s+ALUGUEL|PRAZO\s+DA|VIG[ÊE]NCIA|CL[ÁA]USULA|$)/i.exec(janela);
    if (m) {
      return m[1].replace(/\s+/g, ' ').trim().replace(/[.:;\-\s]+$/, '');
    }
  }
  return '';
}

function analisarTextoContrato(textoOriginal) {
  const texto = normalizarEspacamentoLetras(textoOriginal.replace(/\s+/g, ' '));

  const blocoLocatario = extrairBlocoLocatario(texto);

  // primeiro tenta reconhecer Pessoa Jurídica (empresa + representante); só se não
  // achar é que tenta o caminho normal de pessoa física
  const empresa = blocoLocatario ? extrairEmpresaDoBloco(blocoLocatario) : null;

  let pessoas = [];
  let usouFallback = false;

  if (!empresa) {
    pessoas = blocoLocatario ? extrairPessoasDoBloco(blocoLocatario) : [];
    if (pessoas.length === 0) {
      // não achei o quadro do locatário — tenta no documento inteiro (pode trazer outras partes)
      pessoas = extrairPessoasDoBloco(texto);
      usouFallback = pessoas.length > 0;
    }
  }

  const endereco = extrairEndereco(texto);
  const { casadosEntreSi, regimeBens, dataCasamento } = detectarCasadosEntreSi(pessoas, blocoLocatario || texto);

  // data do contrato: usa a última data mencionada no documento (normalmente perto da assinatura)
  const datasEncontradas = [];
  const regexDataNumerica = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  let matchData;
  while ((matchData = regexDataNumerica.exec(texto)) !== null) {
    datasEncontradas.push({
      index: matchData.index,
      iso: matchData[3] + '-' + matchData[2].padStart(2, '0') + '-' + matchData[1].padStart(2, '0')
    });
  }
  const mesesMap = { janeiro:1, fevereiro:2, 'março':3, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
  const regexDataExtenso = /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{1,2}\.?\d{3})\b/gi;
  while ((matchData = regexDataExtenso.exec(texto)) !== null) {
    const mesNum = mesesMap[matchData[2].toLowerCase()];
    const anoLimpo = matchData[3].replace('.', '');
    datasEncontradas.push({
      index: matchData.index,
      iso: anoLimpo + '-' + String(mesNum).padStart(2, '0') + '-' + matchData[1].padStart(2, '0')
    });
  }
  datasEncontradas.sort((a, b) => a.index - b.index);
  const dataContrato = datasEncontradas.length ? datasEncontradas[datasEncontradas.length - 1].iso : '';

  return { pessoas, dataContrato, endereco, usouFallback, casadosEntreSi, regimeBens, dataCasamento, empresa };
}

async function lerArquivoContrato(arquivo) {
  const nome = arquivo.name.toLowerCase();
  let texto = '';
  if (nome.endsWith('.pdf')) {
    const pdf = await window.pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const pags = [];
    for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); pags.push(reconstruirTextoPagina((await p.getTextContent()).items)); }
    texto = pags.join('\n');
    if (!texto.replace(/\s/g, '')) throw new Error('Esse PDF parece ser uma imagem escaneada (sem texto). Preencha os dados à mão.');
  } else if (nome.endsWith('.docx')) {
    texto = (await window.mammoth.extractRawText({ arrayBuffer: await arquivo.arrayBuffer() })).value;
  } else if (nome.endsWith('.doc')) {
    throw new Error('Arquivo .doc antigo não é lido no navegador: abra no Word e salve como .docx ou PDF.');
  } else throw new Error('Envie um arquivo .pdf ou .docx.');
  return analisarTextoContrato(texto);
}
window.LerContrato = { lerArquivo: lerArquivoContrato, analisar: analisarTextoContrato, tituloCase: tituloCase };
})();

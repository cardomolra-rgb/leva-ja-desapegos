/**
 * Gerador de PDF mínimo (texto simples, A4, Helvetica, WinAnsi) — suficiente para o comprovante de aceite.
 * Sem dependências: o comprovante tem que sair mesmo se um pacote externo mudar.
 */
function winAnsi(s: string): number[] {
  const mapa: Record<string, number> = { "—": 0x97, "–": 0x96, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "•": 0x95, "€": 0x80 };
  return Array.from(s).map((c) => mapa[c] ?? (c.charCodeAt(0) <= 0xff ? c.charCodeAt(0) : 0x3f));
}

function escapar(bytes: number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  return out;
}

function quebrar(texto: string, max = 92): string[] {
  const linhas: string[] = [];
  for (const par of texto.split("\n")) {
    let atual = "";
    for (const p of par.split(" ")) {
      if ((atual + " " + p).trim().length > max) {
        linhas.push(atual);
        atual = p;
      } else atual = (atual + " " + p).trim();
    }
    linhas.push(atual);
  }
  return linhas;
}

export function gerarPdfTexto(titulo: string, corpo: string): Uint8Array {
  const linhas = quebrar(corpo);
  const porPagina = 56;
  const paginas: string[][] = [];
  for (let i = 0; i < linhas.length; i += porPagina) paginas.push(linhas.slice(i, i + porPagina));
  if (!paginas.length) paginas.push([]);

  const partes: number[][] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const add = (b: number[]) => { partes.push(b); tamanho += b.length; };
  const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
  const obj = (n: number, conteudo: number[]) => { offsets[n] = tamanho; add([...ascii(`${n} 0 obj\n`), ...conteudo, ...ascii("\nendobj\n")]); };

  add(ascii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  const nPag = paginas.length;
  const idsPag = paginas.map((_, i) => 4 + i * 2);
  obj(1, ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, ascii(`<< /Type /Pages /Kids [${idsPag.map((i) => `${i} 0 R`).join(" ")}] /Count ${nPag} >>`));
  obj(3, ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  paginas.forEach((pag, i) => {
    const conteudo: number[] = [];
    conteudo.push(...ascii("BT /F1 15 Tf 50 800 Td ("), ...escapar(winAnsi(i === 0 ? titulo : `${titulo} (cont.)`)), ...ascii(") Tj ET\n"));
    pag.forEach((l, j) => {
      conteudo.push(...ascii(`BT /F1 10 Tf 50 ${770 - j * 13} Td (`), ...escapar(winAnsi(l)), ...ascii(") Tj ET\n"));
    });
    obj(idsPag[i], ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idsPag[i] + 1} 0 R >>`));
    obj(idsPag[i] + 1, [...ascii(`<< /Length ${conteudo.length} >>\nstream\n`), ...conteudo, ...ascii("endstream")]);
  });
  const total = 4 + nPag * 2;
  const xref = tamanho;
  let tabela = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) tabela += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  add(ascii(`${tabela}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return Uint8Array.from(partes.flat());
}

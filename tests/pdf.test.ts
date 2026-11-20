import { describe, expect, it } from "vitest";
import { gerarPdfTexto } from "@/lib/pdf";

describe("PDF de aceite", () => {
  it("gera um PDF válido com acentos e várias páginas", () => {
    const corpo = Array.from({ length: 130 }, (_, i) => `Linha ${i} — ação, preço, atenção “aspas” (parênteses)`).join("\n");
    const pdf = gerarPdfTexto("Comprovante", corpo);
    const txt = Buffer.from(pdf).toString("latin1");
    expect(txt.startsWith("%PDF-1.4")).toBe(true);
    expect(txt.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(txt).toContain("/Count 3");
    expect(txt).toContain("a\xE7\xE3o"); // "ação" em WinAnsi
    // xref aponta para o início de cada objeto
    const inicioXref = Number(txt.match(/startxref\n(\d+)/)![1]);
    expect(txt.slice(inicioXref, inicioXref + 4)).toBe("xref");
    const off = txt.slice(inicioXref).split("\n")[3].slice(0, 10);
    expect(txt.slice(Number(off), Number(off) + 7)).toBe("1 0 obj");
  });
});

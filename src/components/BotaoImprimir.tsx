"use client";

export function BotaoImprimir({ aoImprimir, rotulo = "Imprimir etiqueta" }: { aoImprimir?: () => Promise<void>; rotulo?: string }) {
  return (
    <button
      className="botao bloco escuro nao-imprimir"
      type="button"
      onClick={async () => {
        window.print();
        if (aoImprimir) await aoImprimir();
      }}
    >
      🖨 {rotulo}
    </button>
  );
}

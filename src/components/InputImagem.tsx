"use client";
import { reduzirArquivosDoInput } from "@/lib/imagem-cliente";

/** Input de foto que já reduz a imagem no celular antes de enviar. */
export function InputImagem(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="file"
      {...props}
      onChange={async (e) => {
        await reduzirArquivosDoInput(e.currentTarget);
        props.onChange?.(e);
      }}
    />
  );
}

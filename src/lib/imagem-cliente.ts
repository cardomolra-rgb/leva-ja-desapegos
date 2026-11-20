"use client";

/**
 * Reduz fotos no próprio celular antes do envio (máx. 1600 px, JPEG 80%).
 * Uma foto de 4–8 MB vira ~300 KB: o envio fica rápido no 4G e cabe no limite da Vercel (4,5 MB por requisição).
 */
export async function comprimirImagem(arquivo: File, lado = 1600, qualidade = 0.8): Promise<File> {
  if (!arquivo.type.startsWith("image/") || arquivo.type === "image/gif") return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    return new File([blob], arquivo.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return arquivo; // formato que o navegador não decodifica (ex.: HEIC em alguns Androids): envia como está
  }
}

/** Use no onChange de um <input type="file">: troca os arquivos escolhidos pelas versões reduzidas. */
export async function reduzirArquivosDoInput(input: HTMLInputElement): Promise<File[]> {
  const originais = Array.from(input.files ?? []);
  const reduzidos = await Promise.all(originais.map((f) => comprimirImagem(f)));
  const dt = new DataTransfer();
  reduzidos.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  return reduzidos;
}

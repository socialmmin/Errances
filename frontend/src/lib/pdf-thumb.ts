// Renders page 1 of a PDF (File or URL) to a PNG data URL for the WhatsApp preview.
export async function renderPdfFirstPage(source: File | string | ArrayBuffer, width = 420): Promise<{ img: string; pages: number }> {
  // @ts-ignore -- no bundled types for the CJS build
  const pdfjs: any = await import('pdfjs-dist/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
  const data = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return { img: canvas.toDataURL('image/jpeg', 0.85), pages: doc.numPages };
}

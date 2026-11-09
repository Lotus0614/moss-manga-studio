// 导出：单张长图 / PDF。
// 全部在浏览器里做，不占服务器算力，也不需要装 canvas。

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${src}`));
    img.src = src;
  });
}

/** 收集可导出的页面：每页一张图，按页码排序 */
export function pagesWithImages(items) {
  return (items || [])
    .filter((it) => it?.image)
    .map((it) => ({ image: it.image, index: it.index, title: it.title }))
    .sort((a, b) => (a.index || 0) - (b.index || 0));
}

/**
 * 按页码范围挑页（两端都含）。from / to 是页码，不是数组下标。
 * 范围反了（from > to）就换成升序，缺省端用实际首尾页补。
 */
export function pagesInRange(pages, from, to) {
  const list = (pages || []).filter((it) => it && Number.isFinite(Number(it.index)));
  if (!list.length) return [];
  const indexes = list.map((it) => Number(it.index));
  const low = Number.isFinite(Number(from)) ? Number(from) : Math.min(...indexes);
  const high = Number.isFinite(Number(to)) ? Number(to) : Math.max(...indexes);
  const [start, end] = low <= high ? [low, high] : [high, low];
  return list.filter((it) => Number(it.index) >= start && Number(it.index) <= end);
}

/** 竖向拼接成一张长图 */
export async function exportLongImage(pages, name = 'chapter') {
  const items = pagesWithImages(pages);
  if (!items.length) throw new Error('还没有生成任何图片');
  const images = await Promise.all(items.map((it) => loadImage(it.image)));
  const width = Math.max(...images.map((img) => img.naturalWidth));
  const height = images.reduce((sum, img) => sum + img.naturalHeight, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const img of images) {
    const x = Math.round((width - img.naturalWidth) / 2);
    ctx.drawImage(img, x, y);
    y += img.naturalHeight;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  download(blob, `${name}-long.png`);
  return { width, height, pages: images.length };
}

/** 每页一张的 PDF，用 JPEG + DCTDecode 直接嵌，不压缩图片 */
export async function exportPdf(pages, name = 'chapter') {
  const items = pagesWithImages(pages);
  if (!items.length) throw new Error('还没有生成任何图片');
  const images = await Promise.all(items.map((it) => loadImage(it.image)));

  const jpegs = [];
  for (const img of images) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    jpegs.push({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  }

  const pdf = buildPdf(jpegs, name);
  download(new Blob([pdf], { type: 'application/pdf' }), `${name}.pdf`);
  return { pages: jpegs.length };
}

/**
 * 最小可用的 PDF 生成器：一页一张图，DCTDecode 直嵌 JPEG。
 * 对象编号：1 catalog、2 pages，之后每页依次是 page / content / image。
 * 导出出来是为了能在 Node 里单测结构（见 tools/test-export.mjs）。
 */
export function buildPdf(jpegs, title) {
  const enc = new TextEncoder();
  const chunks = [];
  let size = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
    return bytes.length;
  };
  const offsets = [];

  const pageObj = (i) => 3 + i * 3;
  const contentObj = (i) => 4 + i * 3;
  const imageObj = (i) => 5 + i * 3;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const beginObj = (num) => {
    offsets[num] = size;
    push(`${num} 0 obj\n`);
  };
  const endObj = () => push('endobj\n');

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObj();

  beginObj(2);
  const kids = jpegs.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${jpegs.length} >>\n`);
  endObj();

  jpegs.forEach((jpg, i) => {
    beginObj(pageObj(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${jpg.width} ${jpg.height}] ` +
        `/Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> >> /Contents ${contentObj(i)} 0 R >>\n`
    );
    endObj();

    const stream = `q ${jpg.width} 0 0 ${jpg.height} 0 0 cm /Im0 Do Q`;
    beginObj(contentObj(i));
    push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\n`);
    endObj();

    beginObj(imageObj(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${jpg.width} /Height ${jpg.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.bytes.length} >>\nstream\n`
    );
    push(jpg.bytes);
    push('\nendstream\n');
    endObj();
  });

  const total = offsets.length;
  const xrefStart = size;
  push(`xref\n0 ${total}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i < total; i += 1) {
    push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info << /Title (${escapePdfText(title)}) >> >>\n`);
  push(`startxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function escapePdfText(text) {
  return String(text || '').replace(/[\\()]/g, (m) => `\\${m}`).slice(0, 120);
}

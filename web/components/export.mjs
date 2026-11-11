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

/** 每页一张的 PDF。密码可选；给了就用 PDF 标准安全处理器加密。 */
export async function exportPdf(pages, name = 'chapter', { password = '' } = {}) {
  const items = pagesWithImages(pages);
  if (!items.length) throw new Error('还没有生成任何图片');
  const jsPDF = await loadJsPdf();
  const images = [];
  for (const it of items) {
    const img = await loadImage(it.image);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    images.push({ data: canvas.toDataURL('image/jpeg', 0.94), width: img.naturalWidth, height: img.naturalHeight });
  }
  const bytes = buildPdfJs(jsPDF, images, { title: name, password: password.trim() });
  download(new Blob([bytes], { type: 'application/pdf' }), `${name}.pdf`);
  return { pages: images.length, encrypted: Boolean(password.trim()) };
}

// ---------------------------------------------------------------- PDF（jsPDF）
// PDF 交给 jsPDF：一份自包含的 UMD 包，只在真正导出 PDF 时才拉，平时不影响首屏。
// jsPDF 的加密是 PDF 标准安全处理器 V1/R2（RC4 40 位）——能挡住随手打开，
// 挡不住有意破解，这个限制在导出弹窗里也写明了。

let jsPdfLoader = null;

/** 懒加载 jsPDF，返回 jsPDF 构造函数 */
export function loadJsPdf() {
  if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
  if (jsPdfLoader) return jsPdfLoader;
  jsPdfLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/jspdf.umd.min.js';
    script.async = true;
    script.onload = () => {
      const ctor = globalThis.jspdf?.jsPDF;
      if (ctor) resolve(ctor);
      else reject(new Error('jsPDF 加载完成但没挂上全局，看看 web/vendor/jspdf.umd.min.js'));
    };
    script.onerror = () => {
      jsPdfLoader = null; // 允许下次重试
      reject(new Error('jsPDF 加载失败：/vendor/jspdf.umd.min.js'));
    };
    document.head.appendChild(script);
  });
  return jsPdfLoader;
}

/**
 * 纯函数：给一个 jsPDF 构造函数和已编码的图片，产出 PDF 字节。
 * 拆出来是为了能在 Node 里单测（tools/test-export.mjs），不碰 canvas / DOM。
 * images: [{ data: 'data:image/jpeg;base64,...', width, height }]
 */
export function buildPdfJs(jsPDF, images, { title = '', password = '' } = {}) {
  if (!images?.length) throw new Error('没有可导出的页面');
  if (password && /[^\x20-\x7E]/.test(password)) {
    // jsPDF 把口令当字节串处理，中文会算出错误的密钥，打开时直接报密码错
    throw new Error('PDF 密码只能用英文、数字和符号');
  }
  const first = images[0];
  const doc = new jsPDF({
    unit: 'pt',
    format: [first.width, first.height],
    ...(password
      ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ['print'] } }
      : {}),
  });
  if (title) doc.setProperties({ title });
  images.forEach((image, index) => {
    if (index > 0) doc.addPage([image.width, image.height]);
    doc.addImage(image.data, 'JPEG', 0, 0, image.width, image.height);
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

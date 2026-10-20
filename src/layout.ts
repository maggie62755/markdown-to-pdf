export interface Layout {
  paperSize: 'A4' | 'A5' | 'Letter' | 'Legal';
  orientation: 'portrait' | 'landscape';
  fontSize: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  pageNumbers: boolean;
  pageNumberStyle: 'current-total' | 'current' | 'page-of-total';
  inlineCodeBackground: string;
  inlineCodeColor: string;
}
export const defaultLayout: Layout = {
  paperSize: 'A4',
  orientation: 'portrait',
  fontSize: 11,
  marginTop: 22,
  marginBottom: 24,
  marginLeft: 18,
  marginRight: 18,
  pageNumbers: true,
  pageNumberStyle: 'current-total',
  inlineCodeBackground: '#f1f3f5',
  inlineCodeColor: '#172b4d',
};
export function resolveLayout(get: (key: string) => unknown): Layout {
  const result = { ...defaultLayout };
  for (const key of Object.keys(result) as (keyof Layout)[]) {
    const value = get(key);
    if (typeof result[key] === 'number') {
      const min = key === 'fontSize' ? 8 : 5;
      const max = key === 'fontSize' ? 24 : 40;
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max
      )
        Object.assign(result, { [key]: value });
    } else if (key === 'pageNumbers') {
      if (typeof value === 'boolean') result[key] = value;
    } else if (key === 'inlineCodeBackground' || key === 'inlineCodeColor') {
      if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value))
        result[key] = value;
    } else {
      const allowed =
        key === 'paperSize'
          ? ['A4', 'A5', 'Letter', 'Legal']
          : key === 'orientation'
            ? ['portrait', 'landscape']
            : ['current-total', 'current', 'page-of-total'];
      if (typeof value === 'string' && allowed.includes(value))
        Object.assign(result, { [key]: value });
    }
  }
  return result;
}
export function contentSize(layout: Layout) {
  const sizes = {
    A4: [210, 297],
    A5: [148, 210],
    Letter: [215.9, 279.4],
    Legal: [215.9, 355.6],
  };
  const [short, long] = sizes[layout.paperSize];
  const [width, height] =
    layout.orientation === 'landscape' ? [long, short] : [short, long];
  return {
    width: width - layout.marginLeft - layout.marginRight,
    height: height - layout.marginTop - layout.marginBottom,
  };
}
export function layoutCss(layout: Layout) {
  return `body{--page-content-height:${contentSize(layout).height}mm;font-size:${layout.fontSize}pt}body :not(pre)>code{background:${layout.inlineCodeBackground};color:${layout.inlineCodeColor}}img,.mermaid svg{max-height:var(--page-content-height)}`;
}
export function footer(layout: Layout) {
  const current = '<span class="pageNumber"></span>';
  const total = '<span class="totalPages"></span>';
  const text =
    layout.pageNumberStyle === 'current'
      ? current
      : layout.pageNumberStyle === 'page-of-total'
        ? `Page ${current} of ${total}`
        : `${current} / ${total}`;
  return `<div style="width:100%;text-align:center;font-size:9px;color:#666">${text}</div>`;
}

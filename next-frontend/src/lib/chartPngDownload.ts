/**
 * Export the visible Recharts SVG as PNG. Targets `svg.recharts-surface` so we skip
 * decorative/action SVGs and match on-screen chart geometry (not CSS-scaled rects).
 */
async function chartSvgElementToPngDataUrl(
  svg: SVGSVGElement,
  opts?: { maxSidePx?: number },
): Promise<string> {
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 2;
  const cssRect = svg.getBoundingClientRect();
  /** Prefer how the chart is actually drawn on screen (matches deck preview). */
  let width = Math.max(1, Math.round(cssRect.width * dpr));
  let height = Math.max(1, Math.round(cssRect.height * dpr));

  // Off-screen or not laid out yet — fall back to SVG internal dimensions.
  if (width < 8 || height < 8) {
    const wAttr = svg.getAttribute("width");
    const hAttr = svg.getAttribute("height");
    const parsedW = wAttr ? parseFloat(wAttr) : NaN;
    const parsedH = hAttr ? parseFloat(hAttr) : NaN;
    if (Number.isFinite(parsedW) && Number.isFinite(parsedH) && parsedW > 0 && parsedH > 0) {
      width = Math.round(parsedW);
      height = Math.round(parsedH);
    } else {
      const vb = svg.getAttribute("viewBox");
      if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (
          parts.length === 4 &&
          parts.every((n) => Number.isFinite(n)) &&
          (parts[2] as number) > 0 &&
          (parts[3] as number) > 0
        ) {
          width = Math.round(parts[2] as number);
          height = Math.round(parts[3] as number);
        }
      }
    }
  }

  const maxSide = opts?.maxSidePx ?? 2048;
  const maxDim = Math.max(width, height);
  if (maxDim > maxSide) {
    const scale = maxSide / maxDim;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const vbExisting = svg.getAttribute("viewBox");
  if (vbExisting) cloned.setAttribute("viewBox", vbExisting);
  else cloned.setAttribute("viewBox", `0 0 ${width} ${height}`);
  cloned.setAttribute("width", String(width));
  cloned.setAttribute("height", String(height));

  const svgText = new XMLSerializer().serializeToString(cloned);
  const img = new Image();
  img.decoding = "async";
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to render chart image."));
    img.src = svgDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}

function findChartSvg(root: Element | null): SVGSVGElement | null {
  if (!root) return null;
  const surfaces = root.querySelectorAll("svg.recharts-surface");
  if (surfaces.length > 1) {
    let best: SVGSVGElement | null = null;
    let bestArea = 0;
    surfaces.forEach((n) => {
      const el = n as SVGSVGElement;
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > bestArea && r.width >= 2 && r.height >= 2) {
        bestArea = a;
        best = el;
      }
    });
    if (best) return best;
  }
  const one = root.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (one) return one;
  return (root.querySelector(".recharts-wrapper svg") as SVGSVGElement | null) ?? null;
}

/** Wait until Recharts has painted (non-zero size) — use before PNG export. */
export async function waitForChartSvgInElement(root: Element | null, timeoutMs = 3000): Promise<SVGSVGElement | null> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  while (true) {
    const svg = findChartSvg(root);
    if (svg) {
      const r = svg.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) return svg;
    }
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
    if (elapsed >= timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** PNG from any element that contains a Recharts surface (e.g. slide overlay). */
export async function chartElementToPngDataUrl(root: Element | null, opts?: { maxSidePx?: number }): Promise<string> {
  const svg = findChartSvg(root);
  if (!svg) throw new Error("Chart SVG not found.");
  return chartSvgElementToPngDataUrl(svg, opts);
}

async function chartSvgInContainerToPngDataUrl(containerId: string): Promise<string> {
  const root = document.getElementById(containerId);
  const svg = findChartSvg(root);
  if (!svg) throw new Error("Chart SVG not found.");
  return chartSvgElementToPngDataUrl(svg, { maxSidePx: 2048 });
}

/** PNG data URL for persisting charts on slides / PPTX export (backend resolves data URLs to temp files). */
export async function chartContainerToPngDataUrl(containerId: string): Promise<string> {
  return chartSvgInContainerToPngDataUrl(containerId);
}

export async function downloadChartAsPng(containerId: string, fileNameBase: string) {
  const pngUrl = await chartSvgInContainerToPngDataUrl(containerId);
  const a = document.createElement("a");
  a.href = pngUrl;
  a.download = `${fileNameBase.replace(/[<>:"/\\|?*]+/g, "_") || "chart"}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

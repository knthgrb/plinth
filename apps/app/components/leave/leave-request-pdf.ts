"use client";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const MODERN_COLOR_FN = /lab\(|oklch\(|lch\(|color-mix\(/i;

function shouldCopyCssProperty(name: string, value: string): boolean {
  if (name.startsWith("--")) return false;
  if (MODERN_COLOR_FN.test(value)) return false;
  return true;
}

/**
 * html2canvas cannot parse Tailwind v4 / modern CSS that uses `lab()` etc. in stylesheets.
 * Copy resolved computed styles onto the clone, then remove global stylesheets from the clone
 * so the rasterizer only sees safe inline values (typically rgb/hex).
 */
function inlineComputedStylesOntoClone(
  originalRoot: HTMLElement,
  cloneRoot: HTMLElement,
) {
  const originals = [
    originalRoot,
    ...Array.from(originalRoot.querySelectorAll<HTMLElement>("*")),
  ];
  const clones = [
    cloneRoot,
    ...Array.from(cloneRoot.querySelectorAll<HTMLElement>("*")),
  ];
  const len = Math.min(originals.length, clones.length);
  for (let i = 0; i < len; i++) {
    const source = originals[i];
    const target = clones[i];
    const cs = window.getComputedStyle(source);
    const style = target.style;
    style.cssText = "";
    for (let j = 0; j < cs.length; j++) {
      const name = cs.item(j);
      if (!name) continue;
      const value = cs.getPropertyValue(name);
      const priority = cs.getPropertyPriority(name);
      if (!value || !shouldCopyCssProperty(name, value)) continue;
      try {
        style.setProperty(name, value, priority || undefined);
      } catch {
        // Ignore properties the clone cannot accept
      }
    }
  }
}

function stripGlobalStylesFromClone(clonedDoc: Document) {
  clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach((el) => el.remove());
  clonedDoc.querySelectorAll("style").forEach((el) => el.remove());
}

async function buildPdfFromElement(element: HTMLElement) {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    onclone: (clonedDoc, clonedElement) => {
      const cloneRoot =
        clonedElement ??
        (clonedDoc.querySelector("[data-pdf-capture-root]") as HTMLElement | null);
      if (!cloneRoot) return;
      inlineComputedStylesOntoClone(element, cloneRoot);
      stripGlobalStylesFromClone(clonedDoc);
      cloneRoot.style.backgroundColor = "#ffffff";
      cloneRoot.style.color = "#111111";
    },
  });

  const imageData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imageWidth = pageWidth;
  const imageHeight = (canvas.height * imageWidth) / canvas.width;

  let remainingHeight = imageHeight;
  let yOffset = 0;

  pdf.addImage(imageData, "PNG", 0, yOffset, imageWidth, imageHeight);
  remainingHeight -= pageHeight;

  while (remainingHeight > 0) {
    yOffset -= pageHeight;
    pdf.addPage();
    pdf.addImage(imageData, "PNG", 0, yOffset, imageWidth, imageHeight);
    remainingHeight -= pageHeight;
  }

  return pdf;
}

export async function getElementPdfBlob(element: HTMLElement) {
  const pdf = await buildPdfFromElement(element);
  return pdf.output("blob");
}

export async function downloadElementAsPdf(
  element: HTMLElement,
  fileName: string,
) {
  const pdf = await buildPdfFromElement(element);
  pdf.save(fileName);
}

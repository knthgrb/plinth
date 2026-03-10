"use client";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

async function buildPdfFromElement(element: HTMLElement) {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
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

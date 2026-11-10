// Harness stand-in for the pdf.js page renderer: returns one tiny synthetic image so the in-page preview state can be shown.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export async function renderPages() {
  return [{ mime: "image/png" as const, base64: PNG_1X1 }];
}

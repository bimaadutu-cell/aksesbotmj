import sharp from "sharp";

function escXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function makeBratSticker(text: string): Promise<Buffer> {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120) || "brat";
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > 15 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  const fin = lines.slice(0, 6);
  const size = fin.length <= 3 ? 58 : 48;
  const lineHeight = size + 12;
  const startY = 256 - ((fin.length - 1) * lineHeight) / 2 + size * 0.34;
  const textSvg = fin.map((line, i) =>
    `<text x="256" y="${startY + i * lineHeight}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#000000">${escXml(line)}</text>`
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#ffffff"/>${textSvg}</svg>`;

  // WhatsApp + Telegram static stickers should be WEBP. PNG was the main
  // reason the old /brat path could produce a blank/failed sticker.
  return sharp(Buffer.from(svg))
    .resize(512, 512, { fit: "contain" })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 90 })
    .toBuffer();
}

// Renders the extension icon (magnifier + check) to public/icon/{size}.png. Run: npm run icons
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <rect x="0" y="0" width="24" height="24" rx="5.5" fill="#0F5FA8"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="10.8" cy="10.8" r="5.8"/>
    <path d="M19.5 19.5l-4.2-4.2"/>
    <path d="M8.4 10.9l1.7 1.7 3-3.4"/>
  </g>
</svg>`;

await mkdir('public/icon', { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const png = await sharp(Buffer.from(svg(size)))
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(`public/icon/${size}.png`, png);
  console.log(`public/icon/${size}.png`);
}

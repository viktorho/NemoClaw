import sharp from "sharp";

const input = process.argv[2] ?? "./icon.png";
const output = process.argv[3] ?? "./icon.png";

await sharp(input)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .png()
  .toFile(output === input ? "./icon-fixed.png" : output);

console.log(`Wrote ${output === input ? "./icon-fixed.png" : output}`);

/**
 * Background, text and border for a class chip, derived from the class colour.
 *
 * Class colours are whatever the taxonomists chose (sem:color on the class),
 * and they range from near-white (#ebeb6f, #d3d3d3) to mid-dark (#0d8390,
 * #3535f1). Filling the chip with the raw colour and fixing the text dark
 * assumed they were all pale - the SCSS said so - and dark-on-#3535f1 is
 * unreadable.
 *
 * So the colour becomes a TINT of itself: an 86% wash for the fill, the same
 * hue darkened until it clears 7:1 for the text, and a mid-strength edge. The
 * chip still says "Content Type is the yellow one" and the text is readable.
 * Target is WCAG 2.2 SC 1.4.3 AA, 4.5:1 - chip text is small, so the 3:1
 * large-text allowance does not apply; every colour in the real models
 * reaches 7:1.
 *
 * Same derivation as IKM-Ontology-WebPart's detailData.ts, so a class looks
 * identical whether you are editing it or reading it.
 */

interface IRgb { r: number; g: number; b: number }

function parseHex(hex: string): IRgb | undefined {
  const raw = (hex || '').replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return undefined;
  return {
    r: parseInt(full.substr(0, 2), 16),
    g: parseInt(full.substr(2, 2), 16),
    b: parseInt(full.substr(4, 2), 16)
  };
}

const toHex = ({ r, g, b }: IRgb): string =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance. */
function luminance({ r, g, b }: IRgb): number {
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: IRgb, b: IRgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const towardsWhite = (c: IRgb, amount: number): IRgb => ({
  r: c.r + (255 - c.r) * amount, g: c.g + (255 - c.g) * amount, b: c.b + (255 - c.b) * amount
});
const towardsBlack = (c: IRgb, amount: number): IRgb => ({
  r: c.r * (1 - amount), g: c.g * (1 - amount), b: c.b * (1 - amount)
});

export interface IChipColours { background: string; color: string; borderColor: string }

/** Undefined when the colour will not parse, so the caller keeps its neutral default. */
export function classChipColours(hex: string | undefined): IChipColours | undefined {
  const base = parseHex(hex || '');
  if (!base) return undefined;
  const background = towardsWhite(base, 0.86);
  const borderColor = towardsWhite(base, 0.45);
  let color = base;
  for (let step = 0; step <= 20; step++) {
    color = towardsBlack(base, step * 0.05);
    if (contrast(color, background) >= 7) break;
  }
  return { background: toHex(background), color: toHex(color), borderColor: toHex(borderColor) };
}

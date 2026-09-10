import sharp from 'sharp';
import { config } from '../config.js';
import { withRetry } from './retry.js';

/**
 * Responsive Display Ad ke liye images.
 *
 * Google do naap maangta hai — 1.91:1 (banner) aur 1:1 (square). Article ki
 * featured image kisi bhi naap ki ho sakti hai, isliye hum use download karke
 * dono naapon me crop kar dete hain (beech ka hissa rakhte hue).
 */

export interface DisplayImages {
  /** 1.91:1 — base64 (data: prefix ke bina). */
  marketing: string;
  /** 1:1 — base64. */
  square: string;
}

/** Article ki image download karta hai. */
async function download(url: string): Promise<Buffer> {
  const response = await withRetry('Image download', () =>
    fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(config.display.images.timeoutMs),
    }),
  );

  if (!response.ok) {
    throw new Error(`Image nahi mili (HTTP ${response.status}): ${url}`);
  }

  const type = response.headers.get('content-type') ?? '';
  if (type && !type.startsWith('image/')) {
    throw new Error(`Ye image nahi hai (${type}): ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Ek image ko diye gaye naap me laata hai — beech ka hissa rakhke crop karta
 * hai, taaki chehra/product beech me hi rahe.
 */
async function fit(source: Buffer, width: number, height: number): Promise<string> {
  const out = await sharp(source)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .flatten({ background: '#ffffff' }) // PNG ki transparency hata do
    .jpeg({ quality: config.display.images.quality })
    .toBuffer();

  return out.toString('base64');
}

/** Article ki featured image se dono zaroori naap bana deta hai. */
export async function buildDisplayImages(imageUrl: string): Promise<DisplayImages> {
  if (!imageUrl) {
    throw new Error(
      'Featured Image column khaali hai — Display ad bina image ke nahi ban sakta.',
    );
  }

  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error(`Featured Image ka URL galat hai: ${imageUrl}`);
  }

  const source = await download(url.toString());

  const { marketing, square } = config.display.images;
  const metadata = await sharp(source).metadata();

  // Bahut chhoti image ko bada karna bekaar dikhta hai — Google ki minimum
  // requirement 600x314 hai, usse neeche wali image reject kar dete hain.
  if ((metadata.width ?? 0) < 600 || (metadata.height ?? 0) < 314) {
    throw new Error(
      `Image bahut chhoti hai (${metadata.width}x${metadata.height}) — ` +
        'kam se kam 600x314 chahiye.',
    );
  }

  return {
    marketing: await fit(source, marketing.width, marketing.height),
    square: await fit(source, square.width, square.height),
  };
}

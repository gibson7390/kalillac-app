import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { Palette, Controls } from '../constants/Theme';

const appRoot = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(appRoot, path));
const source = (path: string) => read(path).toString('utf8');

/** Decode only the 8-bit RGB/RGBA PNG formats used by our actual native assets. */
function png(path: string) {
  const file = read(path);
  expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const width = file.readUInt32BE(16), height = file.readUInt32BE(20);
  expect(file[24]).toBe(8);
  const colorType = file[25];
  if (colorType !== 2 && colorType !== 6) throw new Error('Unexpected asset PNG type');
  const channels = colorType === 2 ? 3 : 4;
  const chunks: Buffer[] = [];
  for (let p = 8; p < file.length;) {
    const n = file.readUInt32BE(p);
    if (file.toString('ascii', p + 4, p + 8) === 'IDAT') chunks.push(file.subarray(p + 8, p + 8 + n));
    p += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x;
      const left = x >= channels ? pixels[offset - channels] : 0;
      const up = y > 0 ? pixels[offset - stride] : 0;
      const corner = y > 0 && x >= channels ? pixels[offset - stride - channels] : 0;
      const prediction = left + up - corner;
      const a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - corner);
      const paeth = a <= b && a <= c ? left : b <= c ? up : corner;
      const add = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      if (add === undefined) throw new Error('Unexpected PNG filter');
      pixels[offset] = (raw[y * (stride + 1) + x + 1] + add) & 255;
    }
  }
  return { width, height, channels, pixels, pixel: (x: number, y: number) =>
    [...pixels.subarray((y * width + x) * channels, (y * width + x + 1) * channels)] };
}

describe('approved brand asset and native configuration contracts', () => {
  it('uses a real transparent UI PNG rather than the mislabeled source JPEG', () => {
    const mark = png('assets/brand/kalillac-mark-ui.png');
    expect([mark.width, mark.height, mark.channels]).toEqual([192, 192, 4]);
    expect(mark.pixel(0, 0)[3]).toBe(0);
    expect(mark.pixel(191, 191)[3]).toBe(0);
    expect(read('assets/brand/kalillac-mark.png').subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(read('assets/brand/kalillac-wordmark.png').subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });
  it('keeps the native placeholder opaque, square, unmasked and on the app light background', () => {
    const icon = png('assets/brand/icon-placeholder.png');
    expect([icon.width, icon.height, icon.channels]).toEqual([1024, 1024, 3]);
    const background = Palette.light.background.match(/[0-9a-f]{2}/gi)!.map(n => parseInt(n, 16));
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) {
      expect(icon.pixel(x, y)).toEqual(background);
    }
    const dot = icon.pixel(752, 728);
    expect(dot[2]).toBeGreaterThan(180);
    expect(dot[2]).toBeGreaterThan(dot[1] * 2);
  });
  it('keeps the adaptive foreground centered and preserves source color pixels in the opaque composition', () => {
    const foreground = png('assets/brand/icon-foreground-placeholder.png');
    const opaque = png('assets/brand/icon-placeholder.png');
    expect([foreground.width, foreground.height, foreground.channels]).toEqual([1024, 1024, 4]);
    expect(foreground.pixel(0, 0)[3]).toBe(0);
    let left = 1024, right = 0, top = 1024, bottom = 0;
    let mismatch = false;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const offset = (y * 1024 + x) * 4;
      if (foreground.pixels[offset + 3] === 255) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        const rgbOffset = (y * 1024 + x) * 3;
        for (let c = 0; c < 3; c++) {
          if (foreground.pixels[offset + c] !== opaque.pixels[rgbOffset + c]) mismatch = true;
        }
      }
    }
    expect([left, top, right - left + 1, bottom - top + 1]).toEqual([208, 234, 608, 556]);
    expect(mismatch).toBe(false);
  });
  it('uses a small web-only favicon rather than loading a 1024px icon for it', () => {
    const favicon = png('assets/brand/favicon-placeholder.png');
    expect([favicon.width, favicon.height]).toEqual([48, 48]);
    expect(read('assets/brand/favicon-placeholder.png').length).toBeLessThan(10_000);
  });
  it('configures supported icon fields and a matching background-only launch screen', () => {
    const { expo } = JSON.parse(source('app.json'));
    expect(expo.icon).toBe('./assets/brand/icon-placeholder.png');
    expect(expo.ios.icon).toBe(expo.icon);
    expect(expo.android.adaptiveIcon.foregroundImage).toBe('./assets/brand/icon-foreground-placeholder.png');
    expect(expo.android.adaptiveIcon.backgroundColor).toBe(Palette.light.background);
    expect(expo.web.favicon).toBe('./assets/brand/favicon-placeholder.png');
    const [, splash] = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen');
    expect(splash.backgroundColor).toBe(Palette.light.background);
    expect(splash.dark.backgroundColor).toBe(Palette.dark.background);
    expect(splash.image).toBeUndefined();
    expect(source('app/_layout.tsx')).not.toMatch(/setTimeout/);
  });
  it('follows the actual app theme override, does not recolor artwork, and cannot intercept taps', () => {
    const brand = source('components/BrandLockup.tsx');
    expect(brand).toContain('usePreferences()');
    expect(brand).not.toContain('useColorScheme');
    expect(brand).not.toContain('tintColor');
    expect(brand).toContain('pointerEvents="none"');
    expect(brand).toContain('showMark = false');
    expect(brand).toContain('accessibilityLabel="Kalillac AI"');
    expect(source('app/(app)/(tabs)/index.tsx')).toContain('showMark');
    expect(source('app/onboarding.tsx')).toContain('showMark');
    expect(source('app/(app)/chat/[id].tsx')).not.toContain('<BrandMark');
    expect(source('app/(app)/chat/[id].tsx')).not.toContain('showMark');
    expect(Controls.minTarget).toBeGreaterThanOrEqual(44);
  });
});

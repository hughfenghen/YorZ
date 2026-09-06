#!/usr/bin/env node
/**
 * 生成移动端 PWA 图标（src/gui-mobile/public/icons/*.png）。
 *
 * 为什么是脚本而不是设计稿导出：PWA 清单要求若干固定尺寸的 PNG，而 YorZ 的图标
 * 就是「品牌绿底 + 白色 Y」这么一个几何形，用代码画比维护一堆二进制导出物更可控——
 * 改主色只需改这里的常量，不必重新导出六个文件。产物**需要提交**，构建不跑这个脚本。
 *
 * 刻意不引任何依赖（没有 sharp / canvas）：自己算覆盖率做抗锯齿，再用 zlib 编码
 * 一张 RGBA8 PNG。多一个原生依赖对一个只跑一次的脚本来说不划算。
 *
 * 用法：node scripts/gen-mobile-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../src/gui-mobile/public/icons')

// 与 src/styles/theme-tokens.css 的 paper 亮色 --primary / --primary-foreground 对齐，
// 也与 vite.gui-mobile.config.ts 里 manifest 的 theme_color 一致。
const BRAND = [0x14, 0x66, 0x38] // #146638
const GLYPH = [0xf7, 0xfb, 0xf7] // 近白，避免纯白在绿底上过亮

/** 线段到点的距离，用于把「Y」当成三段带宽度的线来画。 */
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const len2 = abx * abx + aby * aby
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2))
  const dx = apx - abx * t
  const dy = apy - aby * t
  return Math.hypot(dx, dy)
}

/** 圆角矩形的有符号距离：<0 在内部。maskable 图标传 radius=0 得到满幅方形。 */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * 由距离场求像素覆盖率：在 ±0.5px 内线性过渡，就是一层够用的抗锯齿。
 * 距离 <= -0.5 完全在内（1），>= 0.5 完全在外（0）。
 */
function coverage(sdf) {
  return Math.max(0, Math.min(1, 0.5 - sdf))
}

function blend(dst, src, alpha, offset) {
  dst[offset] = Math.round(dst[offset] * (1 - alpha) + src[0] * alpha)
  dst[offset + 1] = Math.round(dst[offset + 1] * (1 - alpha) + src[1] * alpha)
  dst[offset + 2] = Math.round(dst[offset + 2] * (1 - alpha) + src[2] * alpha)
}

/**
 * 画一张图标。
 * @param size 边长（像素）
 * @param opts.maskable 满幅铺底、字形收进安全区（Android 自适应图标会裁掉四周）
 * @param opts.opaque 背景不透明（iOS 的 apple-touch-icon 不支持透明，会填黑）
 */
function renderIcon(size, { maskable = false, opaque = false } = {}) {
  const rgba = new Uint8Array(size * size * 4)

  // 底：普通图标留 ~4% 边距并做圆角；maskable 满幅，圆角交给系统裁切。
  const margin = maskable || opaque ? 0 : size * 0.04
  const half = size / 2 - margin
  const radius = maskable || opaque ? 0 : size * 0.22

  // 字形安全区：maskable 规范只保证中心 80% 直径可见，字形因此画小一些。
  const glyphScale = maskable ? 0.42 : 0.56
  const g = size * glyphScale
  const cx = size / 2
  const cy = size / 2
  // 「Y」的三个端点 + 交汇点，按字形高度归一化摆放
  const topY = cy - g / 2
  const forkY = cy - g * 0.06
  const botY = cy + g / 2
  const leftX = cx - g * 0.36
  const rightX = cx + g * 0.36
  const stroke = g * 0.17

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const offset = (y * size + x) * 4

      const bgAlpha = coverage(roundedRectSdf(px, py, cx, cy, half, half, radius))
      if (bgAlpha <= 0) continue
      rgba[offset] = BRAND[0]
      rgba[offset + 1] = BRAND[1]
      rgba[offset + 2] = BRAND[2]
      rgba[offset + 3] = Math.round(bgAlpha * 255)

      const d = Math.min(
        distToSegment(px, py, leftX, topY, cx, forkY),
        distToSegment(px, py, rightX, topY, cx, forkY),
        distToSegment(px, py, cx, forkY, cx, botY),
      )
      const glyphAlpha = coverage(d - stroke / 2) * bgAlpha
      if (glyphAlpha > 0) blend(rgba, GLYPH, glyphAlpha, offset)
    }
  }

  if (opaque) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  }
  return rgba
}

// ---- 最小 PNG 编码器（RGBA8 / 无滤波） ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10..12 = compression / filter / interlace，全部为 0（默认）

  // 每行前置一个滤波字节 0（None）——图标是大色块，deflate 已经压得很好，
  // 上滤波器的收益不值得多一份实现。
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, opts: {} },
  { file: 'icon-512.png', size: 512, opts: {} },
  { file: 'maskable-512.png', size: 512, opts: { maskable: true } },
  { file: 'apple-touch-icon.png', size: 180, opts: { opaque: true } },
  { file: 'favicon-32.png', size: 32, opts: {} },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const { file, size, opts } of TARGETS) {
  const png = encodePng(renderIcon(size, opts), size)
  writeFileSync(resolve(OUT_DIR, file), png)
  console.log(`✓ ${file} (${size}×${size}, ${png.length} bytes)`)
}

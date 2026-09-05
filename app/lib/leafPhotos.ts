import fs from "fs"
import path from "path"

// Mirrors pestPhotos.ts: disease-detection leaf photos are stored the same
// way so the LLM-enhanced recommendation path can attach the original image
// as evidence, without changing how pest photos are handled.
const photoDir = path.join(process.cwd(), "app/data/leaf-photos")
const formats = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const

export function leafPhotoExtension(bytes: Buffer): keyof typeof formats | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg"
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png"
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp"
  return null
}

export function saveLeafPhoto(bytes: Buffer) {
  const extension = leafPhotoExtension(bytes)
  if (!extension) return null
  fs.mkdirSync(photoDir, { recursive: true })
  const name = `${crypto.randomUUID()}.${extension}`
  fs.writeFileSync(path.join(photoDir, name), bytes, { flag: "wx", mode: 0o600 })
  return name
}

export function readLeafPhoto(name: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/.test(name)) return null
  try {
    const bytes = fs.readFileSync(path.join(photoDir, name))
    const extension = leafPhotoExtension(bytes)
    return extension ? { bytes, contentType: formats[extension] } : null
  } catch {
    return null
  }
}

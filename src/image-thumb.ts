async function createThumb(file: File): Promise<{ thumb: File; width: number; height: number } | null> {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) return null
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = bitmap
    if (!width || !height || width * height > 100_000_000) return null
    const scale = Math.min(1, 720 / width, 720 / height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
    if (!blob) return null
    return {
      thumb: new File([blob], 'thumb.webp', { type: 'image/webp' }),
      width,
      height
    }
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

export async function enrichFormDataWithThumbs(form: FormData): Promise<FormData> {
  const images = form.getAll('images').filter((value): value is File => value instanceof File)
  if (!images.length || form.has('thumbs')) return form
  const results = await Promise.all(images.map((file) => createThumb(file)))
  const next = new FormData()
  for (const [key, value] of form.entries()) {
    next.append(key, value)
  }
  const meta: Array<{ width: number | null; height: number | null }> = []
  results.forEach((result) => {
    if (result) {
      next.append('thumbs', result.thumb)
      meta.push({ width: result.width, height: result.height })
    } else {
      next.append('thumbs', new File([], 'empty'))
      meta.push({ width: null, height: null })
    }
  })
  next.set('imageMeta', JSON.stringify(meta))
  return next
}

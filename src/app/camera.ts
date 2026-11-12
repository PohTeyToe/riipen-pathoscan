import { draw, loadImage } from '../lib/photo'

/**
 * The file the app keeps for a photo: decoded at the reader's size, then saved as one JPEG. The reader reads
 * that saved file, never the camera's, so opening the run again gives the same pixels and the same answer.
 */
export async function encodePhoto(file: Blob): Promise<Blob> {
  const canvas = document.createElement('canvas')
  draw(canvas, await loadImage(file))
  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("Couldn't encode the photo"))), 'image/jpeg', 0.9))
}

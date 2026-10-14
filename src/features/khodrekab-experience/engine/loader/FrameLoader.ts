import { FrameLoadError } from './types';

export class FrameLoader {
  /**
   * Loads and decodes a frame from the given URL.
   * Will attempt to use createImageBitmap, falling back to HTMLImageElement if necessary.
   */
  public async load(url: string, signal?: AbortSignal): Promise<ImageBitmap | HTMLImageElement> {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();

      // Check for native ImageBitmap support
      if (typeof createImageBitmap !== 'undefined') {
        const bitmap = await createImageBitmap(blob, {
          premultiplyAlpha: 'premultiply',
          colorSpaceConversion: 'none'
        });
        console.log(`[FrameLoader] Loaded bitmap from ${url}. Dimensions: ${bitmap.width}x${bitmap.height}`);
        return bitmap;
      }

      // Fallback for browsers without createImageBitmap
      return await this.createImageElementFallback(url, blob, signal);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw err; // Re-throw standard aborts
      }
      throw new FrameLoadError(`Failed to load frame from ${url}`, url, err);
    }
  }

  private createImageElementFallback(url: string, blob: Blob, signal?: AbortSignal): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);

      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        img.src = '';
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      img.onload = () => {
        cleanup();
        resolve(img);
      };

      img.onerror = () => {
        cleanup();
        reject(new Error('Failed to decode image via HTMLImageElement fallback.'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      img.src = objectUrl;
    });
  }
}

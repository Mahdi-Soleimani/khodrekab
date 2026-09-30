import { FrameController } from './FrameController';
import { BitmapCache } from '../cache';
import { RenderContext, RendererOptions, FrameState } from './types';

export class CanvasRenderer {
  private renderContext: RenderContext | null = null;
  private options: RendererOptions;
  private frameController: FrameController;
  private cache: BitmapCache;
  private frameState: FrameState;
  
  private animationFrameId: number | null = null;
  private isRendering: boolean = false;
  private keyframes: number[] = [1, 30, 60, 90, 120];
  private lastRenderedFrame: number = 0;
  private debugRenderCount: number = 0;

  constructor(frameController: FrameController, cache: BitmapCache, options?: Partial<RendererOptions>) {
    this.frameController = frameController;
    this.cache = cache;
    this.options = {
      alpha: true,
      resizeBehavior: 'contain',
      fallbackEnabled: true,
      ...options
    };
    
    this.frameState = {
      currentFrame: 0,
      previousFrame: 0,
      lastRenderedTimestamp: 0
    };
  }

  public attachCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d', { alpha: this.options.alpha });
    if (!ctx) throw new Error('Could not get 2D context');

    this.renderContext = {
      canvas,
      ctx,
      viewportWidth: canvas.clientWidth,
      viewportHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };

    console.log(`[CanvasRenderer] attachCanvas called. initial w=${canvas.width}, h=${canvas.height}, dpr=${window.devicePixelRatio || 1}`);

    this.resizeCanvas();
  }

  public setKeyframes(keyframes: number[]): void {
    this.keyframes = keyframes;
  }

  public start(): void {
    if (this.isRendering) return;
    this.isRendering = true;
    this.renderLoop();
  }

  public stop(): void {
    this.isRendering = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public resizeCanvas(): void {
    if (!this.renderContext) return;
    const { canvas } = this.renderContext;
    const devicePixelRatio = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;

    this.renderContext.viewportWidth = rect.width;
    this.renderContext.viewportHeight = rect.height;
    this.renderContext.devicePixelRatio = devicePixelRatio;
    
    console.log(`[CanvasRenderer] resizeCanvas. new canvas w=${canvas.width}, h=${canvas.height}, css w=${rect.width}, css h=${rect.height}`);

    this.renderFrame(this.frameController.getCurrentFrame(), true);
  }

  private renderLoop = (): void => {
    if (!this.isRendering) return;

    const targetFrame = this.frameController.getCurrentFrame();
    
    // Attempt render if target changed, or if we haven't successfully rendered the target frame yet.
    // This ensures frame 1 is drawn once it loads, and also polls for the target frame if we had to use a fallback.
    if (targetFrame !== this.frameState.currentFrame || this.lastRenderedFrame !== targetFrame) {
      this.renderFrame(targetFrame);
      this.frameState.currentFrame = targetFrame;
      this.frameState.lastRenderedTimestamp = performance.now();
    }

    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  private renderFrame(targetFrame: number, force: boolean = false): void {
    if (!this.renderContext) return;

    let bitmapToDraw = this.cache.get(targetFrame);
    let resolvedFrame = targetFrame;

    // TEMPORARY DEBUG: Disable fallback logic
    // if (!bitmapToDraw && this.options.fallbackEnabled) {
    //   const fallback = this.findFallbackBitmap(targetFrame);
    //   if (fallback) {
    //     bitmapToDraw = fallback.bitmap;
    //     resolvedFrame = fallback.frame;
    //   }
    // }

    if (!bitmapToDraw) {
      if (this.debugRenderCount % 10 === 0) {
         console.log(`[CanvasRenderer] renderFrame(${targetFrame}) - Bitmap NOT available yet.`);
      }
      this.debugRenderCount++;
      return;
    }

    if (this.lastRenderedFrame !== resolvedFrame) {
      console.log(`[CanvasRenderer] Rendering frame ${resolvedFrame}`);
    }

    this.drawBitmap(bitmapToDraw);
    this.lastRenderedFrame = resolvedFrame;
    this.drawDebugOverlay(resolvedFrame);
  }

  private drawDebugOverlay(frame: number): void {
    if (!this.renderContext) return;
    const { ctx } = this.renderContext;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(10, 10, 200, 50);
    ctx.fillStyle = 'white';
    ctx.font = '20px sans-serif';
    ctx.fillText(`Frame: ${frame} / 120`, 20, 40);
    ctx.restore();
  }

  private findFallbackBitmap(targetFrame: number): { bitmap: ImageBitmap; frame: number } | null {
    let bitmap = this.cache.get(targetFrame - 1);
    if (bitmap) return { bitmap, frame: targetFrame - 1 };
    
    bitmap = this.cache.get(targetFrame + 1);
    if (bitmap) return { bitmap, frame: targetFrame + 1 };

    let nearestKeyframe = this.keyframes[0];
    let minDistance = Math.abs(targetFrame - nearestKeyframe);
    for (const keyframe of this.keyframes) {
      const dist = Math.abs(targetFrame - keyframe);
      if (dist < minDistance) {
        minDistance = dist;
        nearestKeyframe = keyframe;
      }
    }
    bitmap = this.cache.get(nearestKeyframe);
    if (bitmap) return { bitmap, frame: nearestKeyframe };

    bitmap = this.cache.get(this.lastRenderedFrame);
    if (bitmap) return { bitmap, frame: this.lastRenderedFrame };

    return null;
  }

  private drawBitmap(bitmap: ImageBitmap): void {
    if (!this.renderContext) return;
    const { ctx, canvas } = this.renderContext;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgWidth = bitmap.width;
    const imgHeight = bitmap.height;

    const canvasRatio = canvasWidth / canvasHeight;
    const imgRatio = imgWidth / imgHeight;

    let renderWidth = canvasWidth;
    let renderHeight = canvasHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (this.options.resizeBehavior === 'contain') {
      if (canvasRatio > imgRatio) {
        renderHeight = canvasHeight;
        renderWidth = imgWidth * (canvasHeight / imgHeight);
        offsetX = (canvasWidth - renderWidth) / 2;
      } else {
        renderWidth = canvasWidth;
        renderHeight = imgHeight * (canvasWidth / imgWidth);
        offsetY = (canvasHeight - renderHeight) / 2;
      }
    } else if (this.options.resizeBehavior === 'cover') {
      if (canvasRatio > imgRatio) {
        renderWidth = canvasWidth;
        renderHeight = imgHeight * (canvasWidth / imgWidth);
        offsetY = (canvasHeight - renderHeight) / 2;
      } else {
        renderHeight = canvasHeight;
        renderWidth = imgWidth * (canvasHeight / imgHeight);
        offsetX = (canvasWidth - renderWidth) / 2;
      }
    }

    try {
      ctx.drawImage(bitmap, 0, 0, imgWidth, imgHeight, offsetX, offsetY, renderWidth, renderHeight);
      if (this.lastRenderedFrame === 0 || this.debugRenderCount === 0) {
         console.log(`[CanvasRenderer] drawImage SUCCESS. renderWidth=${renderWidth}, renderHeight=${renderHeight}, canvasWidth=${canvas.width}, canvasHeight=${canvas.height}`);
         try {
           const pixel = ctx.getImageData(0, 0, 1, 1).data;
           console.log(`[CanvasRenderer] First pixel (0,0) RGBA: [${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3]}]`);
         } catch (e) {
           console.warn(`[CanvasRenderer] Could not read getImageData (possibly tainted canvas):`, e);
         }
      }
    } catch (err) {
      console.error(`[CanvasRenderer] drawImage ERROR:`, err);
    }
    this.debugRenderCount++;
  }
}

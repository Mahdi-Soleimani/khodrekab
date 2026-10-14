export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface RendererOptions {
  alpha: boolean;
  resizeBehavior: 'contain' | 'cover';
  fallbackEnabled: boolean;
}

export interface FrameState {
  currentFrame: number;
  previousFrame: number;
  lastRenderedTimestamp: number;
}

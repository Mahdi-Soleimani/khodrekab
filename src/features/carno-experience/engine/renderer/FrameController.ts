export class FrameController {
  private frameCount: number;
  private currentFrame: number = 1;
  private previousFrame: number = 1;

  constructor(frameCount: number) {
    this.frameCount = frameCount;
    console.log(`[FrameController] Initialized with frameCount=${frameCount}, currentFrame=${this.currentFrame}`);
  }

  public updateProgress(progress: number): void {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const targetFrame = Math.floor(clampedProgress * (this.frameCount - 1)) + 1;
    
    if (targetFrame !== this.currentFrame) {
      console.log(`[FrameController] scrollProgress: ${progress.toFixed(3)} -> targetFrame: ${targetFrame}`);
      this.previousFrame = this.currentFrame;
      this.currentFrame = targetFrame;
    }
  }

  public getCurrentFrame(): number {
    return this.currentFrame;
  }

  public getPreviousFrame(): number {
    return this.previousFrame;
  }
}

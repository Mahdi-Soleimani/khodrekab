import { FrameLoadRequest, LoaderResult, CarnoManifest, LoadJob } from './types';
import { AssetResolver } from './AssetResolver';
import { FrameLoader } from './FrameLoader';

export interface LoadQueueOptions {
  maxConcurrent?: number;
  loader: FrameLoader;
  resolver: AssetResolver;
  manifest: CarnoManifest;
}

export class LoadQueue {
  private maxConcurrent: number;
  private loader: FrameLoader;
  private resolver: AssetResolver;
  private manifest: CarnoManifest;

  private queue: LoadJob[] = [];
  private inFlight = new Map<string, Promise<ImageBitmap | HTMLImageElement>>();
  private jobRegistry = new Map<string, LoadJob>();

  constructor(options: LoadQueueOptions) {
    this.maxConcurrent = options.maxConcurrent || 4;
    this.loader = options.loader;
    this.resolver = options.resolver;
    this.manifest = options.manifest;
  }

  public loadFrame(request: FrameLoadRequest): Promise<LoaderResult> {
    const jobId = `${request.profileId}-${request.frameNumber}`;

    // 1. Check existing inflight request
    const existingPromise = this.inFlight.get(jobId);
    if (existingPromise) {
      return existingPromise.then(bitmap => ({
        frameNumber: request.frameNumber,
        bitmap
      }));
    }

    // 2. Queue handling
    return new Promise((resolve, reject) => {
      const existingJob = this.jobRegistry.get(jobId);
      
      if (existingJob) {
        // Upgrade priority if new request has higher priority
        if (request.priority < existingJob.priority) {
          existingJob.priority = request.priority;
          this.sortQueue();
        }
        existingJob.resolvers.push(resolve);
        existingJob.rejectors.push(reject);
        return;
      }

      const url = this.resolver.resolveFrameURL(request.frameNumber, request.profileId);
      
      const newJob: LoadJob = {
        id: jobId,
        frameNumber: request.frameNumber,
        priority: request.priority,
        profileId: request.profileId,
        url,
        abortController: new AbortController(),
        resolvers: [resolve],
        rejectors: [reject]
      };

      this.jobRegistry.set(jobId, newJob);
      this.queue.push(newJob);
      this.sortQueue();

      this.pump();
    });
  }

  public cancel(frameNumber: number, profileId: string): void {
    const jobId = `${profileId}-${frameNumber}`;
    const job = this.jobRegistry.get(jobId);
    
    if (!job) return;

    // Do not cancel Hero or Keyframes based on manifest
    if (this.manifest.keyframes.includes(frameNumber) || frameNumber === this.manifest.defaultFrame) {
      return;
    }

    // If it's in queue (not started), remove it
    const queueIndex = this.queue.findIndex(j => j.id === jobId);
    if (queueIndex > -1) {
      this.queue.splice(queueIndex, 1);
      this.jobRegistry.delete(jobId);
      const abortErr = new DOMException('Aborted', 'AbortError');
      job.rejectors.forEach(reject => reject(abortErr));
      return;
    }

    // If it's inflight, abort it via AbortController
    if (job.abortController) {
      job.abortController.abort();
    }
  }

  private sortQueue(): void {
    // Sort ascending by priority (1 is highest)
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  private async pump(): Promise<void> {
    if (this.inFlight.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job || !job.url) return;

    const promise = this.loader.load(job.url, job.abortController?.signal);
    this.inFlight.set(job.id, promise);

    try {
      const bitmap = await promise;
      job.resolvers.forEach(resolve => resolve({
        frameNumber: job.frameNumber,
        bitmap
      }));
    } catch (err: any) {
      job.rejectors.forEach(reject => reject(err));
    } finally {
      this.inFlight.delete(job.id);
      this.jobRegistry.delete(job.id);
      this.pump(); // Attempt to process the next job
    }
  }
}

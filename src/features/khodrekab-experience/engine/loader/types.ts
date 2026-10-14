export interface AssetProfile {
  width: number;
  quality: number;
  directory: string;
}

export interface KhodrekabManifest {
  version: string;
  frameCount: number;
  defaultFrame: number;
  keyframes: number[];
  basePath: string;
  extension: string;
  profiles: {
    desktop: AssetProfile;
    mobile: AssetProfile;
    [key: string]: AssetProfile;
  };
}

export type CarnoManifest = KhodrekabManifest;

export enum LoadPriority {
  HERO = 1,
  KEYFRAMES = 2,
  SECONDARY_KEYFRAMES = 3,
  NEARBY = 4,
  BACKGROUND = 5,
}

export interface FrameLoadRequest {
  frameNumber: number;
  priority: LoadPriority;
  profileId: string;
}

export interface LoaderResult {
  frameNumber: number;
  bitmap: ImageBitmap | HTMLImageElement;
}

export interface LoadJob {
  id: string;
  frameNumber: number;
  priority: LoadPriority;
  profileId: string;
  url?: string;
  abortController?: AbortController;
  resolvers: Array<(result: LoaderResult) => void>;
  rejectors: Array<(error: Error) => void>;
}

export class ManifestResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestResolutionError';
  }
}

export class FrameLoadError extends Error {
  public url: string;
  public originalError: Error;

  constructor(message: string, url: string, originalError: Error) {
    super(message);
    this.name = 'FrameLoadError';
    this.url = url;
    this.originalError = originalError;
  }
}

export class UnsupportedBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedBrowserError';
  }
}

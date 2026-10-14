import { KhodrekabManifest, ManifestResolutionError } from './types';

export class AssetResolver {
  private manifest: KhodrekabManifest;

  constructor(manifest: KhodrekabManifest) {
    if (!manifest || !manifest.frameCount || !manifest.basePath || !manifest.profiles) {
      console.error('[AssetResolver] Invalid manifest provided:', manifest);
      throw new ManifestResolutionError('Invalid manifest provided to AssetResolver.');
    }
    console.log('[AssetResolver] Manifest loaded successfully:', manifest);
    this.manifest = manifest;
  }

  public resolveFrameURL(frameNumber: number, profileId: string): string {
    if (frameNumber < 1 || frameNumber > this.manifest.frameCount) {
      throw new ManifestResolutionError(`Frame number ${frameNumber} is out of bounds (1-${this.manifest.frameCount}).`);
    }

    const profile = this.manifest.profiles[profileId];
    if (!profile) {
      throw new ManifestResolutionError(`Profile '${profileId}' not found in manifest.`);
    }

    const paddedFrame = frameNumber.toString().padStart(3, '0');
    // Ensure no double slashes if basePath has trailing slash
    const basePath = this.manifest.basePath.replace(/\/$/, '');
    
    const url = `${basePath}/${profile.directory}/frame-${paddedFrame}.${this.manifest.extension}`;
    console.log(`[AssetResolver] Resolved frame ${frameNumber} -> ${url}`);
    return url;
  }
}

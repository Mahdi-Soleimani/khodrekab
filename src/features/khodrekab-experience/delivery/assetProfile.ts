import type { KhodrekabManifest } from '../engine/loader/types';
import { frameFileStem } from './frameIndex';

/**
 * Mobile breakpoint used by the app (Tailwind `md` starts at 768px, so "mobile" is < 768px).
 * The same media query drives the poster <picture> source and the canvas profile,
 * so the poster and the first canvas frame always come from the same asset tier.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export type ProfileId = 'desktop' | 'mobile';

/**
 * Identity of one immutable, independently validated asset set.
 * Validation history is keyed by the full identity: success for desktop never implies mobile.
 */
export interface AssetIdentity {
  manifestVersion: string;
  profileId: ProfileId;
  format: string;
  /** Expected decoded width, taken from the manifest profile. */
  width: number;
}

export function identityKey(id: AssetIdentity): string {
  return `${id.manifestVersion}|${id.profileId}|${id.format}`;
}

/**
 * Select the profile once, at initialisation. Runtime breakpoint changes do not switch
 * profiles (bounded behaviour: a new profile would require a full new session/generation).
 */
export function selectProfileId(manifest: KhodrekabManifest, isMobileViewport: boolean): ProfileId {
  if (isMobileViewport && manifest.profiles.mobile) return 'mobile';
  if (manifest.profiles.desktop) return 'desktop';
  throw new Error('Manifest has neither a usable mobile nor a desktop profile');
}

export function assetIdentityFor(manifest: KhodrekabManifest, profileId: ProfileId): AssetIdentity {
  const profile = manifest.profiles[profileId];
  if (!profile) throw new Error(`Profile ${profileId} missing from manifest`);
  return {
    manifestVersion: manifest.version,
    profileId,
    format: manifest.extension,
    width: profile.width,
  };
}

/** URL of a frame for a profile, built exactly like the engine's AssetResolver does. */
export function frameUrl(manifest: KhodrekabManifest, profileId: ProfileId, frameNumber: number): string {
  const base = manifest.basePath.replace(/\/$/, '');
  const dir = manifest.profiles[profileId].directory;
  return `${base}/${dir}/${frameFileStem(frameNumber)}.${manifest.extension}`;
}

/**
 * Poster = the currently served frame 1 of each tier (no re-encode, no crop).
 * These literals must stay equal to frameUrl(manifest, profile, manifest.defaultFrame);
 * scripts/test-carno-frame-delivery.ts asserts this against public/car-frames/v1/manifest.json.
 */
export const POSTER_ASSETS = {
  desktop: { src: '/car-frames/v1/desktop/frame-001.webp', width: 1600, height: 900 },
  mobile: { src: '/car-frames/v1/mobile/frame-001.webp', width: 960, height: 540 },
} as const;

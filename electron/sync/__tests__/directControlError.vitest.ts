import { describe, it, expect } from 'vitest';
import {
  ByosSyncError,
  DirectUploadUnavailableError,
  mapDirectControlError,
  mapDirectCompleteError,
} from '../directTransport';
import { MultipartSessionInvalidError } from '../multipartTransfer';

describe('mapDirectControlError — BYOS must not become a Filarr proxy fallback', () => {
  it('maps subscription_inactive / upgrade_required / byos_direct_required to ByosSyncError', () => {
    const inactive = mapDirectControlError('Subscription inactive', 'create', 'subscription_inactive');
    expect(inactive).toBeInstanceOf(ByosSyncError);
    expect((inactive as ByosSyncError).code).toBe('subscription_inactive');

    const upgrade = mapDirectControlError('need Pro', 'create', 'upgrade_required');
    expect(upgrade).toBeInstanceOf(ByosSyncError);

    const direct = mapDirectControlError('use direct', 'create', 'byos_direct_required');
    expect(direct).toBeInstanceOf(ByosSyncError);
    expect(direct).not.toBeInstanceOf(DirectUploadUnavailableError);
  });

  it('still maps missing routes to DirectUploadUnavailableError', () => {
    expect(mapDirectControlError('Direct upload non configure', 'create')).toBeInstanceOf(
      DirectUploadUnavailableError
    );
  });

  it('maps expired tokens to MultipartSessionInvalidError', () => {
    expect(mapDirectControlError('Invalid or expired multipart upload', 'sign')).toBeInstanceOf(
      MultipartSessionInvalidError
    );
  });

  it('mapDirectCompleteError honors BYOS codes', () => {
    const err = mapDirectCompleteError('Subscription inactive', 'subscription_inactive');
    expect(err).toBeInstanceOf(ByosSyncError);
  });
});

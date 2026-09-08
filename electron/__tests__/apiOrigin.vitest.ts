import { describe, it, expect } from 'vitest';
import { API_BASE, API_ORIGIN } from '../apiOrigin';

describe('origine API desktop', () => {
  it('épinglé sur api.filarr.com', () => {
    expect(API_ORIGIN).toBe('https://api.filarr.com');
    expect(API_BASE).toBe('https://api.filarr.com');
  });
});

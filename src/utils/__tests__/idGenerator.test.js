/**
 * Test suite for idGenerator
 */

import { generateId, generateShortId } from '../idGenerator';

describe('idGenerator', () => {
  describe('generateId', () => {
    it('should generate a unique ID', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('should generate IDs with correct format', () => {
      const id = generateId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate different IDs on subsequent calls', () => {
      const ids = new Set();
      const count = 100;

      for (let i = 0; i < count; i++) {
        ids.add(generateId());
      }

      expect(ids.size).toBe(count);
    });
  });

  describe('generateShortId', () => {
    it('should generate a short ID', () => {
      const id = generateShortId();

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThan(40); // Shorter than full UUID
    });

    it('should generate unique short IDs', () => {
      const id1 = generateShortId();
      const id2 = generateShortId();

      expect(id1).not.toBe(id2);
    });

    it('should generate IDs without dashes', () => {
      const id = generateShortId();

      expect(id).not.toContain('-');
    });

    it('should generate different short IDs on subsequent calls', () => {
      const ids = new Set();
      const count = 100;

      for (let i = 0; i < count; i++) {
        ids.add(generateShortId());
      }

      expect(ids.size).toBe(count);
    });
  });
});

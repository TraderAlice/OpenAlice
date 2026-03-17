import { describe, it, expect } from 'vitest';
import { calculate } from './calculate.tool';

describe('calculate tool', () => {
  describe('basic arithmetic', () => {
    it('should calculate addition', () => {
      expect(calculate('1 + 2')).toBe(3);
    });

    it('should calculate subtraction', () => {
      expect(calculate('10 - 3')).toBe(7);
    });

    it('should calculate multiplication', () => {
      expect(calculate('4 * 5')).toBe(20);
    });

    it('should calculate division', () => {
      expect(calculate('15 / 3')).toBe(5);
    });
  });

  describe('parentheses', () => {
    it('should handle parentheses correctly', () => {
      expect(calculate('(1 + 2) * 3')).toBe(9);
      expect(calculate('10 / (2 + 3)')).toBe(2);
    });
  });

  describe('precision', () => {
    it('should round to 4 decimal places', () => {
      expect(calculate('10 / 3')).toBe(3.3333);
      expect(calculate('1 / 7')).toBe(0.1429);
    });

    it('should handle decimals in input', () => {
      expect(calculate('0.1 + 0.2')).toBe(0.3);
      expect(calculate('1.5 * 2')).toBe(3);
    });
  });

  describe('security', () => {
    it('should throw error for invalid expressions with functions', () => {
      expect(() => calculate('alert(1)')).toThrow(/Invalid expression/);
      expect(() => calculate('console.log(1)')).toThrow(/Invalid expression/);
    });

    it('should throw error for expressions with variables', () => {
      expect(() => calculate('x + 1')).toThrow(/Invalid expression/);
      expect(() => calculate('Math.PI')).toThrow(/Invalid expression/);
    });

    it('should throw error for expressions with special characters', () => {
      expect(() => calculate('1; 2')).toThrow(/Invalid expression/);
      expect(() => calculate('1 && 2')).toThrow(/Invalid expression/);
    });
  });

  describe('edge cases', () => {
    it('should handle spaces in expression', () => {
      expect(calculate('  1  +  2  ')).toBe(3);
    });

    it('should handle negative results', () => {
      expect(calculate('1 - 5')).toBe(-4);
    });

    it('should handle zero', () => {
      expect(calculate('0 + 0')).toBe(0);
      expect(calculate('5 * 0')).toBe(0);
    });
  });
});

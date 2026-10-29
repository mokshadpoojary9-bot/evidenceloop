import { describe, expect, it } from 'vitest';
import { currentPasswordError, emailError, newPasswordError } from './authValidation';

describe('emailError', () => {
  it('accepts ordinary addresses, ignoring surrounding spaces', () => {
    for (const value of ['tech@example.com', 'first.last+tag@sub.example.co.uk', '  tech@example.com ']) {
      expect(emailError(value)).toBeNull();
    }
  });

  it('rejects empty and malformed addresses', () => {
    expect(emailError('')).toBe('Enter your email address.');
    for (const value of ['tech', 'tech@', '@example.com', 'tech@example', 'tech@@example.com', 'te ch@example.com', 'tech@.com', 'tech@example.']) {
      expect(emailError(value)).toMatch(/valid email/);
    }
  });
});

describe('newPasswordError', () => {
  it('needs at least 8 characters, a letter and a number', () => {
    expect(newPasswordError('abc123')).toBe('Use at least 8 characters.');
    expect(newPasswordError('12345678')).toBe('Include at least one letter.');
    expect(newPasswordError('abcdefgh')).toBe('Include at least one number.');
    expect(newPasswordError('abcdefg1')).toBeNull();
    expect(newPasswordError('pässwört9')).toBeNull();
  });
});

describe('currentPasswordError', () => {
  it('only asks that a password is entered', () => {
    expect(currentPasswordError('')).toBe('Enter your password.');
    expect(currentPasswordError('x')).toBeNull();
  });
});

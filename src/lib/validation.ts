/**
 * Input validation utilities for CLI commands
 * Provides consistent validation patterns across all commands
 */

export interface ValidationResult {
  error?: string;
  valid: boolean;
  value?: string;
}

/**
 * Validation rules for common input types
 */
export const ValidationRules = {
  /**
   * Valid branch name pattern (git-compatible)
   */
  branchName: /^(?![-./])(?!.*[-./]$)(?!.*[-./]{2})[a-zA-Z0-9._/-]+$/,

  /**
   * Valid module/class name (PascalCase)
   */
  className: /^[A-Z][a-zA-Z0-9]*$/,

  /**
   * Valid email address pattern
   */
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  /**
   * Valid file/directory name (no special chars)
   */
  fileName: /^[a-zA-Z0-9._-]+$/,

  /**
   * Valid kebab-case name
   */
  kebabCase: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,

  /**
   * Valid npm package name
   */
  npmPackage: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,

  /**
   * Valid property name (camelCase)
   */
  propertyName: /^[a-z][a-zA-Z0-9]*$/,

  /**
   * Valid semver version
   */
  semver: /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/,
};

/**
 * Sanitize input by removing potentially dangerous characters
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';

  return input
    .trim()
    // Remove shell special characters
    .replace(/[;&|`$(){}[\]<>\\'"]/g, '')
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ');
}

/**
 * Sanitize a file path to prevent directory traversal
 */
export function sanitizePath(input: string): string {
  if (!input) return '';

  return input
    .trim()
    // Remove directory traversal attempts
    .replace(/\.\./g, '')
    // Remove double slashes
    .replace(/\/+/g, '/')
    // Remove leading slashes (make relative)
    .replace(/^\/+/, '')
    // Remove shell special characters
    .replace(/[;&|`$(){}[\]<>\\'"]/g, '');
}

/**
 * Convert string to camelCase
 */
export function toCamelCase(input: string): string {
  if (!input) return '';

  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Convert string to kebab-case
 */
export function toKebabCase(input: string): string {
  if (!input) return '';

  return input
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Convert string to PascalCase
 */
export function toPascalCase(input: string): string {
  if (!input) return '';

  return input
    .trim()
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^(.)/, (char) => char.toUpperCase());
}

/**
 * Validate a branch name
 */
export function validateBranchName(input: string): ValidationResult {
  return validatePattern(
    input,
    ValidationRules.branchName,
    'Invalid branch name. Use alphanumeric characters, dots, underscores, or hyphens.',
  );
}

/**
 * Validate a module/class name (PascalCase)
 */
export function validateClassName(input: string): ValidationResult {
  return validatePattern(
    input,
    ValidationRules.className,
    'Invalid class name. Must start with uppercase letter and contain only alphanumeric characters.',
  );
}

/**
 * Validate an email address
 */
export function validateEmail(input: string): ValidationResult {
  return validatePattern(input, ValidationRules.email, 'Invalid email address format.');
}

/**
 * Validate a file/directory name
 */
export function validateFileName(input: string): ValidationResult {
  return validatePattern(
    input,
    ValidationRules.fileName,
    'Invalid file name. Use only alphanumeric characters, dots, underscores, or hyphens.',
  );
}

/**
 * Validate a kebab-case name
 */
export function validateKebabCase(input: string): ValidationResult {
  return validatePattern(
    input,
    ValidationRules.kebabCase,
    'Invalid name. Must be lowercase with hyphens (kebab-case).',
  );
}

/**
 * Validate input length
 */
export function validateLength(
  input: string,
  min: number,
  max: number,
  fieldName = 'Input',
): ValidationResult {
  if (!input || input.trim() === '') {
    return { error: `${fieldName} is required`, valid: false };
  }

  const trimmed = input.trim();
  if (trimmed.length < min) {
    return { error: `${fieldName} must be at least ${min} characters`, valid: false };
  }
  if (trimmed.length > max) {
    return { error: `${fieldName} must be at most ${max} characters`, valid: false };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate an npm package name
 */
export function validateNpmPackage(input: string): ValidationResult {
  return validatePattern(
    input,
    ValidationRules.npmPackage,
    'Invalid npm package name.',
  );
}

/**
 * Validate input against a pattern
 */
export function validatePattern(
  input: string,
  pattern: RegExp,
  errorMessage: string,
): ValidationResult {
  if (!input || input.trim() === '') {
    return { error: 'Input is required', valid: false };
  }

  const trimmed = input.trim();
  if (!pattern.test(trimmed)) {
    return { error: errorMessage, valid: false };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate a property name (camelCase)
 */
export function validatePropertyName(input: string): ValidationResult {
  return validatePattern(
    input,
    ValidationRules.propertyName,
    'Invalid property name. Must start with lowercase letter (camelCase).',
  );
}

/**
 * Validate required input with custom validator
 */
export function validateRequired<T>(
  value: null | T | undefined,
  fieldName: string,
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return { error: `${fieldName} is required`, valid: false };
  }
  return { valid: true, value: String(value) };
}

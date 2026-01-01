/**
 * JSON utility functions
 */

/**
 * Safely parse JSON without throwing
 * @param text - JSON string to parse
 * @returns Parsed object or null if parsing fails
 */
export function safeJsonParse<T>(text: string): null | T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

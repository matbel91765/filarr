import DOMPurify from 'dompurify';

/**
 * Sanitize HTML string to prevent XSS attacks.
 * Only allows safe inline formatting tags (bold, italic, code, etc.).
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['strong', 'b', 'em', 'i', 'code', 'del', 's', 'br', 'span'],
    ALLOWED_ATTR: ['class'],
  });
}

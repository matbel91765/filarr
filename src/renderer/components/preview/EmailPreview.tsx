/**
 * EmailPreview Component
 *
 * In-app preview for .eml email messages. The MIME message is parsed entirely in
 * the renderer via postal-mime (dynamically imported so it stays out of the main
 * bundle — no bytes leave the device, matching the offline/E2EE stance). The HTML
 * body is sanitized with DOMPurify before rendering; a plain-text body is shown as
 * a fallback. Attachments are listed by name/type only (no download).
 */

import React, { useState, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import clsx from 'clsx';
import './MarkdownPreview.css';

// postal-mime ships its own types; mirror the parsed shape we consume so we can
// avoid `any` while keeping the dynamic import out of the main bundle.
type Mailbox = { name?: string; address?: string; group?: undefined };
type Group = { name?: string; address?: undefined; group: Mailbox[] };
type Address = Mailbox | Group;

interface ParsedAttachment {
  filename: string | null;
  mimeType: string;
}

interface ParsedEmail {
  subject?: string;
  from?: Address;
  to?: Address[];
  date?: string;
  html?: string;
  text?: string;
  attachments: ParsedAttachment[];
}

export interface EmailPreviewProps {
  /** Raw .eml data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

const formatMailbox = (m: Mailbox): string => {
  const name = m.name?.trim();
  const address = m.address?.trim();
  if (name && address) return `${name} <${address}>`;
  return address || name || '';
};

const formatAddress = (addr?: Address): string => {
  if (!addr) return '';
  if (addr.group) {
    const members = addr.group.map(formatMailbox).filter(Boolean).join(', ');
    return addr.name ? `${addr.name}: ${members}` : members;
  }
  return formatMailbox(addr);
};

const formatAddressList = (list?: Address[]): string =>
  (list || []).map(formatAddress).filter(Boolean).join(', ');

const PaperclipIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
    />
  </svg>
);

const HeaderRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.5 }}>
      <span
        style={{
          flexShrink: 0,
          minWidth: 64,
          fontWeight: 600,
          color: 'var(--color-text-tertiary, #9ca3af)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: 'var(--color-text-primary, #1f2937)',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  );
};

export const EmailPreview: React.FC<EmailPreviewProps> = ({ data, fileName, className }) => {
  const [email, setEmail] = useState<ParsedEmail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setEmail(null);

    // Copy the buffer so the parser never disturbs the shared preview bytes.
    const buffer = data.slice(0);

    (async () => {
      try {
        const PostalMime = (await import('postal-mime')).default;
        const parsed = (await new PostalMime().parse(buffer)) as unknown as ParsedEmail;
        if (!cancelled) setEmail(parsed);
      } catch (err) {
        if (cancelled) return;
        console.error('[EmailPreview] Parse error:', err);
        setError(err instanceof Error ? err.message : 'Lecture impossible');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  // Prefer the sanitized HTML body; strip every active-content / network-capable
  // tag and inline styles so a hostile message can't phone home or restyle the app.
  const sanitizedHtml = useMemo(() => {
    if (!email?.html) return null;
    return DOMPurify.sanitize(email.html, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base'],
      FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'ping'],
      ADD_ATTR: ['target', 'rel'],
    });
  }, [email]);

  const formattedDate = useMemo(() => {
    if (!email?.date) return '';
    const d = new Date(email.date);
    if (isNaN(d.getTime())) return email.date;
    return d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  }, [email]);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">E-mail</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
          </span>
        </div>
      </div>

      <div className="markdown-preview__container">
        {isLoading ? (
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Lecture du message…</span>
          </div>
        ) : error ? (
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher ce message</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : email ? (
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '20px 32px',
                maxWidth: 800,
                borderBottom: '1px solid var(--color-border, #e5e7eb)',
              }}
            >
              <HeaderRow label="De" value={formatAddress(email.from)} />
              <HeaderRow label="À" value={formatAddressList(email.to)} />
              <HeaderRow label="Objet" value={email.subject || ''} />
              <HeaderRow label="Date" value={formattedDate} />
            </div>

            {email.attachments && email.attachments.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '14px 32px',
                  maxWidth: 800,
                  borderBottom: '1px solid var(--color-border, #e5e7eb)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--color-text-tertiary, #9ca3af)',
                  }}
                >
                  <PaperclipIcon />
                  {email.attachments.length} pièce
                  {email.attachments.length > 1 ? 's jointes' : ' jointe'}
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {email.attachments.map((att, i) => (
                    <li
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        fontSize: 14,
                        padding: '2px 0',
                        color: 'var(--color-text-primary, #1f2937)',
                      }}
                    >
                      <span style={{ wordBreak: 'break-word' }}>
                        {att.filename || '(sans nom)'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #9ca3af)' }}>
                        {att.mimeType}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sanitizedHtml !== null ? (
              <div
                className="markdown-preview__rendered"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            ) : email.text ? (
              <pre className="markdown-preview__source">{email.text}</pre>
            ) : (
              <div className="markdown-preview__rendered">
                <p style={{ color: 'var(--color-text-tertiary, #9ca3af)' }}>
                  Ce message n'a pas de contenu.
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};

export default EmailPreview;

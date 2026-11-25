import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { downloadText } from './csv';

/** An enrollment JWT with Download (.jwt) and Copy buttons. */
export const JwtPanel: React.FC<{ jwt: string; fileName: string; expiresAt?: string }> = ({ jwt, fileName, expiresAt }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <textarea
        readOnly
        value={jwt}
        rows={4}
        aria-label="Enrollment JWT"
        className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono text-[11px] break-all"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => downloadText(`${fileName}.jwt`, jwt, 'application/jwt')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download .jwt</span>
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(jwt).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-[var(--ac-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy JWT'}</span>
        </button>
        {expiresAt && (
          <span className="text-[11px] text-[var(--ac-muted)]">Expires {new Date(expiresAt).toLocaleString()}</span>
        )}
      </div>
    </div>
  );
};

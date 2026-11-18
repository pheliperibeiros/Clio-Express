import React from 'react';

interface SealMarkProps {
  className?: string;
  size?: number;
}

/**
 * Assinatura do Clio: o selo do lacre.
 * Um anel fino com o núcleo cheio, desenhado em latão. Marca apenas o que é
 * probatório — a tarja do vídeo, o arquivo de destino e o extrato.
 */
export const SealMark: React.FC<SealMarkProps> = ({ className = '', size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className={`shrink-0 ${className}`}
  >
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" />
  </svg>
);

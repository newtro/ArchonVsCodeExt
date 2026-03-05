/**
 * SVG icon components — 16x16, uses currentColor for VS Code theme compatibility.
 */

import React from 'react';

const svgProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function PlusIcon() {
  return <svg {...svgProps}><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></svg>;
}

export function SendIcon() {
  return <svg {...svgProps}><path d="M2 8l10-5-3 5 3 5z" fill="currentColor" stroke="none" /></svg>;
}

export function StopIcon() {
  return <svg {...svgProps}><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" /></svg>;
}

export function PaperclipIcon() {
  return <svg {...svgProps}><path d="M12.5 6l-5.5 5.5a2.12 2.12 0 01-3-3L9.5 3a1.41 1.41 0 012 2L6 10.5" /></svg>;
}

export function CloseIcon() {
  return <svg {...svgProps} width={12} height={12} viewBox="0 0 12 12"><line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" /></svg>;
}

export function FileIcon() {
  return <svg {...svgProps}><path d="M9 2H4.5a1 1 0 00-1 1v10a1 1 0 001 1h7a1 1 0 001-1V5z" /><polyline points="9,2 9,5 12.5,5" /></svg>;
}

export function HistoryIcon() {
  return <svg {...svgProps}><circle cx="8" cy="8" r="5.5" /><polyline points="8,5 8,8 10.5,9.5" /></svg>;
}

export function ChevronDownIcon() {
  return <svg {...svgProps} width={12} height={12} viewBox="0 0 12 12"><polyline points="3,4.5 6,7.5 9,4.5" /></svg>;
}

export function ClipboardIcon() {
  return <svg {...svgProps}><rect x="5" y="2" width="6" height="3" rx="0.5" /><path d="M4 4H3.5a1 1 0 00-1 1v8a1 1 0 001 1h9a1 1 0 001-1V5a1 1 0 00-1-1H12" /></svg>;
}

export function RefreshIcon() {
  return <svg {...svgProps}><path d="M13 3l-1.5 3H14" /><path d="M3 13l1.5-3H2" /><path d="M11.5 6A5 5 0 004 6.5" /><path d="M4.5 10A5 5 0 0012 9.5" /></svg>;
}

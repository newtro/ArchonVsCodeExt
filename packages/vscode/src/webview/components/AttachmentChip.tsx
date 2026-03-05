/**
 * AttachmentChip — shows an attached file or image with a remove button.
 */

import React from 'react';
import { CloseIcon } from './Icons';

interface Props {
  name: string;
  type: 'file' | 'image';
  dataUri?: string;
  onRemove: () => void;
}

export function AttachmentChip({ name, type, dataUri, onRemove }: Props) {
  return (
    <div className="attachment-chip">
      {type === 'image' && dataUri && (
        <img src={dataUri} alt={name} className="attachment-thumb" />
      )}
      <span className="attachment-name">{name}</span>
      <button className="attachment-remove" onClick={onRemove} title="Remove">
        <CloseIcon />
      </button>
    </div>
  );
}

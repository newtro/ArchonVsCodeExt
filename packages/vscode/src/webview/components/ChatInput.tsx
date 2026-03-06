/**
 * ChatInput — enhanced input area with model selector, icons, image paste,
 * file attachments, and @ command for workspace file picking.
 */

import React, { useState, useRef, useCallback } from 'react';
import type { ModelInfo, Attachment, PipelineInfo, ProviderInfo } from '@archon/core';
import { SendIcon, StopIcon, PaperclipIcon } from './Icons';
import { AttachmentChip } from './AttachmentChip';
import { FilePickerPopup } from './FilePickerPopup';
import type { SkillPickerItem } from './SkillPickerPopup';
import { SkillPickerPopup } from './SkillPickerPopup';
import type { ContextMeterData } from '@archon/core';
import { ContextMeter } from './ContextMeter';

interface Props {
  onSend: (content: string, attachments: Attachment[]) => void;
  onCancel: () => void;
  isLoading: boolean;
  disabled: boolean;
  models: ModelInfo[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  onPickFile: () => void;
  workspaceFiles: string[];
  attachments: Attachment[];
  onAddAttachment: (attachment: Attachment) => void;
  onRemoveAttachment: (id: string) => void;
  pipelines: PipelineInfo[];
  selectedPipelineId: string;
  onPipelineChange: (pipelineId: string) => void;
  providers: ProviderInfo[];
  activeProviderId: string;
  onProviderChange: (providerId: string) => void;
  skills: SkillPickerItem[];
  contextMeter?: ContextMeterData | null;
  onContextCompress?: () => void;
  onContextReset?: () => void;
}

export function ChatInput({
  onSend, onCancel, isLoading, disabled,
  models, selectedModelId, onModelChange,
  onPickFile, workspaceFiles,
  attachments, onAddAttachment, onRemoveAttachment,
  pipelines, selectedPipelineId, onPipelineChange,
  providers, activeProviderId, onProviderChange,
  skills,
  contextMeter, onContextCompress, onContextReset,
}: Props) {
  const [input, setInput] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (input.trim() && !disabled) {
      onSend(input.trim(), attachments);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [input, disabled, onSend, attachments]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFilePicker || showSkillPicker) return; // Let popup handle keys
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Auto-resize textarea
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';

    // Detect @ trigger for file picker
    const cursorPos = ta.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([^\s]*)$/);
    if (atMatch) {
      setShowFilePicker(true);
      setFileQuery(atMatch[1]);
    } else {
      setShowFilePicker(false);
    }

    // Detect / trigger for skill picker (only at start of input)
    const slashMatch = textBefore.match(/^\/([^\s]*)$/);
    if (slashMatch && skills.length > 0) {
      setShowSkillPicker(true);
      setSkillQuery(slashMatch[1]);
    } else {
      setShowSkillPicker(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUri = reader.result as string;
          onAddAttachment({
            id: Math.random().toString(36).slice(2, 11),
            name: file.name || 'pasted-image.png',
            type: 'image',
            content: dataUri,
            dataUri,
          });
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const handleSkillSelect = (skillName: string) => {
    setShowSkillPicker(false);
    // Replace the /query text with the full /skillName
    setInput(`/${skillName} `);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = skillName.length + 2; // after "/<name> "
        ta.selectionStart = pos;
        ta.selectionEnd = pos;
      }
    }, 0);
  };

  const handleFileSelect = (filePath: string) => {
    setShowFilePicker(false);
    // Replace the @query text with the file path
    const cursorPos = textareaRef.current?.selectionStart ?? input.length;
    const textBefore = input.slice(0, cursorPos);
    const textAfter = input.slice(cursorPos);
    const newBefore = textBefore.replace(/@[^\s]*$/, `@${filePath} `);
    setInput(newBefore + textAfter);

    onAddAttachment({
      id: Math.random().toString(36).slice(2, 11),
      name: filePath,
      type: 'file',
      content: '', // Content will be resolved by extension host
    });

    // Refocus textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  return (
    <div className="chat-input">
      {/* File picker popup */}
      {showFilePicker && (
        <FilePickerPopup
          query={fileQuery}
          files={workspaceFiles}
          onSelect={handleFileSelect}
          onClose={() => setShowFilePicker(false)}
        />
      )}

      {/* Skill picker popup */}
      {showSkillPicker && (
        <SkillPickerPopup
          query={skillQuery}
          skills={skills}
          onSelect={handleSkillSelect}
          onClose={() => setShowSkillPicker(false)}
        />
      )}

      <div className="chat-input-card">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map(a => (
              <AttachmentChip
                key={a.id}
                name={a.name}
                type={a.type}
                dataUri={a.dataUri}
                onRemove={() => onRemoveAttachment(a.id)}
              />
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={disabled ? 'Set API key to start...' : 'Type a message... (@ to attach, / for skills)'}
          disabled={disabled}
          rows={1}
        />

        {/* Bottom bar: selectors + actions */}
        <div className="input-bottom-bar">
          <div className="input-selectors">
            {providers.length > 1 && (
              <select
                className="input-provider-selector"
                value={activeProviderId}
                onChange={(e) => onProviderChange(e.target.value)}
                title="Select provider"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.name}{!p.available ? ' (unavailable)' : ''}
                  </option>
                ))}
              </select>
            )}
            <select
              className="input-model-selector"
              value={selectedModelId}
              onChange={(e) => onModelChange(e.target.value)}
              title="Select model"
            >
              {!selectedModelId && <option value="">Model...</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            {activeProviderId !== 'claude-cli' && (
              <select
                className="input-pipeline-selector"
                value={selectedPipelineId}
                onChange={(e) => onPipelineChange(e.target.value)}
                title="Select pipeline"
                disabled={isLoading}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {pipelines.length === 0 && <option value="default">Default</option>}
              </select>
            )}
          </div>

          <div className="input-actions">
            {contextMeter && (
              <ContextMeter
                data={contextMeter}
                onCompress={onContextCompress}
                onReset={onContextReset}
              />
            )}
            <button
              className="icon-btn"
              onClick={onPickFile}
              title="Attach file"
              disabled={disabled}
            >
              <PaperclipIcon />
            </button>

            {isLoading && (
              <button className="icon-btn stop-btn" onClick={onCancel} title="Stop">
                <StopIcon />
              </button>
            )}
            <button
              className="send-btn"
              onClick={handleSubmit}
              disabled={!input.trim() || disabled}
              title={isLoading ? 'Send follow-up (Enter)' : 'Send (Enter)'}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';

interface ConvertToSkillWizardProps {
  /** Pre-generated skill data from the AI analysis of the conversation. */
  generatedSkill: {
    name: string;
    description: string;
    tags: string[];
    content: string;
  } | null;
  /** Whether we're waiting for the AI to analyze the conversation. */
  isGenerating: boolean;
  onSave: (skill: {
    name: string; description: string; scope: 'global' | 'project';
    enabled: boolean; tags: string[]; content: string;
  }) => void;
  onCancel: () => void;
}

export function ConvertToSkillWizard({ generatedSkill, isGenerating, onSave, onCancel }: ConvertToSkillWizardProps) {
  const [name, setName] = useState(generatedSkill?.name ?? '');
  const [description, setDescription] = useState(generatedSkill?.description ?? '');
  const [scope, setScope] = useState<'global' | 'project'>('project');
  const [tagsStr, setTagsStr] = useState(generatedSkill?.tags.join(', ') ?? '');
  const [content, setContent] = useState(generatedSkill?.content ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  // Update fields when generated skill arrives
  React.useEffect(() => {
    if (generatedSkill) {
      setName(generatedSkill.name);
      setDescription(generatedSkill.description);
      setTagsStr(generatedSkill.tags.join(', '));
      setContent(generatedSkill.content);
    }
  }, [generatedSkill]);

  const handleSave = () => {
    const errs: string[] = [];
    if (!name) errs.push('Name is required');
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) errs.push('Name must be lowercase letters, numbers, and hyphens');
    if (!description) errs.push('Description is required');
    if (!content.trim()) errs.push('Content is required');
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    onSave({
      name,
      description,
      scope,
      enabled: true,
      tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
      content,
    });
  };

  if (isGenerating) {
    return (
      <div className="convert-skill-wizard">
        <div className="convert-skill-loading">
          <div className="convert-skill-spinner" />
          <p>Analyzing conversation to extract a reusable skill...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="convert-skill-wizard">
      <div className="convert-skill-header">
        <h3>Convert Conversation to Skill</h3>
        <div className="convert-skill-actions">
          <button className="skills-btn" onClick={onCancel}>Cancel</button>
          <button className="skills-btn skills-btn-primary" onClick={handleSave}>Save Skill</button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="skill-editor-errors">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div className="convert-skill-body">
        <div className="skill-field">
          <label>Skill Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="my-skill"
          />
        </div>

        <div className="skill-field">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What this skill does"
          />
        </div>

        <div className="skill-field-row">
          <div className="skill-field">
            <label>Scope</label>
            <select value={scope} onChange={e => setScope(e.target.value as 'global' | 'project')}>
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </div>
          <div className="skill-field">
            <label>Tags</label>
            <input
              type="text"
              value={tagsStr}
              onChange={e => setTagsStr(e.target.value)}
              placeholder="tag1, tag2"
            />
          </div>
        </div>

        <div className="skill-field convert-skill-content">
          <label>Skill Instructions (generated from conversation, edit as needed)</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

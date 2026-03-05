import React, { useState, useMemo, useRef, useCallback } from 'react';
import type { SkillInfo, SkillTemplate, SkillVersion } from '@archon/core';

interface SkillsPanelProps {
  skills: SkillInfo[];
  templates: SkillTemplate[];
  versions: SkillVersion[];
  versionsSkillName: string | null;
  versionContent: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  onSave: (skill: {
    name: string; description: string; scope: 'global' | 'project';
    enabled: boolean; tags: string[]; content: string;
    trigger?: string; modelInvocable?: boolean;
  }) => void;
  onRefresh: () => void;
  onLoadTemplates: () => void;
  onLoadSkillContent: (skillName: string) => void;
  onLoadVersions: (skillName: string) => void;
  onLoadVersionContent: (skillName: string, versionPath: string, version: number) => void;
  onRestoreVersion: (skillName: string, versionPath: string) => void;
  onReorder: (orderedNames: string[]) => void;
  editingSkillContent: string | null;
  editingSkillName: string | null;
}

type ViewMode = 'dashboard' | 'editor' | 'templates';
type ScopeFilter = 'all' | 'global' | 'project';
type StatusFilter = 'all' | 'enabled' | 'disabled';
type TagFilter = 'all' | string;

export function SkillsPanel({
  skills, templates, versions, versionsSkillName, versionContent,
  editingSkillContent, editingSkillName,
  onToggle, onDelete, onSave, onRefresh,
  onLoadTemplates, onLoadSkillContent, onLoadVersions, onLoadVersionContent, onRestoreVersion, onReorder,
}: SkillsPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [draggedSkill, setDraggedSkill] = useState<string | null>(null);
  const [skillOrder, setSkillOrder] = useState<string[]>([]);

  // Collect all unique tags from skills
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    skills.forEach(s => s.tags.forEach(t => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [skills]);

  const filtered = useMemo(() => {
    let list = skills;

    // Apply custom ordering if exists
    if (skillOrder.length > 0) {
      const orderMap = new Map(skillOrder.map((name, idx) => [name, idx]));
      list = [...list].sort((a, b) => {
        const aIdx = orderMap.get(a.name) ?? 999;
        const bIdx = orderMap.get(b.name) ?? 999;
        return aIdx - bIdx;
      });
    }

    return list.filter(s => {
      if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false;
      if (statusFilter === 'enabled' && !s.enabled) return false;
      if (statusFilter === 'disabled' && s.enabled) return false;
      if (tagFilter !== 'all' && !s.tags.includes(tagFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return s.name.includes(q) || s.description.toLowerCase().includes(q) ||
          s.tags.some(t => t.toLowerCase().includes(q));
      }
      return true;
    });
  }, [skills, scopeFilter, statusFilter, tagFilter, search, skillOrder]);

  const handleNew = () => {
    setEditingSkill(null);
    setViewMode('editor');
  };

  const handleFromTemplate = () => {
    onLoadTemplates();
    setViewMode('templates');
  };

  const handleSelectTemplate = (template: SkillTemplate) => {
    // Pre-fill editor from template
    setEditingSkill({
      name: template.name,
      description: template.description,
      scope: 'project',
      enabled: true,
      tags: template.tags,
      type: 'simple',
      trigger: template.trigger,
      modelInvocable: true,
      hasScripts: false,
      path: '',
      _templateContent: template.content,
    } as SkillInfo & { _templateContent?: string });
    setViewMode('editor');
  };

  const handleEdit = (skill: SkillInfo) => {
    setEditingSkill(skill);
    onLoadSkillContent(skill.name);
    setViewMode('editor');
  };

  const handleEditorSave = (data: {
    name: string; description: string; scope: 'global' | 'project';
    enabled: boolean; tags: string[]; content: string;
    trigger?: string; modelInvocable?: boolean;
  }) => {
    onSave(data);
    setViewMode('dashboard');
    setEditingSkill(null);
  };

  const handleEditorCancel = () => {
    setViewMode('dashboard');
    setEditingSkill(null);
  };

  // Drag and drop handlers
  const handleDragStart = (skillName: string) => {
    setDraggedSkill(skillName);
  };

  const handleDragOver = (e: React.DragEvent, targetName: string) => {
    e.preventDefault();
    if (!draggedSkill || draggedSkill === targetName) return;
  };

  const handleDrop = (targetName: string) => {
    if (!draggedSkill || draggedSkill === targetName) {
      setDraggedSkill(null);
      return;
    }

    const currentOrder = skillOrder.length > 0
      ? [...skillOrder]
      : skills.map(s => s.name);

    const dragIdx = currentOrder.indexOf(draggedSkill);
    const dropIdx = currentOrder.indexOf(targetName);
    if (dragIdx === -1 || dropIdx === -1) {
      setDraggedSkill(null);
      return;
    }

    currentOrder.splice(dragIdx, 1);
    currentOrder.splice(dropIdx, 0, draggedSkill);
    setSkillOrder(currentOrder);
    onReorder(currentOrder);
    setDraggedSkill(null);
  };

  if (viewMode === 'editor') {
    return (
      <SkillEditor
        skill={editingSkill}
        loadedContent={editingSkillName === editingSkill?.name ? editingSkillContent : null}
        versions={versionsSkillName === editingSkill?.name ? versions : []}
        versionContent={versionContent}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
        onLoadVersions={onLoadVersions}
        onLoadVersionContent={onLoadVersionContent}
        onRestoreVersion={onRestoreVersion}
      />
    );
  }

  if (viewMode === 'templates') {
    return (
      <TemplateGallery
        templates={templates}
        existingSkillNames={skills.map(s => s.name)}
        onSelect={handleSelectTemplate}
        onCancel={() => setViewMode('dashboard')}
      />
    );
  }

  return (
    <div className="skills-panel">
      <div className="skills-header">
        <h2>Skills</h2>
        <div className="skills-header-actions">
          <button className="skills-btn skills-btn-primary" onClick={handleNew}>+ New Skill</button>
          <button className="skills-btn" onClick={handleFromTemplate}>From Template</button>
          <button className="skills-btn" onClick={onRefresh} title="Refresh skills">Refresh</button>
        </div>
      </div>

      <div className="skills-filters">
        <input
          type="text"
          className="skills-search"
          placeholder="Search skills..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="skills-filter-group">
          <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value as ScopeFilter)}>
            <option value="all">All Scopes</option>
            <option value="global">Global</option>
            <option value="project">Project</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">All Status</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          {allTags.length > 0 && (
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
              <option value="all">All Tags</option>
              {allTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="skills-empty">
          {skills.length === 0 ? (
            <>
              <p>No skills yet.</p>
              <p>Create your first skill, pick from a template, or ask the AI to create one for you.</p>
              <div className="skills-empty-actions">
                <button className="skills-btn skills-btn-primary" onClick={handleNew}>Create Skill</button>
                <button className="skills-btn" onClick={handleFromTemplate}>Browse Templates</button>
              </div>
            </>
          ) : (
            <p>No skills match your filters.</p>
          )}
        </div>
      ) : (
        <div className="skills-grid">
          {filtered.map(skill => (
            <SkillCard
              key={skill.name}
              skill={skill}
              onToggle={onToggle}
              onEdit={handleEdit}
              onDelete={onDelete}
              isDragging={draggedSkill === skill.name}
              onDragStart={() => handleDragStart(skill.name)}
              onDragOver={(e) => handleDragOver(e, skill.name)}
              onDrop={() => handleDrop(skill.name)}
              onDragEnd={() => setDraggedSkill(null)}
            />
          ))}
        </div>
      )}

      <div className="skills-footer">
        <span className="skills-count">
          {skills.length} skill{skills.length !== 1 ? 's' : ''} total
          {filtered.length !== skills.length && ` (${filtered.length} shown)`}
        </span>
        {allTags.length > 0 && (
          <span className="skills-tag-summary">
            {allTags.length} tag{allTags.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Template Gallery ──

interface TemplateGalleryProps {
  templates: SkillTemplate[];
  existingSkillNames: string[];
  onSelect: (template: SkillTemplate) => void;
  onCancel: () => void;
}

function TemplateGallery({ templates, existingSkillNames, onSelect, onCancel }: TemplateGalleryProps) {
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    templates.forEach(t => t.tags.forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (selectedTag !== 'all' && !t.tags.includes(selectedTag)) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.name.includes(q) || t.description.toLowerCase().includes(q) ||
          t.tags.some(tag => tag.toLowerCase().includes(q));
      }
      return true;
    });
  }, [templates, selectedTag, search]);

  return (
    <div className="skills-panel">
      <div className="skills-header">
        <h2>Template Gallery</h2>
        <div className="skills-header-actions">
          <button className="skills-btn" onClick={onCancel}>Back to Dashboard</button>
        </div>
      </div>

      <div className="skills-filters">
        <input
          type="text"
          className="skills-search"
          placeholder="Search templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="skills-filter-group">
          <select value={selectedTag} onChange={e => setSelectedTag(e.target.value)}>
            <option value="all">All Categories</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="skills-grid">
        {filtered.map(template => {
          const alreadyInstalled = existingSkillNames.includes(template.name);
          return (
            <div key={template.name} className={`skill-card template-card ${alreadyInstalled ? 'template-card-installed' : ''}`}>
              <div className="skill-card-header">
                <div className="skill-card-title">
                  <span className="skill-card-name">/{template.name}</span>
                  {alreadyInstalled && <span className="skill-card-badge template-badge-installed">installed</span>}
                </div>
              </div>
              <p className="skill-card-desc">{template.description}</p>
              {template.tags.length > 0 && (
                <div className="skill-card-tags">
                  {template.tags.map(tag => (
                    <span key={tag} className="skill-tag">{tag}</span>
                  ))}
                </div>
              )}
              <div className="skill-card-actions">
                <button
                  className="skills-btn skills-btn-sm skills-btn-primary"
                  onClick={() => onSelect(template)}
                >
                  {alreadyInstalled ? 'Customize Copy' : 'Use Template'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="skills-footer">
        <span className="skills-count">{templates.length} template{templates.length !== 1 ? 's' : ''} available</span>
      </div>
    </div>
  );
}

// ── Skill Card ──

interface SkillCardProps {
  skill: SkillInfo;
  onToggle: (name: string, enabled: boolean) => void;
  onEdit: (skill: SkillInfo) => void;
  onDelete: (name: string) => void;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function SkillCard({ skill, onToggle, onEdit, onDelete, isDragging, onDragStart, onDragOver, onDrop, onDragEnd }: SkillCardProps) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  return (
    <div
      className={`skill-card ${skill.enabled ? '' : 'skill-card-disabled'} ${isDragging ? 'skill-card-dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="skill-card-header">
        <div className="skill-card-title">
          <span className="skill-card-drag-handle" title="Drag to reorder">:::</span>
          <span className="skill-card-name">/{skill.name}</span>
          <span className={`skill-card-scope skill-scope-${skill.scope}`}>{skill.scope}</span>
          {skill.hasScripts && <span className="skill-card-badge">scripts</span>}
        </div>
        <label className="skill-toggle" title={skill.enabled ? 'Disable' : 'Enable'}>
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={() => onToggle(skill.name, !skill.enabled)}
          />
          <span className="skill-toggle-slider" />
        </label>
      </div>

      <p className="skill-card-desc">{skill.description}</p>

      {skill.tags.length > 0 && (
        <div className="skill-card-tags">
          {skill.tags.map(tag => (
            <span key={tag} className="skill-tag">{tag}</span>
          ))}
        </div>
      )}

      {skill.trigger && (
        <div className="skill-card-trigger">
          Trigger: <code>{skill.trigger}</code>
        </div>
      )}

      <div className="skill-card-actions">
        <button className="skills-btn skills-btn-sm" onClick={() => onEdit(skill)}>Edit</button>
        {!showConfirmDelete ? (
          <button className="skills-btn skills-btn-sm skills-btn-danger" onClick={() => setShowConfirmDelete(true)}>Delete</button>
        ) : (
          <span className="skill-confirm-delete">
            <span>Sure?</span>
            <button className="skills-btn skills-btn-sm skills-btn-danger" onClick={() => { onDelete(skill.name); setShowConfirmDelete(false); }}>Yes</button>
            <button className="skills-btn skills-btn-sm" onClick={() => setShowConfirmDelete(false)}>No</button>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Skill Editor ──

interface SkillEditorProps {
  skill: (SkillInfo & { _templateContent?: string }) | null;
  loadedContent: string | null;
  versions: SkillVersion[];
  versionContent: string | null;
  onSave: (data: {
    name: string; description: string; scope: 'global' | 'project';
    enabled: boolean; tags: string[]; content: string;
    trigger?: string; modelInvocable?: boolean;
  }) => void;
  onCancel: () => void;
  onLoadVersions: (skillName: string) => void;
  onLoadVersionContent: (skillName: string, versionPath: string, version: number) => void;
  onRestoreVersion: (skillName: string, versionPath: string) => void;
}

function SkillEditor({ skill, loadedContent, versions, versionContent, onSave, onCancel, onLoadVersions, onLoadVersionContent, onRestoreVersion }: SkillEditorProps) {
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [scope, setScope] = useState<'global' | 'project'>(skill?.scope ?? 'project');
  const [enabled, setEnabled] = useState(skill?.enabled ?? true);
  const [tagsStr, setTagsStr] = useState(skill?.tags.join(', ') ?? '');
  const [trigger, setTrigger] = useState(skill?.trigger ?? '');
  const [modelInvocable, setModelInvocable] = useState(skill?.modelInvocable ?? true);
  const [content, setContent] = useState(skill?._templateContent ?? '');
  const [contentLoaded, setContentLoaded] = useState(!!skill?._templateContent || !skill);
  const [errors, setErrors] = useState<string[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<SkillVersion | null>(null);

  // Populate content when loaded from disk (for existing skills)
  React.useEffect(() => {
    if (loadedContent !== null && !contentLoaded) {
      setContent(loadedContent);
      setContentLoaded(true);
    }
  }, [loadedContent, contentLoaded]);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTag, setNewTag] = useState('');

  const isNew = !skill || !!skill._templateContent;
  const hasExistingPath = skill?.path && !skill._templateContent;

  // Load versions when panel opens
  const handleToggleVersions = () => {
    if (!showVersions && hasExistingPath) {
      onLoadVersions(skill!.name);
    }
    setShowVersions(!showVersions);
    setSelectedVersion(null);
  };

  const handleViewVersion = (v: SkillVersion) => {
    setSelectedVersion(v);
    onLoadVersionContent(skill!.name, v.path, v.version);
  };

  const handleRestoreVersion = (v: SkillVersion) => {
    onRestoreVersion(skill!.name, v.path);
    setShowVersions(false);
    setSelectedVersion(null);
  };

  // Tag management
  const currentTags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

  const handleAddTag = () => {
    const tag = newTag.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (tag && !currentTags.includes(tag)) {
      setTagsStr(currentTags.length > 0 ? `${tagsStr}, ${tag}` : tag);
    }
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    const updated = currentTags.filter(t => t !== tag);
    setTagsStr(updated.join(', '));
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!name) errs.push('Name is required');
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) errs.push('Name must be lowercase letters, numbers, and hyphens');
    else if (name.length > 64) errs.push('Name must be 64 characters or fewer');
    if (!description) errs.push('Description is required');
    else if (description.length > 1024) errs.push('Description must be 1024 characters or fewer');
    if (!content.trim() && isNew) errs.push('Content is required');
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    onSave({
      name,
      description,
      scope,
      enabled,
      tags: currentTags,
      content,
      trigger: trigger || undefined,
      modelInvocable,
    });
  };

  return (
    <div className="skill-editor">
      <div className="skill-editor-header">
        <h2>{isNew ? 'Create New Skill' : `Edit: /${skill!.name}`}</h2>
        <div className="skill-editor-header-actions">
          {hasExistingPath && (
            <button
              className={`skills-btn ${showVersions ? 'skills-btn-active' : ''}`}
              onClick={handleToggleVersions}
            >
              History
            </button>
          )}
          <button className="skills-btn" onClick={onCancel}>Cancel</button>
          <button className="skills-btn skills-btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="skill-editor-errors">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div className="skill-editor-body">
        <div className="skill-editor-meta">
          <div className="skill-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-skill"
              disabled={!isNew}
            />
          </div>

          <div className="skill-field">
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this skill does and when to use it"
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
              <label>Status</label>
              <select value={enabled ? 'enabled' : 'disabled'} onChange={e => setEnabled(e.target.value === 'enabled')}>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>

          <div className="skill-field">
            <label>
              Tags
              <button className="skills-btn-inline" onClick={() => setShowTagManager(!showTagManager)}>
                {showTagManager ? 'Hide' : 'Manage'}
              </button>
            </label>
            <div className="skill-tag-list">
              {currentTags.map(tag => (
                <span key={tag} className="skill-tag skill-tag-removable" onClick={() => handleRemoveTag(tag)}>
                  {tag} &times;
                </span>
              ))}
              {currentTags.length === 0 && <span className="skill-field-hint">No tags</span>}
            </div>
            {showTagManager && (
              <div className="skill-tag-manager">
                <input
                  type="text"
                  value={newTag}
                  onChange={e => setNewTag(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                  placeholder="Add tag..."
                />
                <button className="skills-btn skills-btn-sm" onClick={handleAddTag}>Add</button>
              </div>
            )}
          </div>

          <div className="skill-field">
            <label>Trigger <span className="skill-field-hint">(auto-detection condition)</span></label>
            <input
              type="text"
              value={trigger}
              onChange={e => setTrigger(e.target.value)}
              placeholder="file:.py, repo:Dockerfile"
            />
          </div>

          <div className="skill-field-check">
            <label>
              <input
                type="checkbox"
                checked={modelInvocable}
                onChange={e => setModelInvocable(e.target.checked)}
              />
              Agent can auto-invoke this skill
            </label>
          </div>

          {skill?.hasScripts && (
            <div className="skill-scripts-info">
              <label>Scripts</label>
              <p className="skill-field-hint">This is a rich skill with executable scripts. Edit the scripts directory directly in your file explorer.</p>
              <code className="skill-scripts-path">{skill.path}/scripts/</code>
            </div>
          )}
        </div>

        <div className="skill-editor-content">
          <label>Instructions (Markdown)</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={"# My Skill\n\nDescribe what the agent should do when this skill is invoked.\n\n## Steps\n1. First, do X\n2. Then, do Y\n3. Finally, do Z"}
            spellCheck={false}
          />
        </div>

        {/* Version History Sidebar */}
        {showVersions && (
          <div className="skill-version-panel">
            <h3>Version History</h3>
            {versions.length === 0 ? (
              <p className="skill-field-hint">No previous versions</p>
            ) : (
              <div className="skill-version-list">
                {versions.map(v => (
                  <div
                    key={v.path}
                    className={`skill-version-item ${selectedVersion?.path === v.path ? 'skill-version-selected' : ''}`}
                    onClick={() => handleViewVersion(v)}
                  >
                    <span className="skill-version-label">v{v.version}</span>
                    <span className="skill-version-date">{new Date(v.timestamp).toLocaleString()}</span>
                    <button
                      className="skills-btn skills-btn-sm"
                      onClick={(e) => { e.stopPropagation(); handleRestoreVersion(v); }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            {selectedVersion && versionContent && (
              <div className="skill-version-preview">
                <h4>v{selectedVersion.version} Preview</h4>
                <pre className="skill-version-content">{versionContent}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

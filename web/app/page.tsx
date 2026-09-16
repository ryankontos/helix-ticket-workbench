'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { defaultTemplates, demoToolkitResults, fieldOptions, ModificationTemplate, resolveTemplate, Ticket, tickets, ToolkitResult, variableTokens, Workspace } from './data';

const bridgeDefault = process.env.NEXT_PUBLIC_BRIDGE_URL || 'http://127.0.0.1:47831';
const screenshotDefault = process.env.NEXT_PUBLIC_SCREENSHOT_DIR || '~/Desktop/PC-Toolkit-Legal-Hold';

const nav: Array<{ id: Workspace; icon: string; label: string }> = [
  { id: 'queue', icon: '▤', label: 'Ticket queue' },
  { id: 'toolkit', icon: '⌁', label: 'PC Toolkit' },
  { id: 'templates', icon: '◇', label: 'Templates' },
  { id: 'activity', icon: '◷', label: 'Dry runs' },
];

type ActivityItem = { id: string; time: string; ticket: string; template: string; summary: string };

function statusClass(value: string) { return value.toLowerCase().replaceAll(' ', '-'); }
function parseSerials(value: string) { return [...new Set(value.toUpperCase().split(/[\s,;]+/).map(v => v.trim()).filter(Boolean))]; }
function holdLabel(value: ToolkitResult['overall_legal_hold']) { return value === 'on_legal_hold' ? 'On legal hold' : value === 'not_on_legal_hold' ? 'Not flagged' : 'Needs review'; }
function nowLabel() { return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date()); }

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace>('queue');
  const [selectedTicket, setSelectedTicket] = useState<Ticket>(tickets[0]);
  const [search, setSearch] = useState('');
  const [templates, setTemplates] = useState<ModificationTemplate[]>(defaultTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState('mark-rebuilt');
  const [templateDraft, setTemplateDraft] = useState<ModificationTemplate>(defaultTemplates[0]);
  const [toolkitInput, setToolkitInput] = useState('C02ZK41\nFVFG91K');
  const [toolkitResults, setToolkitResults] = useState<ToolkitResult[]>([]);
  const [outputDir, setOutputDir] = useState(screenshotDefault);
  const [toolkitBusy, setToolkitBusy] = useState<'api' | 'screenshots' | null>(null);
  const [toolkitError, setToolkitError] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(bridgeDefault);
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);
  const [closureOpen, setClosureOpen] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([
    { id: 'initial-1', time: '09:42', ticket: 'INC00177912', template: 'Mark as rebuilt', summary: 'Dry run exported · 6 proposed operations' },
    { id: 'initial-2', time: 'Yesterday', ticket: 'INC00177550', template: 'Add evidence note', summary: 'Preview created · no Helix changes sent' },
  ]);
  const [toast, setToast] = useState('');

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
  const matchingToolkit = toolkitResults.find(r => r.serial.toUpperCase() === selectedTicket.serial.toUpperCase());
  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tickets.filter(t => [t.id, t.serial, t.title, t.customer, t.owner].some(v => v.toLowerCase().includes(q))) : tickets;
  }, [search]);

  useEffect(() => {
    fetch(`${bridgeUrl}/api/templates`).then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      if (Array.isArray(data.templates) && data.templates.length) {
        setTemplates(data.templates);
        const selected = data.templates.find((template: ModificationTemplate) => template.id === selectedTemplateId) || data.templates[0];
        setSelectedTemplateId(selected.id);
        setTemplateDraft(structuredClone(selected));
      }
    }).catch(() => undefined);
    checkBridge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function checkBridge() {
    try { const response = await fetch(`${bridgeUrl}/health`); setBridgeOnline(response.ok); }
    catch { setBridgeOnline(false); }
  }

  async function runToolkit(mode: 'api' | 'screenshots') {
    const serials = parseSerials(toolkitInput);
    if (!serials.length) { setToolkitError('Enter at least one serial number.'); return; }
    setToolkitBusy(mode); setToolkitError('');
    try {
      const response = await fetch(`${bridgeUrl}/api/pc-toolkit/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serials, captureScreenshots: mode === 'screenshots', outputDir, attempts: 6, retryDelay: 1.5 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The local bridge returned an error.');
      setToolkitResults(data.results || []); setBridgeOnline(true); setToast(mode === 'screenshots' ? 'Screenshots and results saved' : 'PC Toolkit lookup complete');
    } catch (error) {
      setBridgeOnline(false); setToolkitError(error instanceof Error ? error.message : 'Could not reach the local bridge.');
    } finally { setToolkitBusy(null); }
  }

  function loadDemo() { setToolkitResults(demoToolkitResults); setToolkitError(''); setToast('Loaded synthetic sample results'); }

  async function saveTemplate() {
    const next = templates.map(t => t.id === templateDraft.id ? templateDraft : t);
    setTemplates(next);
    try {
      await fetch(`${bridgeUrl}/api/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templates: next }) });
      setToast('Template saved locally');
    } catch { setToast('Template kept for this session'); }
  }

  function addTemplate() {
    const template: ModificationTemplate = { id: `template-${Date.now()}`, name: 'Untitled modification', description: 'Describe when this template should be used.', accent: '#087f75', guard: 'Manual review required', actions: [{ id: `action-${Date.now()}`, enabled: true, kind: 'field', field: 'Status', value: 'In Progress' }] };
    setTemplates([...templates, template]); setSelectedTemplateId(template.id); setTemplateDraft(template);
  }

  function selectTemplate(id: string) {
    const selected = templates.find(template => template.id === id);
    if (!selected) return;
    setSelectedTemplateId(id);
    setTemplateDraft(structuredClone(selected));
  }

  function addAction() {
    setTemplateDraft({ ...templateDraft, actions: [...templateDraft.actions, { id: `action-${Date.now()}`, enabled: true, kind: 'field', field: 'Status', value: '' }] });
  }

  function updateAction(id: string, patch: Partial<ModificationTemplate['actions'][number]>) {
    setTemplateDraft({ ...templateDraft, actions: templateDraft.actions.map(a => a.id === id ? { ...a, ...patch } : a) });
  }

  function prepareClosure() {
    const rebuild = templates.find(template => template.id === 'mark-rebuilt');
    if (rebuild) { setSelectedTemplateId(rebuild.id); setTemplateDraft(structuredClone(rebuild)); }
    setDryRun(null); setClosureOpen(true);
  }

  function generateDryRun() {
    const operations = selectedTemplate.actions.filter(a => a.enabled).map(a => ({ type: a.kind, field: a.field, value: resolveTemplate(a.value, selectedTicket, matchingToolkit) }));
    const payload = { mode: 'dry-run', generatedAt: new Date().toISOString(), ticket: { id: selectedTicket.id, serial: selectedTicket.serial, currentStatus: selectedTicket.status }, guard: { legalHold: matchingToolkit?.overall_legal_hold || 'unchecked', passed: matchingToolkit?.overall_legal_hold === 'not_on_legal_hold', evidence: [...evidenceFiles, ...(matchingToolkit?.screenshot ? [matchingToolkit.screenshot] : [])] }, template: selectedTemplate.name, operations, submitEndpoint: null };
    setDryRun(payload);
    setActivities(items => [{ id: `activity-${Date.now()}`, time: nowLabel(), ticket: selectedTicket.id, template: selectedTemplate.name, summary: `Dry run created · ${operations.length} proposed operations` }, ...items]);
    setToast('Dry-run payload generated');
  }

  function downloadDryRun() {
    if (!dryRun) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(dryRun, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selectedTicket.id}-dry-run.json`; link.click(); URL.revokeObjectURL(url);
  }

  function attachEvidence(event: ChangeEvent<HTMLInputElement>) { setEvidenceFiles(Array.from(event.target.files || []).map(file => file.name)); }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand-mark" onClick={() => setWorkspace('queue')} aria-label="Helix Workbench home">HW</button>
        <nav aria-label="Primary navigation">{nav.map(item => <button className={`nav-item ${workspace === item.id ? 'active' : ''}`} key={item.id} onClick={() => setWorkspace(item.id)}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></button>)}</nav>
        <button className={`nav-item settings ${workspace === 'settings' ? 'active' : ''}`} onClick={() => setWorkspace('settings')}><span>⚙</span><small>Settings</small></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">Operations workspace</p><h1>{workspace === 'toolkit' ? 'PC Toolkit Evidence' : workspace === 'templates' ? 'Template Studio' : workspace === 'activity' ? 'Dry-run Activity' : workspace === 'settings' ? 'Local Settings' : 'Helix Workbench'}</h1></div>
          {workspace === 'queue' && <div className="command-search"><span>⌕</span><input aria-label="Search tickets" placeholder="Search ticket, serial or user…" value={search} onChange={e => setSearch(e.target.value)} /><kbd>⌘ K</kbd></div>}
          <div className="simulation-pill"><i /> Simulation only</div>
        </header>

        {workspace === 'queue' && <QueueView filteredTickets={filteredTickets} selectedTicket={selectedTicket} setSelectedTicket={setSelectedTicket} matchingToolkit={matchingToolkit} onPrepare={prepareClosure} onToolkit={() => { setToolkitInput(selectedTicket.serial); setWorkspace('toolkit'); }} />}
        {workspace === 'toolkit' && <ToolkitView input={toolkitInput} setInput={setToolkitInput} outputDir={outputDir} setOutputDir={setOutputDir} busy={toolkitBusy} error={toolkitError} results={toolkitResults} bridgeOnline={bridgeOnline} onRun={runToolkit} onDemo={loadDemo} />}
        {workspace === 'templates' && <TemplateStudio templates={templates} selectedId={selectedTemplateId} setSelectedId={selectTemplate} draft={templateDraft} setDraft={setTemplateDraft} onSave={saveTemplate} onAdd={addTemplate} onAddAction={addAction} onUpdateAction={updateAction} ticket={selectedTicket} result={matchingToolkit} />}
        {workspace === 'activity' && <ActivityView activities={activities} />}
        {workspace === 'settings' && <SettingsView bridgeUrl={bridgeUrl} setBridgeUrl={setBridgeUrl} online={bridgeOnline} onCheck={checkBridge} />}
      </section>

      {closureOpen && <ClosureDrawer ticket={selectedTicket} template={selectedTemplate} result={matchingToolkit} evidenceFiles={evidenceFiles} onEvidence={attachEvidence} dryRun={dryRun} onGenerate={generateDryRun} onDownload={downloadDryRun} onClose={() => setClosureOpen(false)} onToolkit={() => { setClosureOpen(false); setToolkitInput(selectedTicket.serial); setWorkspace('toolkit'); }} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function QueueView({ filteredTickets, selectedTicket, setSelectedTicket, matchingToolkit, onPrepare, onToolkit }: { filteredTickets: Ticket[]; selectedTicket: Ticket; setSelectedTicket: (t: Ticket) => void; matchingToolkit?: ToolkitResult; onPrepare: () => void; onToolkit: () => void }) {
  return <>
    <div className="content-grid">
      <section className="queue-panel">
        <div className="section-head"><div><p className="eyebrow">My queue</p><h2>Rebuild candidates</h2></div><div className="segmented"><button className="selected">Open <b>{filteredTickets.length}</b></button><button>All <b>28</b></button></div></div>
        <div className="filter-row"><button className="filter active">Rebuild</button><button className="filter">Assigned to me</button><button className="filter">Needs evidence</button><button className="icon-button">＋</button></div>
        <div className="ticket-list">{filteredTickets.map(ticket => <button className={`ticket-row ${selectedTicket.id === ticket.id ? 'selected' : ''}`} key={ticket.id} onClick={() => setSelectedTicket(ticket)}><div className="selection-dot" /><div className="ticket-main"><div><strong>{ticket.id}</strong><span className="serial">{ticket.serial}</span></div><h3>{ticket.title}</h3><p>{ticket.owner}</p></div><div className="ticket-meta"><span>{ticket.age}</span><em className={statusClass(ticket.status)}>{ticket.status}</em></div></button>)}</div>
        {!filteredTickets.length && <div className="empty-state"><b>No matching tickets</b><span>Try a ticket ID, serial number, customer or group.</span></div>}
      </section>
      <aside className="ticket-detail">
        <div className="detail-head"><div><p className="eyebrow">Selected ticket</p><h2>{selectedTicket.id}</h2></div><button className="icon-button">•••</button></div>
        <div className="detail-summary"><span className="device-icon">⌘</span><div><strong>{selectedTicket.title}</strong><p>{selectedTicket.serial} · {selectedTicket.category}</p></div></div>
        <dl className="fact-grid"><div><dt>Status</dt><dd>{selectedTicket.status}</dd></div><div><dt>Priority</dt><dd>{selectedTicket.priority}</dd></div><div><dt>Assigned group</dt><dd>{selectedTicket.owner}</dd></div><div><dt>Customer</dt><dd>{selectedTicket.customer}</dd></div></dl>
        <p className="ticket-description">{selectedTicket.description}</p>
        <section className="readiness-card"><div className="readiness-title"><span>Rebuild readiness</span><b>{matchingToolkit?.overall_legal_hold === 'not_on_legal_hold' ? 'Ready' : 'Evidence needed'}</b></div><div className="check-row done"><i>✓</i><div><strong>Serial identified</strong><small>{selectedTicket.serial}</small></div></div><div className={`check-row ${matchingToolkit?.overall_legal_hold === 'not_on_legal_hold' ? 'done' : 'waiting'}`}><i>{matchingToolkit ? (matchingToolkit.overall_legal_hold === 'not_on_legal_hold' ? '✓' : '!') : '⌁'}</i><div><strong>Legal hold check</strong><small>{matchingToolkit ? holdLabel(matchingToolkit.overall_legal_hold) : 'Not checked'}</small></div><button onClick={onToolkit}>{matchingToolkit ? 'View' : 'Check'}</button></div><div className="check-row done"><i>✓</i><div><strong>Closure template</strong><small>Mark as rebuilt</small></div></div></section>
        <button className="primary-action" onClick={onPrepare}>Prepare rebuild closure <span>→</span></button><p className="safety-note">Creates a reviewable dry run. No Helix write endpoint is connected.</p>
      </aside>
    </div>
    <section className="toolkit-ribbon"><div className="toolkit-icon">PT</div><div><p className="eyebrow">Separate workspace</p><h3>PC Toolkit batch evidence</h3><p>Check legal hold, inspect raw device data, and save screenshots for multiple serials.</p></div><div className="mini-stat"><b>{matchingToolkit ? '1' : '0'}</b><span>Matched</span></div><button onClick={onToolkit}>Open PC Toolkit workspace <span>→</span></button></section>
  </>;
}

function ToolkitView({ input, setInput, outputDir, setOutputDir, busy, error, results, bridgeOnline, onRun, onDemo }: { input: string; setInput: (v: string) => void; outputDir: string; setOutputDir: (v: string) => void; busy: 'api' | 'screenshots' | null; error: string; results: ToolkitResult[]; bridgeOnline: boolean | null; onRun: (m: 'api' | 'screenshots') => void; onDemo: () => void }) {
  const summary = { clear: results.filter(r => r.overall_legal_hold === 'not_on_legal_hold').length, hold: results.filter(r => r.overall_legal_hold === 'on_legal_hold').length, unknown: results.filter(r => r.overall_legal_hold === 'unknown').length };
  return <div className="toolkit-page">
    <section className="toolkit-control card"><div className="panel-heading"><div><p className="eyebrow">Batch lookup</p><h2>Legal hold checker</h2><p>One serial per line, or separate with commas and spaces. The retry workaround is built in.</p></div><span className={`connection ${bridgeOnline ? 'online' : bridgeOnline === false ? 'offline' : ''}`}><i />{bridgeOnline ? 'Local bridge ready' : bridgeOnline === false ? 'Bridge offline' : 'Checking bridge'}</span></div>
      <label className="field-label">Serial numbers<textarea rows={7} value={input} onChange={e => setInput(e.target.value)} placeholder={'C02ZK41\nFVFG91K'} /></label>
      <label className="field-label">Screenshot destination<input value={outputDir} onChange={e => setOutputDir(e.target.value)} /></label>
      {error && <div className="error-banner"><b>Could not run the lookup</b><span>{error}</span></div>}
      <div className="button-row"><button className="secondary-action" disabled={!!busy} onClick={() => onRun('api')}>{busy === 'api' ? 'Checking…' : 'Check via API only'}</button><button className="primary-button" disabled={!!busy} onClick={() => onRun('screenshots')}>{busy === 'screenshots' ? 'Capturing in Chrome…' : 'Check + save screenshots'}</button><button className="text-button" onClick={onDemo}>Load sample</button></div>
      <div className="privacy-note">Read-only PC Toolkit access. Screenshots and JSON stay on this Mac.</div>
    </section>
    <section className="results-panel card"><div className="panel-heading compact"><div><p className="eyebrow">Results</p><h2>Device evidence</h2></div><div className="result-counts"><span className="clear"><b>{summary.clear}</b> clear</span><span className="hold"><b>{summary.hold}</b> hold</span><span className="unknown"><b>{summary.unknown}</b> review</span></div></div>
      {!results.length ? <div className="empty-state tall"><span className="empty-icon">⌁</span><b>No lookups yet</b><span>Run an API check or load synthetic sample data.</span></div> : <div className="raw-result-list">{results.map(result => <ResultCard key={result.serial} result={result} />)}</div>}
    </section>
  </div>;
}

function ResultCard({ result }: { result: ToolkitResult }) {
  const device = result.legal_holds?.[0];
  return <article className="result-card"><div className="result-card-head"><div><strong>{result.serial}</strong><span>{device?.device_name || (result.success ? 'Device returned' : 'No device record')}</span></div><em className={`hold-pill ${result.overall_legal_hold}`}>{holdLabel(result.overall_legal_hold)}</em></div><div className="result-facts"><div><span>API value</span><b>{device?.legal_hold || '—'}</b></div><div><span>Attempts</span><b>{result.attempt_count}</b></div><div><span>Screenshot</span><b>{result.screenshot ? 'Saved' : 'Not captured'}</b></div><div><span>Proceed</span><b>{device?.safe_to_proceed ? 'Yes' : 'No'}</b></div></div>{result.screenshot && <code className="file-path">{result.screenshot}</code>}{result.error && <p className="inline-error">{result.error}</p>}<details><summary>Raw PC Toolkit result <span>JSON</span></summary><pre>{JSON.stringify(result.final_data || result.attempts, null, 2)}</pre></details></article>;
}

function TemplateStudio({ templates, selectedId, setSelectedId, draft, setDraft, onSave, onAdd, onAddAction, onUpdateAction, ticket, result }: { templates: ModificationTemplate[]; selectedId: string; setSelectedId: (id: string) => void; draft: ModificationTemplate; setDraft: (t: ModificationTemplate) => void; onSave: () => void; onAdd: () => void; onAddAction: () => void; onUpdateAction: (id: string, patch: Partial<ModificationTemplate['actions'][number]>) => void; ticket: Ticket; result?: ToolkitResult }) {
  return <div className="template-layout"><aside className="template-list card"><div className="panel-heading compact"><div><p className="eyebrow">Library</p><h2>Modification templates</h2></div><button className="icon-button" onClick={onAdd}>＋</button></div>{templates.map(template => <button key={template.id} className={`template-list-item ${selectedId === template.id ? 'selected' : ''}`} onClick={() => setSelectedId(template.id)}><i style={{ background: template.accent }} /><div><b>{template.name}</b><span>{template.actions.filter(a => a.enabled).length} operations</span></div><em>›</em></button>)}</aside>
    <section className="template-editor card"><div className="panel-heading"><div><p className="eyebrow">Template editor</p><h2>{draft.name}</h2></div><div className="button-row"><button className="secondary-action">Duplicate</button><button className="primary-button" onClick={onSave}>Save template</button></div></div><div className="template-basics"><label className="field-label">Template name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label className="field-label">Safety guard<input value={draft.guard} onChange={e => setDraft({ ...draft, guard: e.target.value })} /></label><label className="field-label full">Description<textarea rows={2} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label></div><div className="actions-heading"><div><p className="eyebrow">Sequence</p><h3>Proposed operations</h3></div><button className="secondary-action" onClick={onAddAction}>＋ Add operation</button></div><div className="action-list">{draft.actions.map((action, index) => <div className={`action-editor ${!action.enabled ? 'disabled' : ''}`} key={action.id}><button className="drag-handle" aria-label="Reorder">⠿</button><span className="action-number">{index + 1}</span><label className="switch"><input type="checkbox" checked={action.enabled} onChange={e => onUpdateAction(action.id, { enabled: e.target.checked })} /><i /></label><select value={action.kind} onChange={e => onUpdateAction(action.id, { kind: e.target.value as typeof action.kind })}><option value="field">Set field</option><option value="worklog">Add work log</option><option value="attachment">Attach evidence</option></select><select value={action.field} onChange={e => onUpdateAction(action.id, { field: e.target.value })}>{fieldOptions.map(field => <option key={field}>{field}</option>)}</select><textarea rows={2} value={action.value} onChange={e => onUpdateAction(action.id, { value: e.target.value })} /><button className="remove-action" onClick={() => setDraft({ ...draft, actions: draft.actions.filter(a => a.id !== action.id) })}>×</button></div>)}</div><div className="token-row"><span>Insert variable</span>{variableTokens.map(token => <button key={token} onClick={() => { const last = draft.actions.at(-1); if (last) onUpdateAction(last.id, { value: `${last.value}${last.value ? ' ' : ''}${token}` }); }}>{token}</button>)}</div></section>
    <aside className="template-preview card"><p className="eyebrow">Live preview</p><h3>{ticket.id}</h3><p className="preview-sub">Resolved against the selected synthetic ticket</p><div className="guard-box"><span>Guard</span><b>{draft.guard}</b></div>{draft.actions.filter(a => a.enabled).map(action => <div className="preview-action" key={action.id}><span>{action.kind}</span><b>{action.field}</b><p>{resolveTemplate(action.value, ticket, result)}</p></div>)}</aside></div>;
}

function ActivityView({ activities }: { activities: ActivityItem[] }) { return <section className="activity-card card"><div className="panel-heading"><div><p className="eyebrow">Local audit trail</p><h2>Dry-run activity</h2><p>Nothing in this list was submitted to Helix.</p></div><button className="secondary-action">Export log</button></div><div className="activity-list">{activities.map(item => <article key={item.id}><span className="activity-time">{item.time}</span><i>◇</i><div><b>{item.ticket}</b><strong>{item.template}</strong><p>{item.summary}</p></div><em>Simulation</em></article>)}</div></section>; }

function SettingsView({ bridgeUrl, setBridgeUrl, online, onCheck }: { bridgeUrl: string; setBridgeUrl: (v: string) => void; online: boolean | null; onCheck: () => void }) { return <div className="settings-grid"><section className="card settings-card"><p className="eyebrow">Local companion</p><h2>Connection</h2><p>The companion runs PC Toolkit checks and writes screenshots to this Mac. It contains no Helix submit route.</p><label className="field-label">Bridge address<input value={bridgeUrl} onChange={e => setBridgeUrl(e.target.value)} /></label><div className="connection-row"><span className={`connection ${online ? 'online' : 'offline'}`}><i />{online ? 'Connected' : 'Not connected'}</span><button className="secondary-action" onClick={onCheck}>Test connection</button></div></section><section className="card settings-card"><p className="eyebrow">Safety</p><h2>Submission lock</h2><div className="lock-state"><span>⌁</span><div><b>Helix writes disabled</b><p>This build has no endpoint capable of changing or closing a ticket.</p></div></div><label className="toggle-setting"><input type="checkbox" checked readOnly /><span>Require legal-hold evidence for rebuild templates</span></label><label className="toggle-setting"><input type="checkbox" checked readOnly /><span>Keep raw API payloads in dry-run output</span></label></section></div>; }

function ClosureDrawer({ ticket, template, result, evidenceFiles, onEvidence, dryRun, onGenerate, onDownload, onClose, onToolkit }: { ticket: Ticket; template: ModificationTemplate; result?: ToolkitResult; evidenceFiles: string[]; onEvidence: (e: ChangeEvent<HTMLInputElement>) => void; dryRun: Record<string, unknown> | null; onGenerate: () => void; onDownload: () => void; onClose: () => void; onToolkit: () => void }) {
  const clear = result?.overall_legal_hold === 'not_on_legal_hold';
  return <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label="Prepare rebuild closure"><aside className="closure-drawer"><div className="drawer-header"><div><p className="eyebrow">Dry-run assistant</p><h2>Prepare rebuild closure</h2><span>{ticket.id} · {ticket.serial}</span></div><button className="close-button" onClick={onClose}>×</button></div><div className="stepper"><span className="done">1</span><i /><span className={result ? 'done' : 'active'}>2</span><i /><span className={dryRun ? 'done' : 'active'}>3</span></div><section className="drawer-section"><div className="drawer-section-title"><span>1</span><div><b>Ticket and template</b><p>{template.name}</p></div><em>Ready</em></div><div className="change-summary"><div><span>Current status</span><b>{ticket.status}</b></div><span>→</span><div><span>Proposed status</span><b>Resolved</b></div></div></section><section className="drawer-section"><div className="drawer-section-title"><span>2</span><div><b>Legal-hold evidence</b><p>PC Toolkit must explicitly return NotFlagged</p></div><em className={clear ? 'ready' : 'blocked'}>{clear ? 'Clear' : 'Blocked'}</em></div>{result ? <div className={`evidence-status ${result.overall_legal_hold}`}><i>{clear ? '✓' : '!'}</i><div><b>{holdLabel(result.overall_legal_hold)}</b><span>{result.legal_holds?.[0]?.device_name || ticket.serial} · checked in {result.attempt_count} attempt(s)</span></div></div> : <button className="toolkit-callout" onClick={onToolkit}><span>⌁</span><div><b>Run PC Toolkit check</b><small>Open the separate evidence workspace</small></div><em>→</em></button>}<label className="upload-zone"><input type="file" accept="image/*" multiple onChange={onEvidence} /><span>＋</span><b>Add existing screenshots</b><small>PNG, JPEG or clipboard captures · kept local</small></label>{[...(result?.screenshot ? [result.screenshot] : []), ...evidenceFiles].map(file => <div className="evidence-file" key={file}><span>▧</span><code>{file}</code><em>Attached to draft</em></div>)}</section><section className="drawer-section"><div className="drawer-section-title"><span>3</span><div><b>Review modifications</b><p>{template.actions.filter(a => a.enabled).length} proposed operations</p></div></div><div className="modification-list">{template.actions.filter(a => a.enabled).map(action => <div key={action.id}><span>{action.kind}</span><b>{action.field}</b><p>{resolveTemplate(action.value, ticket, result)}</p></div>)}</div></section>{dryRun && <details className="payload-preview" open><summary>Generated dry-run JSON</summary><pre>{JSON.stringify(dryRun, null, 2)}</pre></details>}<div className="drawer-footer"><div><b>Simulation lock is on</b><span>No request can be sent to Helix.</span></div><button className="secondary-action" onClick={dryRun ? onDownload : onGenerate}>{dryRun ? 'Download JSON' : 'Generate dry run'}</button><button className="disabled-submit" disabled>Submit closure</button></div></aside></div>;
}

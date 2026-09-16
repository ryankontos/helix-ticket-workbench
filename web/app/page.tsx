'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  displayValue,
  firstDevice,
  HistoryDetail,
  HistoryRecord,
  holdLabel,
  LegalHoldItem,
  objectValue,
  prettyKey,
  ToolkitResult,
} from './data';

const bridgeDefault = process.env.NEXT_PUBLIC_BRIDGE_URL || 'http://127.0.0.1:47831';
const screenshotDefault = process.env.NEXT_PUBLIC_SCREENSHOT_DIR || '~/Desktop/Legal-Hold-Evidence';
const attemptsDefault = Number(process.env.NEXT_PUBLIC_MAX_ATTEMPTS || '6') || 6;

function parseSerials(value: string) {
  return [...new Set(value.toUpperCase().split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))];
}

function statusClass(value: string) {
  return value.replaceAll('_', '-');
}

function checkedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function firstHold(result?: ToolkitResult | null): LegalHoldItem {
  return result?.legal_holds?.[0] || {};
}

function userFromDevice(device: Record<string, unknown> | null) {
  const cmdb = objectValue(device?.cmdb);
  const people = cmdb?.people;
  if (!Array.isArray(people)) return null;
  return people.map(objectValue).find(person => person?.fullName || person?.loginID) || null;
}

function summaryFields(result: ToolkitResult | null) {
  const device = firstDevice(result);
  const hold = firstHold(result);
  const cmdb = objectValue(device?.cmdb);
  const details = objectValue(cmdb?.ciDetails);
  const user = userFromDevice(device);
  return [
    ['Device', device?.name || details?.ciName],
    ['Serial', hold.serial_number || details?.serialNumber || result?.serial],
    ['Product', details?.productName],
    ['Status', details?.status],
    ['Site', details?.site],
    ['User', user?.fullName || user?.loginID],
    ['Login', user?.loginID],
    ['Legal hold', hold.legal_hold],
    ['CMDB record', hold.cmdb_record_exists],
    ['SCCM record', hold.sccm_record_exists],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
}

export default function Home() {
  const bridgeUrl = bridgeDefault;
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [folder, setFolder] = useState(screenshotDefault);
  const [createNewFolder, setCreateNewFolder] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(Math.min(20, Math.max(1, attemptsDefault)));
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`${bridgeUrl}/health`)
      .then(response => { if (live) setBridgeOnline(response.ok); })
      .catch(() => { if (live) setBridgeOnline(false); });
    fetch(`${bridgeUrl}/api/history`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(body => {
        if (!live) return;
        const records = Array.isArray(body.history) ? body.history as HistoryRecord[] : [];
        setHistory(records);
        if (records[0]) setSelectedId(current => current || records[0].id);
      })
      .catch(() => { if (live) setBridgeOnline(false); });
    return () => { live = false; };
  }, [bridgeUrl]);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    fetch(`${bridgeUrl}/api/history/${encodeURIComponent(selectedId)}`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(body => { if (live) setDetail(body as HistoryDetail); })
      .catch(() => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [bridgeUrl, selectedId]);

  async function runCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const serials = parseSerials(serialInput);
    if (!serials.length) { setError('Enter at least one serial number.'); return; }
    setBusy(true);
    setError('');
    setMessage('Checking in Chrome…');
    try {
      const response = await fetch(`${bridgeUrl}/api/pc-toolkit/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serials, screenshotDir: folder, createNewFolder, attempts: maxAttempts, retryDelay: 1.5 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The check failed.');
      const records = Array.isArray(body.history) ? body.history as HistoryRecord[] : [];
      setHistory(records);
      if (body.history_records?.[0]) setSelectedId(body.history_records[0].id);
      setBridgeOnline(true);
      setMessage(`${serials.length} serial${serials.length === 1 ? '' : 's'} checked`);
    } catch (caught) {
      setBridgeOnline(false);
      setMessage('');
      setError(caught instanceof Error ? caught.message : 'The check failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openScreenshot(path: string) {
    try {
      const response = await fetch(`${bridgeUrl}/api/open-screenshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not open screenshot.');
      setMessage('Screenshot opened');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open screenshot.');
    }
  }

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter(item => [item.serial, item.device_name, item.legal_hold, item.overall_legal_hold].some(value => String(value || '').toLowerCase().includes(query)));
  }, [history, historySearch]);

  const counts = {
    total: history.length,
    clear: history.filter(item => item.overall_legal_hold === 'not_on_legal_hold').length,
    hold: history.filter(item => item.overall_legal_hold === 'on_legal_hold').length,
    review: history.filter(item => item.overall_legal_hold === 'unknown').length,
  };
  const selectedResult = detail?.device_info?.result || null;

  return (
    <main className="checker">
      <header className="header">
        <div><h1>Legal hold checker</h1><span>PC Toolkit</span></div>
        <div className={`connection ${bridgeOnline ? 'online' : bridgeOnline === false ? 'offline' : ''}`}><i />{bridgeOnline ? 'Ready' : bridgeOnline === false ? 'Offline' : 'Connecting'}</div>
      </header>

      <form className="check-form" onSubmit={runCheck}>
        <label className="control serial-control"><span>Serial numbers</span><textarea value={serialInput} onChange={event => setSerialInput(event.target.value)} placeholder={'One per line'} rows={4} /></label>
        <div className="form-side">
          <label className="control"><span>Screenshot folder</span><div className="input-with-button"><input value={folder} onChange={event => setFolder(event.target.value)} /><button type="button" onClick={() => setFolder('~/Desktop/Legal-Hold-Evidence')}>Desktop</button></div></label>
          <div className="control"><span>Save mode</span><div className="choice-row"><button type="button" className={createNewFolder ? 'chosen' : ''} onClick={() => setCreateNewFolder(true)}>New folder</button><button type="button" className={!createNewFolder ? 'chosen' : ''} onClick={() => setCreateNewFolder(false)}>Add to folder</button></div></div>
          <label className="control"><span>Search attempts</span><input type="number" min={1} max={20} value={maxAttempts} onChange={event => setMaxAttempts(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} /></label>
          <button className="run-button" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check serials'}</button>
        </div>
      </form>

      {(error || message) && <div className={`notice ${error ? 'error' : ''}`}>{error || message}</div>}

      <div className="stats"><div><b>{counts.total}</b><span>Checks</span></div><div className="clear"><b>{counts.clear}</b><span>Not flagged</span></div><div className="hold"><b>{counts.hold}</b><span>Legal hold</span></div><div className="review"><b>{counts.review}</b><span>Review</span></div></div>

      <section className="content">
        <aside className="history-panel">
          <div className="panel-heading"><h2>History</h2><span>{filteredHistory.length}</span></div>
          <input className="history-search" aria-label="Search history" placeholder="Search serials or devices" value={historySearch} onChange={event => setHistorySearch(event.target.value)} />
          <div className="history-list">
            {!filteredHistory.length && <div className="empty">No previous checks</div>}
            {filteredHistory.map(item => <button className={`history-row ${selectedId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><div className={`status-dot ${statusClass(item.overall_legal_hold)}`} /><div><strong>{item.serial}</strong><span>{item.device_name || 'No device name'}</span><small>{checkedLabel(item.checked_at)}</small></div><em className={statusClass(item.overall_legal_hold)}>{holdLabel(item.overall_legal_hold)}</em></button>)}
          </div>
        </aside>

        <section className="detail-panel">
          {!detail || !selectedResult ? <div className="empty detail-empty"><b>Select a check</b><span>Results will appear here</span></div> : <ResultDetail detail={detail} result={selectedResult} onOpenScreenshot={openScreenshot} />}
        </section>
      </section>
    </main>
  );
}

function ResultDetail({ detail, result, onOpenScreenshot }: { detail: HistoryDetail; result: ToolkitResult; onOpenScreenshot: (path: string) => void }) {
  const record = detail.record;
  const fields = summaryFields(result);
  return <>
    <div className="detail-heading"><div><h2>{record.serial}</h2><span>{record.device_name || 'Device information'}</span></div><div className={`result-status ${statusClass(record.overall_legal_hold)}`}>{holdLabel(record.overall_legal_hold)}</div></div>
    <div className="detail-actions"><span>Checked {checkedLabel(record.checked_at)} · {record.attempt_count} attempt{record.attempt_count === 1 ? '' : 's'}</span>{record.screenshot ? <button onClick={() => onOpenScreenshot(record.screenshot as string)}>Open screenshot</button> : <span className="no-screenshot">No screenshot</span>}</div>
    {record.error && <div className="notice error">{record.error}</div>}
    <section className="info-section"><h3>Device information</h3><div className="info-grid">{fields.map(([label, value]) => <div key={label}><span>{label}</span><b>{displayValue(value)}</b></div>)}</div></section>
    <section className="raw-section"><div className="section-heading"><h3>Returned data</h3><span>JSON</span></div><JsonTree label="Response" value={result.final_data} level={0} /></section>
    <section className="raw-section"><div className="section-heading"><h3>Search attempts</h3><span>{result.attempts.length}</span></div><JsonTree label="Attempts" value={result.attempts} level={0} /></section>
  </>;
}

function JsonTree({ label, value, level }: { label: string; value: unknown; level: number }) {
  const object = objectValue(value);
  if (Array.isArray(value)) return <details className="json-group" open={level === 0}><summary><span>{label}</span><small>{value.length} items</small></summary><div className="json-children">{value.map((item, index) => <JsonTree key={`${label}-${index}`} label={String(index + 1)} value={item} level={level + 1} />)}</div></details>;
  if (object) return <details className="json-group" open={level === 0}><summary><span>{label}</span><small>{Object.keys(object).length} fields</small></summary><div className="json-children">{Object.entries(object).map(([key, child]) => <JsonTree key={key} label={prettyKey(key)} value={child} level={level + 1} />)}</div></details>;
  return <div className="json-leaf"><span>{label}</span><b>{displayValue(value)}</b></div>;
}

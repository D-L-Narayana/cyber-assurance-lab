import { useState } from 'react';
import { makeArtifact } from '../engine/packet';
import { ARTIFACT_KINDS, type Artifact, type ArtifactKind, type Packet } from '../engine/types';

interface Props {
  packet: Packet;
  integrity: Map<string, boolean>;
  editable: boolean;
  onAdd: (a: Artifact) => void;
  onRemove: (id: string) => void;
}

export function Locker({ packet, integrity, editable, onAdd, onRemove }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ArtifactKind>('document-excerpt');
  const [content, setContent] = useState('');
  const [capturedOn, setCapturedOn] = useState(packet.meta.asOf);
  const used = new Set(packet.steps.flatMap((s) => s.evidenceIds));
  return (
    <section className="locker" aria-labelledby="locker-h">
      <h2 id="locker-h">Evidence locker <span className="muted small">({packet.artifacts.length})</span></h2>
      {packet.artifacts.length === 0 ? <p className="empty small">No artifacts. Paste synthetic content below; it is hashed locally.</p> : (
        <ul className="artlist">
          {packet.artifacts.map((a) => (
            <li key={a.id} className={`art ${integrity.get(a.id) ? '' : 'art--bad'}`}>
              <div className="art__row">
                <span className="mono">{a.id}</span>
                <span className="art__name">{a.name}</span>
                <span className={`chip ${integrity.get(a.id) ? 'chip--ok' : 'chip--bad'}`}>{integrity.get(a.id) ? 'hash ok' : 'hash mismatch'}</span>
              </div>
              <div className="small muted">{a.kind} · captured {a.capturedOn} · {used.has(a.id) ? 'cited' : 'uncited'}</div>
              <code className="mono hash">{a.sha256}</code>
              <details><summary className="small">content ({a.content.length} chars)</summary><pre className="content">{a.content}</pre></details>
              {editable && <button type="button" className="ghost small" onClick={() => onRemove(a.id)}>Remove {a.id}</button>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form className="addform" onSubmit={(e) => {
          e.preventDefault();
          onAdd(makeArtifact({ id: `ART-${String(packet.artifacts.length + 1).padStart(2, '0')}`, name: name.trim(), kind, content, capturedOn }));
          setName(''); setContent('');
        }}>
          <h4>Add artifact</h4>
          <label><span>Name</span><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="grid2">
            <label><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind)}>{ARTIFACT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <label><span>Captured on</span><input type="date" required value={capturedOn} onChange={(e) => setCapturedOn(e.target.value)} /></label>
          </div>
          <label><span>Synthetic content (hashed; max 20,000 chars)</span><textarea required rows={3} maxLength={20000} value={content} onChange={(e) => setContent(e.target.value)} /></label>
          <button type="submit">Add and hash</button>
        </form>
      )}
    </section>
  );
}

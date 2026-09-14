import { useState } from "react";
import { Modal } from "./ui";
import type { Inventory, Field } from "./model";
import { bulkEdit, bulkFields, displayValue, keep, mixedValue, safeProperty, type BulkPatch, type Edit } from "./bulk";
export function BulkEditor({ data, ids, onSave, onClose }: { data: Inventory; ids: Set<string>; onSave: (d: Inventory) => Promise<unknown>; onClose: () => void }) {
  const [selection] = useState(() => new Set(ids));
  const [patch, setPatch] = useState<BulkPatch>({ environment: keep(), type: keep(), properties: {} });
  const [extras, setExtras] = useState<Field[]>([]), [newKey, setNewKey] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof bulkEdit> | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const rows = data.components.filter(c => selection.has(c.id));
  const update = (next: BulkPatch) => { setPatch(next); setPreview(null); setError(""); };
  function editor(f: Field, op: Edit, onChange: (v: Edit) => void, values: unknown[], required = false) {
    return <div className="bulk-field" key={f.key}>
      <label>{f.label}<small>Current: {mixedValue(values)}</small></label>
      <select aria-label={`${f.label} operation`} value={op.mode} onChange={e => onChange({ mode: e.target.value as Edit["mode"] })}><option value="keep">Keep existing</option><option value="set">Set value</option>{!required && <option value="clear">Clear value</option>}</select>
      {op.mode === "set" && (f.field_type === "enum" || f.field_type === "bool" ? <select aria-label={`${f.label} value`} value={String(op.value ?? "")} onChange={e => onChange({ mode: "set", value: f.field_type === "bool" ? e.target.value === "" ? undefined : e.target.value === "true" : e.target.value })}><option value="">Choose value</option>{(f.field_type === "bool" ? ["true", "false"] : f.options).map(v => <option key={v} value={v}>{f.key === "environment" ? data.environments.find(e => e.id === v)?.name : f.key === "type" ? data.component_types.find(t => t.id === v)?.name : v}</option>)}</select> : <input aria-label={`${f.label} value`} type={f.field_type === "number" ? "number" : "text"} value={String(op.value ?? "")} onChange={e => onChange({ mode: "set", value: f.field_type === "number" ? e.target.value === "" ? undefined : Number(e.target.value) : e.target.value })}/>)}
    </div>;
  }
  return <Modal title={`Edit ${selection.size} components`} onClose={onClose} wide>
    <p>Only explicitly set or cleared fields change. Mixed values are kept unless you choose an operation.</p>
    {editor({key:"environment",label:"Environment",field_type:"enum",options:data.environments.map(e=>e.id)},patch.environment, op=>update({...patch,environment:op}),rows.map(c=>data.environments.find(e=>e.id===c.environment_id)?.name), true)}
    {editor({key:"type",label:"Component type",field_type:"enum",options:data.component_types.map(t=>t.id)},patch.type, op=>update({...patch,type:op}),rows.map(c=>data.component_types.find(t=>t.id===c.component_type_id)?.name), true)}
    {[...bulkFields(data,selection),...extras].map(f=>editor(f,patch.properties[f.key] || keep(),op=>update({...patch,properties:{...patch.properties,[f.key]:op}}),rows.map(c=>c.properties[f.key])))}
    <div className="inline"><input aria-label="Bulk extra field key" placeholder="Extra text field key" value={newKey} onChange={e=>setNewKey(e.target.value)}/><button className="secondary" onClick={()=>{const key=newKey.trim();if(!safeProperty(key)||[...bulkFields(data,selection),...extras].some(f=>f.key===key)){setError("Choose a new, safe metadata field key.");return;}setExtras([...extras,{key,label:key,field_type:"text",options:[]}]);setNewKey("");}}>Add metadata field</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {preview && <div className="bulk-preview"><p>{new Set(preview.changes.map(c=>c.id)).size} of {selection.size} components will change. Relationships remain linked by component ID; moving environments may create cross-environment links.</p><table><thead><tr><th>Component</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{preview.changes.map((c,i)=><tr key={i}><td>{c.name}</td><td>{c.field}</td><td>{displayValue(c.before)}</td><td>{displayValue(c.after)}</td></tr>)}</tbody></table>{preview.document.revision!==data.revision && <p className="error">Inventory changed. Preview again before applying.</p>}</div>}
    <footer className="modal-footer"><button className="secondary" onClick={onClose}>Cancel</button><button className="secondary" onClick={()=>{try {setPreview(bulkEdit(data,selection,patch));setError("");}catch(e){setPreview(null);setError(String(e));}}}>Preview changes</button><button className="primary" disabled={busy || !preview?.changes.length || preview.document.revision!==data.revision} onClick={async()=>{if(!preview)return;setBusy(true);try{await onSave(preview.document);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}}>Apply atomically</button></footer>
  </Modal>;
}

import { useState } from "react";
import { Modal } from "./ui";
import type { Inventory } from "./model";
import { relationBatch } from "./relations";
export function RelationBatchEditor({data,ids,onSave,onClose}:{data:Inventory;ids:Set<string>;onSave:(d:Inventory)=>Promise<unknown>;onClose:()=>void}) {
  const [selection]=useState(()=>new Set(ids));
  const [target,setTarget]=useState(ids.size===2?[...ids].sort()[1]:""),[relation,setRelation]=useState("connects_to"),[label,setLabel]=useState(""),[reverse,setReverse]=useState(false);
  const [preview,setPreview]=useState<ReturnType<typeof relationBatch>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const name=(id:string)=>{const c=data.components.find(c=>c.id===id);return `${c?.name} · ${data.environments.find(e=>e.id===c?.environment_id)?.name}`;};
  return <Modal title="Link selected components" onClose={onClose} wide>
    <p>{selection.size} selected. Create directed links between the selected components and one target. Self-links and exact duplicates are skipped.</p>
    <label>Target<select value={target} onChange={e=>{setTarget(e.target.value);setPreview(null);}}><option value="">Choose target</option>{data.components.map(c=><option key={c.id} value={c.id}>{name(c.id)}</option>)}</select></label>
    <label>Direction<select value={String(reverse)} onChange={e=>{setReverse(e.target.value==="true");setPreview(null);}}><option value="false">Selected → target</option><option value="true">Target → selected</option></select></label>
    <label>Relation type<input value={relation} maxLength={256} onChange={e=>{setRelation(e.target.value);setPreview(null);}}/></label>
    <label>Workflow description<input value={label} onChange={e=>{setLabel(e.target.value);setPreview(null);}}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <div className="bulk-preview"><p>{preview.added.length} relationships to add; {preview.skipped} self-links or duplicates skipped.</p>{preview.added.map(r=><p key={r.id}>{name(r.source_component_id)} → {name(r.target_component_id)} · {r.label||r.relation_type}</p>)}{preview.document.revision!==data.revision && <p className="error">Inventory changed. Preview again.</p>}</div>}
    <footer className="modal-footer"><button className="secondary" onClick={onClose}>Cancel</button><button className="secondary" onClick={()=>{try{setPreview(relationBatch(data,selection,target,relation,label,reverse));setError("");}catch(e){setError(String(e));setPreview(null);}}}>Preview relationships</button><button className="primary" disabled={busy||!preview?.added.length||preview.document.revision!==data.revision} onClick={async()=>{if(!preview)return;setBusy(true);try{await onSave(preview.document);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}}>Create relationships</button></footer>
  </Modal>;
}

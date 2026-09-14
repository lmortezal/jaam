import { useState } from "react";
import { Modal } from "./ui";
import { uid, type DiagramGroup, type Inventory } from "./model";
export function GroupEditor({data,environment,value,selected,onSave,onDelete,onClose}:{data:Inventory;environment:string;value:DiagramGroup|null;selected:Set<string>;onSave:(g:DiagramGroup)=>Promise<void>;onDelete:()=>Promise<void>;onClose:()=>void}) {
  const [group,setGroup]=useState<DiagramGroup>(value?structuredClone(value):{id:uid(),name:"",members:[...selected],x:0,y:0,width:400,height:240});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const other=(id:string)=>data.diagram_views[environment]?.groups.find(g=>g.id!==group.id&&g.members.includes(id));
  return <Modal title={value?"Edit diagram group":"New diagram group"} onClose={onClose}>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{if(group.members.some(id=>other(id)))throw new Error("Remove members from their existing group first.");await onSave({...group,name:group.name.trim()});onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}}>
      <p>Visual grouping only. Moving this box moves its members; resizing keeps all members enclosed. No infrastructure relationships are created.</p>
      <label>Name<input autoFocus required maxLength={256} value={group.name} onChange={e=>setGroup({...group,name:e.target.value})}/></label>
      <div className="form-grid"><label>Minimum width<input type="number" min={100} max={100000} required value={group.width} onChange={e=>setGroup({...group,width:Number(e.target.value)})}/></label><label>Minimum height<input type="number" min={80} max={100000} required value={group.height} onChange={e=>setGroup({...group,height:Number(e.target.value)})}/></label></div>
      <div className="group-members">{data.components.filter(c=>c.environment_id===environment).map(c=><label className="group-member" key={c.id}><input type="checkbox" checked={group.members.includes(c.id)} disabled={!!other(c.id)} onChange={e=>setGroup({...group,members:e.target.checked?[...group.members,c.id]:group.members.filter(id=>id!==c.id)})}/>{c.name}{other(c.id)&&<small>In {other(c.id)!.name}</small>}</label>)}</div>
      {error&&<p className="error" role="alert">{error}</p>}
      <footer className="modal-footer">{value&&<button type="button" className="danger-subtle" disabled={busy} onClick={async()=>{setBusy(true);try{await onDelete();onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}}>Ungroup members</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save group</button></footer>
    </form>
  </Modal>;
}

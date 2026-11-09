"use client";
import { useState, type FormEvent } from "react";
import { EditorSheet } from "./EditorSheet";
import { api } from "@/lib/client/api";
import { EMPLOYEE_PERMISSIONS, PERMISSION_OPTIONS, SUPERVISOR_PERMISSIONS, type Permission } from "@/lib/permissions";
import { useToast } from "./ToastProvider";

export type CustomRoleDto = {id:string;name:string;description:string;permissions:Permission[];active:boolean;version:number;
  _count?:{memberships:number}};
const groups=[...new Set(PERMISSION_OPTIONS.map(row=>row.group))];
const blank={name:"",description:"",permissions:[] as Permission[],active:true};

export function RoleSettings({roles,onChange}:{roles:CustomRoleDto[];onChange:()=>Promise<void>}) {
  const {showToast}=useToast();
  const [open, setOpen] = useState(false);
  const [editing,setEditing]=useState<CustomRoleDto|null>(null);
  const [form,setForm]=useState(blank);
  const [saving,setSaving]=useState(false);
  function toggle(key:Permission,checked:boolean) {
    const permissions=new Set(form.permissions);
    if(checked)permissions.add(key);else permissions.delete(key);
    if(key==="document.override" && checked)permissions.add("document.approve");
    if(key==="document.approve" && !checked)permissions.delete("document.override");
    setForm({...form,permissions:[...permissions]});
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(saving)return;setSaving(true);
    try {
      if(editing)await api.patch(`/api/roles/${editing.id}`,{...form,version:editing.version});
      else await api.post("/api/roles",form);
      showToast(editing ? "角色权限已更新，员工下次请求立即生效" : "角色已创建，可在员工页分配项目角色");
      setEditing(null);setForm(blank);setOpen(false);await onChange();
    } catch(error) {showToast(error instanceof Error?error.message:"角色保存失败","error");}
    finally {setSaving(false);}
  }
  return <section className="settings-content">
    <article className="card">
      <div className="card-head"><div><h2 className="card-title">自定义角色权限</h2>
        <p className="card-subtitle">自己命名角色、勾选操作，再在员工页按项目点分配。</p></div></div>
      <div className="card-body"><button className="btn btn--primary" onClick={() => { setEditing(null); setForm(blank); setOpen(true); }}>新增角色</button></div>
      {open && <EditorSheet title={editing ? "编辑角色权限" : "新增角色"} onClose={() => { if (!saving) setOpen(false); }}>
      <form className="card-body" onSubmit={save}>
        <h3>{editing ? `编辑角色：${editing.name}` : "新建角色"}</h3>
        <div className="form-grid">
          <label className="field">角色名称<input className="input" value={form.name} maxLength={50} required disabled={saving}
            placeholder="例如：项目录单员、只审不录、区域主管" onChange={event=>setForm({...form,name:event.target.value})}/></label>
          <label className="field">说明<input className="input" value={form.description} maxLength={300} disabled={saving}
            onChange={event=>setForm({...form,description:event.target.value})}/></label>
        </div>
        <p className="text-muted mt-16">分配项目后默认仅能查看自己的单据，单价、金额、合同价及他人单据分别勾选。原图包含单价和金额，两项均有权限才可查看；导出遵循相同限制。
          处理他人单据还需勾选查看他人单据；维护合同还需合同价查看权限。全公司共享资料的修改会影响其他项目，相关选项已注明范围。账号、角色和项目管理保留给系统管理员，财务账号保持只读。</p>
        <div className="page-actions mt-16">
          <button className="btn btn--outline btn--small" type="button" disabled={saving} onClick={()=>setForm({...form,permissions:[...EMPLOYEE_PERMISSIONS]})}>套用员工权限</button>
          <button className="btn btn--outline btn--small" type="button" disabled={saving} onClick={()=>setForm({...form,permissions:[...SUPERVISOR_PERMISSIONS]})}>套用主管权限</button>
          <button className="btn btn--outline btn--small" type="button" disabled={saving} onClick={()=>setForm({...form,permissions:[]})}>全部取消</button>
        </div>
        {groups.map(group=><fieldset className="role-permission-group mt-16" key={group} disabled={saving}>
          <legend>{group}</legend><div className="check-grid">{PERMISSION_OPTIONS.filter(row=>row.group===group).map(option=><label key={option.key}>
            <input type="checkbox" checked={form.permissions.includes(option.key)} onChange={event=>toggle(option.key,event.target.checked)}/>
            {option.label}
          </label>)}</div>
        </fieldset>)}
        {editing ? <label className="role-active mt-16"><input type="checkbox" checked={form.active} disabled={saving}
          onChange={event=>setForm({...form,active:event.target.checked})}/>启用角色（停用后关联员工立即失去该角色授予的项目权限）</label> : null}
        <div className="page-actions mt-16">
          <button className="btn btn--primary" disabled={saving}>{saving?"保存中…":editing?"保存角色权限":"创建角色"}</button>
          {editing ? <button className="btn btn--outline" type="button" disabled={saving} onClick={()=>{setOpen(false);setEditing(null);setForm(blank);}}>取消编辑</button> : null}
        </div>
      </form></EditorSheet>}

    </article>
    <article className="card mt-16"><div className="card-head"><h2 className="card-title">已有自定义角色</h2></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>角色</th><th>权限数</th><th>分配数</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{roles.map(role=><tr key={role.id}><td><strong>{role.name}</strong><p className="text-muted">{role.description}</p></td>
          <td>{role.permissions.length}</td><td>{role._count?.memberships||0}</td><td>{role.active?"启用":"停用"}</td><td>
            <button className="btn btn--outline btn--small" type="button" disabled={saving} onClick={()=>{
              setOpen(true);setEditing(role);setForm({name:role.name,description:role.description,permissions:[...role.permissions],active:role.active});

            }}>编辑权限</button></td></tr>)}</tbody>
      </table></div>{!roles.length ? <p className="card-body text-muted">尚未创建自定义角色。</p> : null}
    </article>
  </section>;
}

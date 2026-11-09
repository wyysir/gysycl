"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Building2, Users, ShieldCheck, Palette, ChevronRight, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import type { Bootstrap } from "@/lib/client/types";
import { ErrorState, PageLoading } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { RoleSettings, type CustomRoleDto } from "@/components/RoleSettings";
import { BrandSettings } from "@/components/BrandSettings";
import { ProjectManager } from "@/components/ProjectManager";
import { EditorSheet } from "@/components/EditorSheet";

const categories = [
  { key: "projects", title: "项目点", description: "新增、改名、启停项目点", icon: Building2 },
  { key: "users", title: "员工账号", description: "新增员工、分配角色、管理账号", icon: Users },
  { key: "roles", title: "角色权限", description: "设置各岗位的查看与操作权限", icon: ShieldCheck },
  { key: "brand", title: "企业品牌", description: "查看和更换企业Logo", icon: Palette },
] as const;
type AdminUser = {
  id: string;
  employeeNo: string;
  name: string;
  globalRole: "ADMIN" | "FINANCE" | "STAFF";
  active: boolean;
  wechatBound: boolean;
  memberships: Array<{
    projectId: string;
    projectName: string;
    role: "SUBMITTER" | "SUPERVISOR";
    customRoleId?: string | null;
    roleName?: string;
  }>;
};

type ProjectRole = string;
type ProjectRoles = Record<string, ProjectRole>;
function ProjectRoleFields({projects, roles, value, onChange, disabled = false}: {
  roles: CustomRoleDto[];
  projects: Bootstrap["projects"]; value: ProjectRoles;
  onChange: (roles: ProjectRoles) => void; disabled?: boolean;
}) {
  return <div className="field mt-16">
    <p className="text-muted">每个项目分别选择内置或自定义角色。自定义角色可在“角色权限”页创建、勾选操作。</p>
    <div className="project-role-grid">{projects.map(project => <label key={project.id} className="field">
      <span>{project.name}{project.active === false ? "（已停用，保留原归属）" : ""}</span>
      <select className="select" value={value[project.id] || ""} disabled={disabled}
        onChange={event => onChange({...value, [project.id]: event.target.value as ProjectRole})}>
        <option value="">不参与此项目</option>
        <option value="SUBMITTER" disabled={project.active === false}>员工（上传单据）</option>
        <option value="SUPERVISOR" disabled={project.active === false}>主管（上传、审核单据）</option>
        {roles.map(role=><option key={role.id} value={`custom:${role.id}`} disabled={!role.active || project.active === false}>{role.name}{role.active?"":"（已停用）"}</option>)}
      </select>
    </label>)}</div>
  </div>;
}
function roleMemberships(roles: ProjectRoles) {
  return Object.entries(roles).filter(([,role])=>role).map(([projectId,role])=>role.startsWith("custom:")
    ? {projectId,customRoleId:role.slice(7)} : {projectId,role});
}

export function SettingsClient() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<"projects" | "users" | "roles" | "brand" | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [password, setPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [managementProjects, setManagementProjects] = useState<Bootstrap["projects"]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleDto[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [userForm, setUserForm] = useState({
    employeeNo: "",
    name: "",
    password: "",
    globalRole: "STAFF" as "ADMIN" | "FINANCE" | "STAFF",
    projectRoles: {} as ProjectRoles,
  });
  const [newUser, setNewUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [activeUser, setActiveUser] = useState<AdminUser | null>(null);
  const [savingUserState, setSavingUserState] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editingRoles, setEditingRoles] = useState<ProjectRoles>({});
  const [savingRoles, setSavingRoles] = useState(false);
  const isAdmin = bootstrap?.user.globalRole === "ADMIN";
  async function load() {
    setError("");
    setLoading(true);
    try {
      const [data, users, roleData, projectData] = await Promise.all([
        api.get<Bootstrap>("/api/bootstrap?scope=context"),
        api.get<{ users: AdminUser[] }>("/api/users"),
        api.get<{roles: CustomRoleDto[]}>("/api/roles"),
        api.get<{projects: Bootstrap["projects"]}>("/api/projects"),
      ]);
      setBootstrap(data);
      setAdminUsers(users.users);
      setCustomRoles(roleData.roles);
      setManagementProjects(projectData.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function createUser(event: FormEvent) {
    event.preventDefault();
    if (creatingUser) return;
    setCreatingUser(true);
    try {
      await api.post("/api/users", {
        ...userForm,
        memberships: userForm.globalRole === "STAFF" ? roleMemberships(userForm.projectRoles) : [],
      });
      showToast("员工账号已创建");
      setNewUser(false);
      setUserForm({
        employeeNo: "",
        name: "",
        password: "",
        globalRole: "STAFF",
        projectRoles: {},
      });
      await load();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "创建失败", "error");
    } finally { setCreatingUser(false); }
  }

  async function toggleUser(user: AdminUser) {
    if (savingUserState) return;
    setSavingUserState(true);
    try {
      await api.patch(`/api/users/${user.id}`, { active: !user.active });
      showToast(user.active ? "员工已停用" : "员工已启用");
      setActiveUser(null);
      await load();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "操作失败", "error");
    } finally { setSavingUserState(false); }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordUser || savingPassword) return;
    setSavingPassword(true);
    try {
      await api.patch(`/api/users/${passwordUser.id}`, { password });
      showToast("密码已重置");
      setPasswordUser(null); setPassword("");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "重置失败", "error");
    } finally { setSavingPassword(false); }
  }

  async function confirmDeleteUser(event: FormEvent) {
    event.preventDefault();
    if (!deleteUser || deleting) return;
    setDeleting(true);
    try {
      await api.delete(`/api/users/${deleteUser.id}`);
      showToast("员工账号已删除，历史业务记录保留");
      if (editingUser?.id === deleteUser.id) setEditingUser(null);
      setDeleteUser(null); await load();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "删除失败", "error");
    } finally { setDeleting(false); }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!bootstrap) return <PageLoading label="正在读取系统设置…" />;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">系统设置</h1>
          <p className="page-subtitle">
            项目点和员工账号独立管理，合同与原材料在对应页面维护。
          </p>
        </div>
      </div>
      <div className="settings-category-grid" aria-label="设置分类">
        {categories.map(({ key, title, description, icon: Icon }) => <button key={key} type="button" className="card settings-category" aria-haspopup="dialog" onClick={() => setTab(key)}>
          <Icon size={24} /><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={18} />
        </button>)}
      </div>
      {loading && <p role="status" className="text-muted">正在更新设置…</p>}
      {tab && <EditorSheet title={categories.find(category => category.key === tab)!.title} className="settings-dialog" onClose={() => setTab(null)}>
      {tab === "brand" ? <BrandSettings /> : tab === "roles" ? <RoleSettings roles={customRoles} onChange={load} /> : tab === "projects" ? (
        <ProjectManager onChange={load} />
      ) : (
        <section className="settings-content">
          <article className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">员工与权限</h2>
                <p className="card-subtitle">
                  项目采购和主管必须先建账号，首次微信进入时绑定
                </p>
              </div>
            </div>
            <div className="card-body">
              <button className="btn btn--primary" onClick={() => setNewUser(true)}>新增员工账号</button>
            </div>
          </article>{" "}
          {isAdmin ? (
            <section className="card mt-16">
              <div className="card-head">
                <div>
                  <h2 className="card-title">员工账号列表</h2>
                  <p className="card-subtitle">停用后立即失去登录和接口权限</p>
                </div>
              </div>
              {editingUser ? <EditorSheet title={`设置项目角色：${editingUser.name}`} onClose={() => { if (!savingRoles) setEditingUser(null); }}><form className="card-body" onSubmit={async event => {
                event.preventDefault(); if (savingRoles) return; setSavingRoles(true);
                try {
                  await api.patch(`/api/users/${editingUser.id}`, {memberships: roleMemberships(editingRoles)});
                  showToast("项目角色已更新，员工下次请求立即生效"); setEditingUser(null); await load();
                } catch (caught) { showToast(caught instanceof Error ? caught.message : "保存失败", "error"); }
                finally { setSavingRoles(false); }
              }}>
                <h3>设置 {editingUser.name} 的项目角色</h3>
                <ProjectRoleFields roles={customRoles} projects={managementProjects.filter(project => project.active !== false || editingRoles[project.id])} value={editingRoles} onChange={setEditingRoles} disabled={savingRoles} />
                <div className="page-actions mt-16">
                  <button className="btn btn--primary" disabled={savingRoles}>保存项目角色</button>
                  <button type="button" className="btn btn--outline" disabled={savingRoles} onClick={() => setEditingUser(null)}>取消</button>
                </div>
              </form></EditorSheet> : null}
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>员工号 / 姓名</th>
                      <th>系统角色</th>
                      <th>项目权限</th>
                      <th>微信</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="cell-stack">
                            <strong>{user.name}</strong>
                            <span>{user.employeeNo}</span>
                          </div>
                        </td>
                        <td>
                          {user.globalRole === "ADMIN"
                            ? "管理员"
                            : user.globalRole === "FINANCE"
                              ? "财务只读"
                              : "项目员工"}
                        </td>
                        <td>
                          {user.memberships.length
                            ? user.memberships
                                .map(
                                  (membership) =>
                                    `${membership.projectName}(${membership.roleName || (membership.role === "SUPERVISOR" ? "主管" : "员工")})`,
                                )
                                .join("、")
                            : user.globalRole === "STAFF" ? "未分配" : "全公司"}
                        </td>
                        <td>{user.wechatBound ? "已绑定" : "未绑定"}</td>
                        <td>
                          <span
                            className={`pill pill--${user.active ? "approved" : "rejected"}`}
                          >
                            {user.active ? "启用" : "停用"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            {user.globalRole === "STAFF" ? <button className="btn btn--outline btn--small" type="button" disabled={savingRoles}
                              onClick={() => {
                                const roles: ProjectRoles = {};
                                for (const membership of user.memberships) {
                                  if (roles[membership.projectId] !== "SUPERVISOR") roles[membership.projectId] = membership.customRoleId ? `custom:${membership.customRoleId}` : membership.role;
                                }
                                setEditingRoles(roles); setEditingUser(user);
                              }}>设置项目角色</button> : null}
                            <button
                              className="btn btn--outline btn--small"
                              type="button"
                              onClick={() => { setPassword(""); setPasswordUser(user); }}
                            >
                              重置密码
                            </button>
                            <button
                              className={`btn btn--small ${
                                user.active ? "btn--danger" : "btn--soft"
                              }`}
                              type="button"
                              onClick={() => setActiveUser(user)}
                            >
                              {user.active ? "停用" : "启用"}
                            </button>
                            <button type="button" className="btn btn--danger btn--small" disabled={user.id === bootstrap.user.id || loading}
                              title={user.id === bootstrap.user.id ? "不能删除当前登录账号" : "删除账号并保留历史业务记录"}
                              onClick={() => setDeleteUser(user)}><Trash2 size={13} />删除账号</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </section>
      )}
      </EditorSheet>}
      {newUser && <EditorSheet title="新增员工账号" onClose={() => { if (!creatingUser) setNewUser(false); }}>
              <form className="admin-user-form" onSubmit={createUser}>
                <fieldset disabled={creatingUser}><div className="form-grid">
                  <div className="field">
                    <label>员工号</label>
                    <input
                      className="input"
                      value={userForm.employeeNo}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          employeeNo: event.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label>姓名</label>
                    <input
                      className="input"
                      value={userForm.name}
                      onChange={(event) =>
                        setUserForm({ ...userForm, name: event.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label>初始密码</label>
                    <input
                      className="input"
                      type="password"
                      minLength={8}
                      value={userForm.password}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          password: event.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label>系统角色</label>
                    <select
                      className="select"
                      value={userForm.globalRole}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          globalRole: event.target
                            .value as typeof userForm.globalRole,
                        })
                      }
                    >
                      <option value="STAFF">项目员工</option>
                      <option value="FINANCE">财务只读</option>
                      <option value="ADMIN">管理员</option>
                    </select>
                  </div>
                </div>
                <details className="mt-16">
                  <summary>查看内置角色权限范围</summary>
                  <div className="table-wrap"><table className="data-table">
                    <thead><tr><th>操作</th><th>项目员工</th><th>项目主管</th><th>财务</th><th>管理员</th></tr></thead>
                    <tbody>
                      <tr><td>查询、导出</td><td>参与项目</td><td>负责项目</td><td>全公司</td><td>全公司</td></tr>
                      <tr><td>上传、手工录入</td><td>参与项目</td><td>负责项目</td><td>无</td><td>全部项目</td></tr>
                      <tr><td>修改、提交、删草稿</td><td>自己创建</td><td>自己创建</td><td>无</td><td>全部项目</td></tr>
                      <tr><td>校正待审单、审核、退回</td><td>无</td><td>负责项目</td><td>无</td><td>全部项目</td></tr>
                      <tr><td>撤回已通过单据</td><td>无</td><td>负责项目，填写原因</td><td>无</td><td>全部项目，填写原因</td></tr>
                      <tr><td>合同价、账号、项目管理</td><td>无</td><td>无</td><td>无</td><td>允许</td></tr>
                    </tbody>
                  </table></div>
                  <p className="text-muted">草稿或退回单据可修改、提交、删除；已通过单据需先撤回。每个项目独立授权，财务保持只读。</p>
                </details>
                {userForm.globalRole === "STAFF" ? <ProjectRoleFields roles={customRoles} projects={bootstrap.projects}
                  value={userForm.projectRoles} onChange={projectRoles => setUserForm({...userForm, projectRoles})} /> : null}
                <button
                  className="btn btn--primary btn--small mt-16"
                  type="submit"
                >
                  <Plus size={13} /> 创建员工
                </button>
              </fieldset></form>
      </EditorSheet>}
      {activeUser && <EditorSheet title={activeUser.active ? "停用员工账号" : "启用员工账号"} onClose={() => { if (!savingUserState) setActiveUser(null); }}><p>{activeUser.name}（{activeUser.employeeNo}）</p><p>{activeUser.active ? "停用后该账号的登录与接口权限立即失效，历史业务记录保留。" : "确认重新启用此账号？"}</p><div className="modal-actions"><button className="btn btn--outline" disabled={savingUserState} onClick={() => setActiveUser(null)}>取消</button><button className="btn btn--primary" disabled={savingUserState} onClick={() => toggleUser(activeUser)}>确认{activeUser.active ? "停用" : "启用"}</button></div></EditorSheet>}
      {passwordUser && <EditorSheet title={`重置密码：${passwordUser.name}`} onClose={() => { if (!savingPassword) { setPasswordUser(null); setPassword(""); } }}>
        <form onSubmit={resetPassword}><label className="field">新密码<input className="input" type="password" autoComplete="new-password" minLength={8} maxLength={200} required value={password} disabled={savingPassword} onChange={event => setPassword(event.target.value)} /></label>
          <button className="btn btn--primary mt-16" disabled={savingPassword}>{savingPassword ? "保存中…" : "保存新密码"}</button></form>
      </EditorSheet>}
      {deleteUser && <EditorSheet title="删除员工账号" onClose={() => { if (!deleting) setDeleteUser(null); }}>
        <form onSubmit={confirmDeleteUser}>
          <p>确认删除 <strong>{deleteUser.name}（{deleteUser.employeeNo}）</strong>？</p>
          <p>删除后立即无法登录，并从账号列表移除。历史单据、营业额及审核记录保留，原员工号不再复用。</p>
          <div className="page-actions mt-16"><button className="btn btn--outline" type="button" disabled={deleting} onClick={() => setDeleteUser(null)}>取消</button><button className="btn btn--danger" disabled={deleting}>{deleting ? "删除中…" : "确认删除账号"}</button></div>
        </form>
      </EditorSheet>}
    </div>
  );
}

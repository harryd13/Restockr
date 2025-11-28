import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

function AdminMasterData() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [categoryForm, setCategoryForm] = useState({ name: "" });
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const [itemForm, setItemForm] = useState({ name: "", categoryId: "", unit: "", defaultPrice: "" });
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemDraft, setItemDraft] = useState({ name: "", categoryId: "", unit: "", defaultPrice: "" });

  const [branchForm, setBranchForm] = useState({ name: "", code: "" });
  const [editingBranchId, setEditingBranchId] = useState(null);
  const [branchDraft, setBranchDraft] = useState({ name: "", code: "" });

  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "BRANCH", branchId: "" });
  const [editingUserId, setEditingUserId] = useState(null);
  const [userDraft, setUserDraft] = useState({ name: "", email: "", password: "", role: "BRANCH", branchId: "" });

  useEffect(() => {
    fetchAll();
  }, []);

  const handleError = (err) => {
    const msg = err?.response?.data?.message || err.message || "Something went wrong";
    setError(msg);
    console.error(err);
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [catRes, itemRes, branchRes, userRes] = await Promise.all([
        axios.get("/api/admin/categories"),
        axios.get("/api/admin/items"),
        axios.get("/api/admin/branches"),
        axios.get("/api/admin/users")
      ]);
      setCategories(catRes.data);
      setItems(itemRes.data);
      setBranches(branchRes.data);
      setUsers(userRes.data);
      setError("");
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const addCategory = async (e) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;
    try {
      setSaving(true);
      await axios.post("/api/admin/categories", { name: categoryForm.name.trim() });
      setCategoryForm({ name: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async (id) => {
    if (!editingCategoryName.trim()) return;
    try {
      setSaving(true);
      await axios.put(`/api/admin/categories/${id}`, { name: editingCategoryName.trim() });
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id) => {
    if (!window.confirm("Delete this category?")) return;
    try {
      setSaving(true);
      await axios.delete(`/api/admin/categories/${id}`);
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!itemForm.name.trim() || !itemForm.categoryId) return;
    try {
      setSaving(true);
      await axios.post("/api/admin/items", {
        name: itemForm.name.trim(),
        categoryId: itemForm.categoryId,
        unit: itemForm.unit,
        defaultPrice: Number(itemForm.defaultPrice) || 0
      });
      setItemForm({ name: "", categoryId: "", unit: "", defaultPrice: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async (id) => {
    if (!itemDraft.name.trim() || !itemDraft.categoryId) return;
    try {
      setSaving(true);
      await axios.put(`/api/admin/items/${id}`, {
        name: itemDraft.name.trim(),
        categoryId: itemDraft.categoryId,
        unit: itemDraft.unit,
        defaultPrice: Number(itemDraft.defaultPrice) || 0
      });
      setEditingItemId(null);
      setItemDraft({ name: "", categoryId: "", unit: "", defaultPrice: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id) => {
    if (!window.confirm("Delete this item?")) return;
    try {
      setSaving(true);
      await axios.delete(`/api/admin/items/${id}`);
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const addBranch = async (e) => {
    e.preventDefault();
    if (!branchForm.name.trim() || !branchForm.code.trim()) return;
    try {
      setSaving(true);
      await axios.post("/api/admin/branches", { name: branchForm.name.trim(), code: branchForm.code.trim() });
      setBranchForm({ name: "", code: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const saveBranch = async (id) => {
    if (!branchDraft.name.trim() || !branchDraft.code.trim()) return;
    try {
      setSaving(true);
      await axios.put(`/api/admin/branches/${id}`, { name: branchDraft.name.trim(), code: branchDraft.code.trim() });
      setEditingBranchId(null);
      setBranchDraft({ name: "", code: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = async (id) => {
    if (!window.confirm("Delete this branch?")) return;
    try {
      setSaving(true);
      await axios.delete(`/api/admin/branches/${id}`);
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    if (!userForm.name.trim() || !userForm.email.trim() || !userForm.password.trim() || !userForm.role) return;
    if (userForm.role === "BRANCH" && !userForm.branchId) {
      setError("Branch user requires a branch");
      return;
    }
    try {
      setSaving(true);
      await axios.post("/api/admin/users", {
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        password: userForm.password,
        role: userForm.role,
        branchId: userForm.role === "BRANCH" ? userForm.branchId : null
      });
      setUserForm({ name: "", email: "", password: "", role: "BRANCH", branchId: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const saveUser = async (id) => {
    if (!userDraft.name.trim() || !userDraft.email.trim() || !userDraft.role) return;
    if (userDraft.role === "BRANCH" && !userDraft.branchId) {
      setError("Branch user requires a branch");
      return;
    }
    try {
      setSaving(true);
      await axios.put(`/api/admin/users/${id}`, {
        name: userDraft.name.trim(),
        email: userDraft.email.trim(),
        password: userDraft.password || undefined,
        role: userDraft.role,
        branchId: userDraft.role === "BRANCH" ? userDraft.branchId : null
      });
      setEditingUserId(null);
      setUserDraft({ name: "", email: "", password: "", role: "BRANCH", branchId: "" });
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try {
      setSaving(true);
      await axios.delete(`/api/admin/users/${id}`);
      await fetchAll();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const roleOptions = useMemo(() => [
    { value: "BRANCH", label: "Branch" },
    { value: "OPS", label: "Ops" },
    { value: "ADMIN", label: "Admin" }
  ], []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="section-card">
        <h3 className="section-title">Master Data (Admin)</h3>
        <p className="muted-text">Manage categories, items, branches, and users used across the app.</p>
        {error && (
          <div
            style={{
              marginTop: "0.5rem",
              background: "#fee2e2",
              color: "#991b1b",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              fontWeight: 600
            }}
          >
            {error}
          </div>
        )}
        {loading && <div className="muted-text">Loading...</div>}
      </section>

      {/* Categories */}
      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <div>
            <h4 className="section-title">Categories</h4>
            <p className="muted-text">Add or rename product categories.</p>
          </div>
          <form onSubmit={addCategory} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              placeholder="Category name"
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ name: e.target.value })}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Add
            </button>
          </form>
        </div>
        <div className="table-wrapper" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td>
                    {editingCategoryId === cat.id ? (
                      <input value={editingCategoryName} onChange={(e) => setEditingCategoryName(e.target.value)} />
                    ) : (
                      cat.name
                    )}
                  </td>
                  <td style={{ display: "flex", gap: "0.5rem" }}>
                    {editingCategoryId === cat.id ? (
                      <>
                        <button type="button" className="btn btn-primary" onClick={() => saveCategory(cat.id)} disabled={saving}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setEditingCategoryId(null);
                            setEditingCategoryName("");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditingCategoryId(cat.id);
                            setEditingCategoryName(cat.name);
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => deleteCategory(cat.id)} disabled={saving}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Items */}
      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h4 className="section-title">Items</h4>
            <p className="muted-text">Maintain SKUs, unit, and default price.</p>
          </div>
          <form onSubmit={addItem} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Item name"
              value={itemForm.name}
              onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <select
              value={itemForm.categoryId}
              onChange={(e) => setItemForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Unit (kg, litre, pack)"
              value={itemForm.unit}
              onChange={(e) => setItemForm((f) => ({ ...f, unit: e.target.value }))}
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Default price"
              value={itemForm.defaultPrice}
              onChange={(e) => setItemForm((f) => ({ ...f, defaultPrice: e.target.value }))}
            />
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Add
            </button>
          </form>
        </div>
        <div className="table-wrapper" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Default Price</th>
                <th style={{ width: 200 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {editingItemId === it.id ? (
                      <input value={itemDraft.name} onChange={(e) => setItemDraft((d) => ({ ...d, name: e.target.value }))} />
                    ) : (
                      it.name
                    )}
                  </td>
                  <td>
                    {editingItemId === it.id ? (
                      <select value={itemDraft.categoryId} onChange={(e) => setItemDraft((d) => ({ ...d, categoryId: e.target.value }))}>
                        <option value="">Select category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      categories.find((c) => c.id === it.categoryId)?.name || ""
                    )}
                  </td>
                  <td>
                    {editingItemId === it.id ? (
                      <input value={itemDraft.unit} onChange={(e) => setItemDraft((d) => ({ ...d, unit: e.target.value }))} />
                    ) : (
                      it.unit
                    )}
                  </td>
                  <td>
                    {editingItemId === it.id ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={itemDraft.defaultPrice}
                        onChange={(e) => setItemDraft((d) => ({ ...d, defaultPrice: e.target.value }))}
                      />
                    ) : (
                      Number(it.defaultPrice || 0).toFixed(2)
                    )}
                  </td>
                  <td style={{ display: "flex", gap: "0.5rem" }}>
                    {editingItemId === it.id ? (
                      <>
                        <button type="button" className="btn btn-primary" onClick={() => saveItem(it.id)} disabled={saving}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setEditingItemId(null);
                            setItemDraft({ name: "", categoryId: "", unit: "", defaultPrice: "" });
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditingItemId(it.id);
                            setItemDraft({
                              name: it.name,
                              categoryId: it.categoryId,
                              unit: it.unit || "",
                              defaultPrice: it.defaultPrice ?? ""
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => deleteItem(it.id)} disabled={saving}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Branches */}
      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h4 className="section-title">Branches</h4>
            <p className="muted-text">Add or update branch details.</p>
          </div>
          <form onSubmit={addBranch} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Branch name"
              value={branchForm.name}
              onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              type="text"
              placeholder="Code"
              value={branchForm.code}
              onChange={(e) => setBranchForm((f) => ({ ...f, code: e.target.value }))}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Add
            </button>
          </form>
        </div>
        <div className="table-wrapper" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td>
                    {editingBranchId === b.id ? (
                      <input value={branchDraft.name} onChange={(e) => setBranchDraft((d) => ({ ...d, name: e.target.value }))} />
                    ) : (
                      b.name
                    )}
                  </td>
                  <td>
                    {editingBranchId === b.id ? (
                      <input value={branchDraft.code} onChange={(e) => setBranchDraft((d) => ({ ...d, code: e.target.value }))} />
                    ) : (
                      b.code
                    )}
                  </td>
                  <td style={{ display: "flex", gap: "0.5rem" }}>
                    {editingBranchId === b.id ? (
                      <>
                        <button type="button" className="btn btn-primary" onClick={() => saveBranch(b.id)} disabled={saving}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setEditingBranchId(null);
                            setBranchDraft({ name: "", code: "" });
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditingBranchId(b.id);
                            setBranchDraft({ name: b.name, code: b.code });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => deleteBranch(b.id)} disabled={saving}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Users */}
      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h4 className="section-title">Users</h4>
            <p className="muted-text">Manage logins and roles.</p>
          </div>
          <form onSubmit={addUser} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Name"
              value={userForm.name}
              onChange={(e) => setUserForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={userForm.email}
              onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={userForm.password}
              onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
            <select value={userForm.role} onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value }))}>
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={userForm.branchId}
              onChange={(e) => setUserForm((f) => ({ ...f, branchId: e.target.value }))}
              disabled={userForm.role !== "BRANCH"}
            >
              <option value="">Branch (branch role only)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Add
            </button>
          </form>
        </div>
        <div className="table-wrapper" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Branch</th>
                <th style={{ width: 240 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {editingUserId === u.id ? (
                      <input value={userDraft.name} onChange={(e) => setUserDraft((d) => ({ ...d, name: e.target.value }))} />
                    ) : (
                      u.name
                    )}
                  </td>
                  <td>
                    {editingUserId === u.id ? (
                      <input value={userDraft.email} onChange={(e) => setUserDraft((d) => ({ ...d, email: e.target.value }))} />
                    ) : (
                      u.email
                    )}
                  </td>
                  <td>
                    {editingUserId === u.id ? (
                      <select value={userDraft.role} onChange={(e) => setUserDraft((d) => ({ ...d, role: e.target.value }))}>
                        {roleOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      u.role
                    )}
                  </td>
                  <td>
                    {editingUserId === u.id ? (
                      <select
                        value={userDraft.branchId || ""}
                        onChange={(e) => setUserDraft((d) => ({ ...d, branchId: e.target.value }))}
                        disabled={userDraft.role !== "BRANCH"}
                      >
                        <option value="">Branch (branch role only)</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      u.branchId ? branches.find((b) => b.id === u.branchId)?.name || u.branchId : "-"
                    )}
                  </td>
                  <td style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {editingUserId === u.id ? (
                      <>
                        <input
                          type="password"
                          placeholder="New password (optional)"
                          value={userDraft.password}
                          onChange={(e) => setUserDraft((d) => ({ ...d, password: e.target.value }))}
                          style={{ minWidth: 180 }}
                        />
                        <button type="button" className="btn btn-primary" onClick={() => saveUser(u.id)} disabled={saving}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setEditingUserId(null);
                            setUserDraft({ name: "", email: "", password: "", role: "BRANCH", branchId: "" });
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditingUserId(u.id);
                            setUserDraft({
                              name: u.name,
                              email: u.email,
                              password: "",
                              role: u.role,
                              branchId: u.branchId || ""
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => deleteUser(u.id)} disabled={saving}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default AdminMasterData;

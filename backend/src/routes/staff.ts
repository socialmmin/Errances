import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireRole } from "../middleware/authenticate.js";
import { broadcastChange } from "../realtime.js";

const router = Router();
router.use(requireRole("admin"));
router.post("/", save);
router.patch("/:id", save);

async function save(
  req: import("express").Request,
  res: import("express").Response,
) {
  const editing = req.method === "PATCH";
  const { password, ...input } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize account identity changes, including cross-column login collisions.
    await client.query("LOCK TABLE staffs IN SHARE ROW EXCLUSIVE MODE");
    const existing = editing
      ? (
          await client.query("SELECT * FROM staffs WHERE id = $1", [
            req.params.id,
          ])
        ).rows[0]
      : {};
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Staff member not found" });
    }
    const data = { ...existing, ...input };
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const accessKey = String(data.access_key || "").trim();
    const name = String(data.full_name || "").trim();
    const status = data.status || "active";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      name.length < 2 ||
      (!editing && !accessKey) ||
      (accessKey && !/^[a-zA-Z0-9._-]{3,40}$/.test(accessKey)) ||
      !["admin", "sales_manager", "sales_executive", "support"].includes(
        data.role,
      ) ||
      !["active", "inactive"].includes(status)
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({
          error:
            "Enter a valid name, email, role and login ID (3–40 letters, numbers, dots, underscores or hyphens).",
        });
    }
    if (
      (!editing || password) &&
      (typeof password !== "string" ||
        password.length < 8 ||
        Buffer.byteLength(password) > 72)
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({
          error: "Password must be at least 8 characters and at most 72 bytes.",
        });
    }
    if (
      editing &&
      req.params.id === req.user!.sub &&
      (status !== "active" || data.role !== "admin")
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({
          error:
            "You cannot deactivate or remove admin access from your own account.",
        });
    }
    const duplicate = await client.query(
      "SELECT id FROM staffs WHERE (lower(email) = ANY($1) OR lower(access_key) = ANY($1)) AND ($2::uuid IS NULL OR id <> $2)",
      [
        [email, accessKey.toLowerCase()].filter(Boolean),
        editing ? req.params.id : null,
      ],
    );
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Email or login ID is already in use." });
    }
    const hash = password
      ? await bcrypt.hash(password, 12)
      : existing.password_hash;
    const values = [
      email,
      accessKey || null,
      name,
      data.role,
      data.phone || null,
      status,
      hash,
      data.avatar_url || null,
      data.department || null,
    ];
    const result = editing
      ? await client.query(
          "UPDATE staffs SET email=$1, access_key=$2, full_name=$3, role=$4, phone=$5, status=$6, password_hash=$7, avatar_url=$8, department=$9 WHERE id=$10 RETURNING *",
          [...values, req.params.id],
        )
      : await client.query(
          "INSERT INTO staffs (email,access_key,full_name,role,phone,status,password_hash,avatar_url,department) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          values,
        );
    const { password_hash: _hash, ...staff } = result.rows[0];
    await client.query(
      "INSERT INTO profiles (id,full_name,email,role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name,email=EXCLUDED.email,role=EXCLUDED.role",
      [staff.id, name, email, data.role],
    );
    await client.query("COMMIT");
    broadcastChange("staffs", editing ? "UPDATE" : "INSERT", { new: staff });
    return res.status(editing ? 200 : 201).json(staff);
  } catch (error: any) {
    await client.query("ROLLBACK");
    return res
      .status(error.code === "23505" ? 409 : 400)
      .json({
        error:
          error.code === "23505"
            ? "Email or login ID is already in use."
            : "Unable to save staff member. Check the account details.",
      });
  } finally {
    client.release();
  }
}
export default router;

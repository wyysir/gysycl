import { getDb } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/passwords";

const employeeNo = process.env.ADMIN_EMPLOYEE_NO?.trim();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "系统管理员";

if (!employeeNo || !password || password.length < 8) {
  console.error(
    "请设置 ADMIN_EMPLOYEE_NO、ADMIN_PASSWORD（至少 8 位）和可选的 ADMIN_NAME。",
  );
  process.exit(1);
}

const db = await getDb();
const existing = await db.user.findUnique({ where: { employeeNo } });
if (existing) {
  console.log(`员工号 ${employeeNo} 已存在，未重复创建。`);
  process.exit(0);
}
await db.user.create({
  data: {
    employeeNo,
    name,
    passwordHash: hashPassword(password),
    globalRole: "ADMIN",
  },
});
console.log(`管理员 ${employeeNo} 已创建。首次登录后请立即维护项目点与员工账号。`);
process.exit(0);

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import {
  authenticate,
  createSessionToken,
  setSessionCookie,
  verifyBindTicket,
} from "@/server/auth";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({
  ticket: z.string().min(20),
  employeeNo: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseJson(request, schema);
    const ticket = await verifyBindTicket(body.ticket);
    if (!ticket) {
      return NextResponse.json(
        { error: "绑定凭证已过期，请重新从公众号进入" },
        { status: 400 },
      );
    }
    const user = await authenticate(body.employeeNo, body.password);
    if (!user) {
      return NextResponse.json({ error: "工号或密码错误" }, { status: 401 });
    }
    const db = await getReadyDb();
    const existingUserBinding = await db.wechatBinding.findUnique({
      where: { userId: user.id },
    });
    if (existingUserBinding && existingUserBinding.openid !== ticket.openid) {
      return NextResponse.json(
        { error: "该员工号已绑定其他微信，请联系管理员解绑" },
        { status: 409 },
      );
    }
    const existingOpenid = await db.wechatBinding.findUnique({
      where: { openid: ticket.openid },
    });
    if (existingOpenid && existingOpenid.userId !== user.id) {
      return NextResponse.json(
        { error: "该微信已绑定其他员工号" },
        { status: 409 },
      );
    }
    await db.wechatBinding.upsert({
      where: { openid: ticket.openid },
      update: { userId: user.id, lastSeenAt: new Date() },
      create: { openid: ticket.openid, userId: user.id },
    });
    const response = NextResponse.json({ user });
    setSessionCookie(response, await createSessionToken(user.id));
    return response;
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

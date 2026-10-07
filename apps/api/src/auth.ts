import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";

const scrypt = promisify(nodeScrypt);
const SESSION_DAYS = 7;
const prisma = new PrismaClient();

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function cookie(request: FastifyRequest, name: string) {
  return request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function createSession(userId: string, reply: FastifyReply) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  await prisma.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) } });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", [`game2web_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`, `game2web_csrf=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`]);
}

export async function currentUser(request: FastifyRequest) {
  const token = cookie(request, "game2web_session");
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) { await reply.code(401).send({ error: "Authentication required" }); return null; }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const csrf = cookie(request, "game2web_csrf");
    if (!csrf || request.headers["x-csrf-token"] !== csrf) { await reply.code(403).send({ error: "CSRF validation failed" }); return null; }
  }
  return user;
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const token = cookie(request, "game2web_session");
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  reply.header("Set-Cookie", ["game2web_session=; HttpOnly; Path=/; Max-Age=0", "game2web_csrf=; Path=/; Max-Age=0"]);
}

export function validPassword(password: string) { return password.length >= 10 && password.length <= 128; }
export function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320; }
export function getPrisma() { return prisma; }

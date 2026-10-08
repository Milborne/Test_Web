import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { PrismaClient } from "@prisma/client";
import { godotAudioStates, installGodotRuntimeObservers } from "./helpers/godot-runtime-observer";

const api = "http://127.0.0.1:4000";
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const playerOrigin = process.env.PLAYER_ORIGIN ?? "http://localhost:4000";
const prisma = new PrismaClient();

test("Godot upload, build, deployment and player", async ({ page, request, playwright }) => {
  await installGodotRuntimeObservers(page);
  const browserErrors: string[] = [];
  const wasmResponses: string[] = [];
  const javascriptResponses: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => {
    if (response.ok() && /\.wasm(?:$|\?)/i.test(response.url())) wasmResponses.push(response.url());
    if (response.ok() && /\.js(?:$|\?)/i.test(response.url())) javascriptResponses.push(response.url());
  });
  const email = `e2e-${Date.now()}@example.test`;
  const auth = await request.post(`${api}/api/auth/register`, { data: { email, password: "correct horse battery" } });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const headers = { "x-csrf-token": csrf };
  const archive = await readFile("examples/godot-demo.zip");
  const projectResponse = await request.post(`${api}/api/projects`, { headers, multipart: { name: "godot-demo", redistributionStatus: "REDISTRIBUTION_CLEARED", archive: { name: "godot-demo.zip", mimeType: "application/zip", buffer: archive } } });
  expect(projectResponse.ok()).toBeTruthy();
  const created = await projectResponse.json();
  expect(created.compatibility.provider).toBe("godot");
  expect(created.compatibility.compatible).toBeTruthy();
  const buildResponse = await request.post(`${api}/api/projects/${created.project.id}/builds`, { headers, data: {} });
  expect(buildResponse.status()).toBe(202);
  const build = await buildResponse.json();
  await expect.poll(async () => {
    const statusResponse = await request.get(`${api}/api/builds/${build.id}`);
    const status = await statusResponse.json();
    if (status.status === "FAILED") throw new Error(status.error ?? "Build failed without an error message");
    return status.status;
  }, { timeout: 150_000 }).toBe("READY");
  const finalBuild = await (await request.get(`${api}/api/builds/${build.id}`)).json();
  const indexArtifact = finalBuild.artifacts.find((artifact: { path: string }) => artifact.path === "index.html");
  expect(indexArtifact).toBeTruthy();
  const publishedIndex = await request.get(`${api}/api/play/${created.project.slug}/`);
  expect(publishedIndex.ok()).toBeTruthy();
  const indexBody = await publishedIndex.body();
  expect(indexBody.length).toBe(Number(indexArtifact.size));
  expect(createHash("sha256").update(indexBody).digest("hex")).toBe(indexArtifact.checksum);
  expect(finalBuild.deployment.slug).toBe(created.project.slug);
  expect(finalBuild.publicUrl).toContain(`/play/${created.project.slug}`);
  await page.goto(`/play/${created.project.slug}`);
  await expect(page.locator("iframe")).toBeVisible();
  const frame = page.frameLocator("iframe");
  const gameFrame = page.frames().find((candidate) => candidate.url().includes(`/api/play/${created.project.slug}/`));
  expect(gameFrame, "published Godot iframe should be loaded").toBeTruthy();
  if (!gameFrame) return;
  await expect(frame.locator("#game2web-start-overlay")).toBeVisible({ timeout: 30_000 });
  expect(await godotAudioStates(gameFrame)).not.toContain("running");
  await frame.getByRole("button", { name: "Play Game" }).press("Enter");
  await expect(frame.locator("#game2web-start-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => godotAudioStates(gameFrame), { timeout: 30_000 }).toContain("running");
  expect(await gameFrame.evaluate(() => document.activeElement?.id)).toBe("canvas");

  const previewBuildResponse = await request.post(`${api}/api/projects/${created.project.id}/builds`, { headers, data: { mode: "PREVIEW" } });
  expect(previewBuildResponse.status()).toBe(202);
  const previewBuild = await previewBuildResponse.json();
  await expect.poll(async () => {
    const status = await (await request.get(`${api}/api/builds/${previewBuild.id}`)).json();
    if (status.status === "FAILED") throw new Error(status.error ?? "Preview build failed without an error message");
    return status.status;
  }, { timeout: 150_000 }).toBe("READY");
  const previewResponse = await request.post(`${api}/api/builds/${previewBuild.id}/previews`, { headers, data: {} });
  expect(previewResponse.status()).toBe(201);
  const preview = await previewResponse.json();
  expect(preview.persistent).toBe(false);
  expect(preview.expiresAt).toBeTruthy();
  expect(preview.technicalStatus).toBe("READY");
  expect(preview.redistributionStatus).toBe("REDISTRIBUTION_CLEARED");
  expect(await prisma.previewDeployment.findUnique({ where: { id: preview.id } }).then((record) => record?.status)).toBe("READY");
  const originalPreviewToken = new URL(preview.url).pathname.split("/").at(-1);
  const linkResponse = await request.post(`${api}/api/builds/${previewBuild.id}/previews/link`, { headers, data: {} });
  expect(linkResponse.status()).toBe(200);
  const recoveredLink = await linkResponse.json();
  expect(recoveredLink.id).toBe(preview.id);
  expect((await request.get(`${api}/api/preview/${originalPreviewToken}/`)).status()).toBe(404);
  preview.url = recoveredLink.url;
  await prisma.previewDeployment.update({ where: { id: preview.id }, data: { status: "CREATING" } });
  expect((await request.get(`${api}/api/preview/${new URL(preview.url).pathname.split("/").at(-1)}/`)).status()).toBe(404);
  await prisma.previewDeployment.update({ where: { id: preview.id }, data: { status: "READY" } });
  const previewIndex = await request.get(`${api}/api/preview/${new URL(preview.url).pathname.split("/").at(-1)}/`);
  expect(previewIndex.ok()).toBeTruthy();
  expect(previewIndex.headers()["cache-control"]).toContain("no-store");
  browserErrors.length = 0;
  wasmResponses.length = 0;
  javascriptResponses.length = 0;
  await page.goto(preview.url);
  const previewFrame = page.frameLocator("iframe");
  await expect(previewFrame.locator("#game2web-start-overlay")).toBeVisible({ timeout: 30_000 });
  const previewToken = new URL(preview.url).pathname.split("/").at(-1);
  const previewGameFrame = page.frames().find((candidate) => candidate.url().includes(`/api/preview/${previewToken}/`));
  expect(previewGameFrame, "temporary preview iframe should be loaded").toBeTruthy();
  if (!previewGameFrame) return;
  expect(await godotAudioStates(previewGameFrame)).not.toContain("running");
  await previewFrame.getByRole("button", { name: "Play Game" }).click();
  await expect(previewFrame.locator("#game2web-start-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(previewFrame.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => godotAudioStates(previewGameFrame), { timeout: 30_000 }).toContain("running");
  await expect.poll(() => wasmResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => javascriptResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);

  const otherUser = await playwright.request.newContext();
  const otherAuth = await otherUser.post(`${api}/api/auth/register`, { data: { email: `preview-other-${Date.now()}@example.test`, password: "correct horse battery" } });
  const otherCsrf = otherAuth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  expect((await otherUser.delete(`${api}/api/previews/${preview.id}`, { headers: { "x-csrf-token": otherCsrf } })).status()).toBe(404);
  expect((await otherUser.post(`${api}/api/builds/${previewBuild.id}/previews/link`, { headers: { "x-csrf-token": otherCsrf }, data: {} })).status()).toBe(404);
  await otherUser.dispose();
  expect((await request.delete(`${api}/api/previews/${preview.id}`, { headers })).status()).toBe(204);
  expect((await request.get(`${api}/api/preview/${new URL(preview.url).pathname.split("/").at(-1)}/`)).status()).toBe(404);

  const expiringResponse = await request.post(`${api}/api/builds/${previewBuild.id}/previews`, { headers, data: {} });
  expect(expiringResponse.status()).toBe(201);
  const expiringPreview = await expiringResponse.json();
  await prisma.previewDeployment.update({ where: { id: expiringPreview.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expiringToken = new URL(expiringPreview.url).pathname.split("/").at(-1);
  expect((await request.get(`${api}/api/preview/${expiringToken}/`)).status()).toBe(404);
  await expect.poll(async () => prisma.previewDeployment.findUnique({ where: { id: expiringPreview.id } }), { timeout: 15_000 }).toBeNull();
});

test("production builds require explicit redistribution clearance", async ({ request }) => {
  const auth = await request.post(`${api}/api/auth/register`, { data: { email: `license-${Date.now()}@example.test`, password: "correct horse battery" } });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const archive = await readFile("examples/godot-demo.zip");
  const uploaded = await request.post(`${api}/api/projects`, {
    headers: { "x-csrf-token": csrf },
    multipart: { name: "license-review", archive: { name: "godot-demo.zip", mimeType: "application/zip", buffer: archive } }
  });
  expect(uploaded.ok()).toBeTruthy();
  const project = await uploaded.json();
  expect(project.project.redistributionStatus).toBe("LICENSE_REVIEW_REQUIRED");
  const response = await request.post(`${api}/api/projects/${project.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} });
  expect(response.status()).toBe(403);
  expect((await response.json()).error).toContain("explicit redistribution license clearance");
});

test("Godot preflight rejects unsupported projects before queueing a build", async ({ request }) => {
  const auth = await request.post(`${api}/api/auth/register`, { data: { email: `preflight-${Date.now()}@example.test`, password: "correct horse battery" } });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const archive = new AdmZip();
  archive.addLocalFolder("tests/fixtures/godot-preflight/godot-3");
  const uploaded = await request.post(`${api}/api/projects`, {
    headers: { "x-csrf-token": csrf },
    multipart: { name: "godot-3-fixture", archive: { name: "godot-3.zip", mimeType: "application/zip", buffer: archive.toBuffer() } }
  });
  expect(uploaded.ok()).toBeTruthy();
  const project = await uploaded.json();
  expect(project.compatibility.preflight.status).toBe("UNSUPPORTED");
  expect(project.compatibility.preflight.engineVersion.major).toBe(3);
  const build = await request.post(`${api}/api/projects/${project.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} });
  expect(build.status()).toBe(422);
  const rejected = await build.json();
  expect(rejected.compatibility.preflight.status).toBe("UNSUPPORTED");
  expect(rejected.error).toContain("supports Godot 4.x");
});

test("SDL upload, Emscripten build, deployment and player", async ({ page, playwright }) => {
  const request = await playwright.request.newContext();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  const auth = await request.post(`${api}/api/auth/register`, { data: { email: `sdl-${Date.now()}@example.test`, password: "correct horse battery" } });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const archive = await readFile("examples/sdl-demo.zip");
  const projectResponse = await request.post(`${api}/api/projects`, { headers: { "x-csrf-token": csrf }, multipart: { name: "sdl-demo", redistributionStatus: "REDISTRIBUTION_CLEARED", archive: { name: "sdl-demo.zip", mimeType: "application/zip", buffer: archive } } });
  expect(projectResponse.ok()).toBeTruthy();
  const created = await projectResponse.json();
  expect(created.compatibility.provider).toBe("emscripten-sdl");
  expect(created.compatibility.engine).toBe("C/C++ + SDL");
  expect(created.compatibility.compatible).toBeTruthy();
  const buildResponse = await request.post(`${api}/api/projects/${created.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} });
  expect(buildResponse.status()).toBe(202);
  const build = await buildResponse.json();
  await expect.poll(async () => {
    const status = await (await request.get(`${api}/api/builds/${build.id}`)).json();
    if (status.status === "FAILED") throw new Error(`${status.error ?? "SDL build failed without an error message"}\n${status.logs?.map((log: { message: string }) => log.message).join("\n") ?? ""}`);
    return status.status;
  }, { timeout: 180_000 }).toBe("READY");
  const finalBuild = await (await request.get(`${api}/api/builds/${build.id}`)).json();
  expect(finalBuild.artifacts.some((artifact: { path: string; mimeType: string }) => artifact.path.endsWith(".wasm") && artifact.mimeType === "application/wasm")).toBeTruthy();
  expect(finalBuild.artifacts.some((artifact: { path: string; mimeType: string }) => artifact.path.endsWith(".js") && artifact.mimeType === "application/javascript")).toBeTruthy();
  await page.goto(`/play/${created.project.slug}`);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 30_000 });
  try {
    await expect(frame.locator("#game-ready")).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${runtimeErrors.join("\n")}`);
  }
  await request.dispose();
});

test("invalid archive is rejected before queueing", async ({ request }) => {
  const auth = await request.post(`${api}/api/auth/register`, { data: { email: `invalid-${Date.now()}@example.test`, password: "correct horse battery" } });
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const headers = { "x-csrf-token": csrf };
  const zip = new AdmZip();
  zip.addFile("README.txt", Buffer.from("not a supported project"));
  const response = await request.post(`${api}/api/projects`, { headers, multipart: { name: "invalid", archive: { name: "invalid.zip", mimeType: "application/zip", buffer: zip.toBuffer() } } });
  expect(response.ok()).toBeTruthy();
  const created = await response.json();
  expect(created.compatibility.compatible).toBeFalsy();
  const build = await request.post(`${api}/api/projects/${created.project.id}/builds`, { headers, data: {} });
  expect(build.status()).toBe(422);
});

test("invalid SDL project is rejected before queueing", async ({ request }) => {
  const auth = await request.post(`${api}/api/auth/register`, { data: { email: `sdl-invalid-${Date.now()}@example.test`, password: "correct horse battery" } });
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const archive = await readFile("examples/sdl-invalid.zip");
  const projectResponse = await request.post(`${api}/api/projects`, { headers: { "x-csrf-token": csrf }, multipart: { name: "sdl-invalid", archive: { name: "sdl-invalid.zip", mimeType: "application/zip", buffer: archive } } });
  expect(projectResponse.ok()).toBeTruthy();
  const created = await projectResponse.json();
  expect(created.compatibility.provider).toBe("emscripten-sdl");
  expect(created.compatibility.compatible).toBeFalsy();
  expect((await request.post(`${api}/api/projects/${created.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} })).status()).toBe(422);
});

test("private project access is isolated between users", async ({ playwright }) => {
  const userA = await playwright.request.newContext({ baseURL: api });
  const userB = await playwright.request.newContext({ baseURL: api });
  const authA = await userA.post("/api/auth/register", { data: { email: `a-${Date.now()}@example.test`, password: "correct horse battery" } });
  const csrfA = authA.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const zip = new AdmZip();
  zip.addFile("README.txt", Buffer.from("private"));
  const project = await userA.post("/api/projects", { headers: { "x-csrf-token": csrfA }, multipart: { name: "private", archive: { name: "private.zip", mimeType: "application/zip", buffer: zip.toBuffer() } } });
  const created = await project.json();
  const authB = await userB.post("/api/auth/register", { data: { email: `b-${Date.now()}@example.test`, password: "correct horse battery" } });
  const csrfB = authB.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  expect(await (await userB.get("/api/projects")).json()).toEqual([]);
  expect((await userB.post(`/api/projects/${created.project.id}/builds`, { headers: { "x-csrf-token": csrfB }, data: {} })).status()).toBe(404);
  await userA.dispose();
  await userB.dispose();
});

test("M7 origin and public access boundaries are enforced", async ({ playwright, page }) => {
  const request = await playwright.request.newContext();
  const allowed = await request.get(`${api}/api/auth/me`, { headers: { Origin: appOrigin } });
  expect(allowed.status()).toBe(401);
  expect(allowed.headers()["access-control-allow-origin"]).toBe(appOrigin);
  expect(allowed.headers()["access-control-allow-credentials"]).toBe("true");

  const player = await request.get(`${api}/api/auth/me`, { headers: { Origin: playerOrigin } });
  expect(player.status()).toBe(401);
  expect(player.headers()["access-control-allow-origin"]).toBeUndefined();

  const unknown = await request.get(`${api}/api/auth/me`, { headers: { Origin: "https://unknown.example.test" } });
  expect(unknown.status()).toBe(401);
  expect(unknown.headers()["access-control-allow-origin"]).toBeUndefined();

  const registration = await request.post(`${api}/api/auth/register`, {
    data: { email: `cookie-${Date.now()}@example.test`, password: "correct horse battery" }
  });
  expect(registration.ok()).toBeTruthy();
  const setCookie = registration.headers()["set-cookie"];
  expect(setCookie).not.toMatch(/Domain=/i);
  expect(setCookie).toMatch(/game2web_session=/);
  expect(setCookie).toMatch(/game2web_csrf=/);

  await page.context().addCookies([
    { name: "game2web_session", value: "app-origin-session-only", url: "http://127.0.0.1:4000", httpOnly: true, sameSite: "Lax" },
    { name: "game2web_csrf", value: "app-origin-csrf-only", url: "http://127.0.0.1:4000", sameSite: "Lax" }
  ]);
  let playerCookieHeader = "";
  let playerRequestObserved = false;
  await page.route(`${playerOrigin}/api/**`, async (route) => {
    const browserRequest = route.request();
    if (browserRequest.url().startsWith(`${playerOrigin}/api/`)) {
      playerRequestObserved = true;
      playerCookieHeader = (await browserRequest.allHeaders()).cookie ?? "";
    }
    await route.continue();
  });
  await page.goto(`${playerOrigin}/api/auth/me`);
  expect(playerRequestObserved).toBe(true);
  expect(playerCookieHeader).not.toMatch(/game2web_(?:session|csrf)=/);

  const anonymous = await playwright.request.newContext();
  const privateResponse = await anonymous.get(`${api}/api/projects`, { headers: { Origin: playerOrigin } });
  expect(privateResponse.status()).toBe(401);
  expect((await anonymous.get(`${api}/api/play/m7-not-published/`)).status()).toBe(404);
  await anonymous.dispose();
  await request.dispose();
});

test("M7 build admission limits active builds per user", async ({ request }) => {
  test.slow();
  const auth = await request.post(`${api}/api/auth/register`, {
    data: { email: `concurrency-${Date.now()}@example.test`, password: "correct horse battery" }
  });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const archive = await readFile("examples/godot-demo.zip");
  const projectResponse = await request.post(`${api}/api/projects`, {
    headers: { "x-csrf-token": csrf },
    multipart: { name: "concurrency", redistributionStatus: "REDISTRIBUTION_CLEARED", archive: { name: "godot-demo.zip", mimeType: "application/zip", buffer: archive } }
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();
  const buildRequests = await Promise.all([
    request.post(`${api}/api/projects/${project.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} }),
    request.post(`${api}/api/projects/${project.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} }),
    request.post(`${api}/api/projects/${project.project.id}/builds`, { headers: { "x-csrf-token": csrf }, data: {} })
  ]);
  expect(buildRequests.filter((response) => response.status() === 202)).toHaveLength(2);
  expect(buildRequests.filter((response) => response.status() === 429)).toHaveLength(1);
  for (const response of buildRequests.filter((candidate) => candidate.status() === 202)) {
    const build = await response.json();
    await expect.poll(async () => (await request.get(`${api}/api/builds/${build.id}`)).json().then((value) => value.status), { timeout: 180_000 }).toMatch(/READY|FAILED/);
  }
});

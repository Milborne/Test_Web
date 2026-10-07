import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";

const api = "http://127.0.0.1:4000";
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const playerOrigin = process.env.PLAYER_ORIGIN ?? "http://localhost:4000";

test("Godot upload, build, deployment and player", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const auth = await request.post(`${api}/api/auth/register`, { data: { email, password: "correct horse battery" } });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const headers = { "x-csrf-token": csrf };
  const archive = await readFile("examples/godot-demo.zip");
  const projectResponse = await request.post(`${api}/api/projects`, { headers, multipart: { name: "godot-demo", archive: { name: "godot-demo.zip", mimeType: "application/zip", buffer: archive } } });
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
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 30_000 });
});

test("SDL upload, Emscripten build, deployment and player", async ({ page, playwright }) => {
  const request = await playwright.request.newContext();
  const auth = await request.post(`${api}/api/auth/register`, { data: { email: `sdl-${Date.now()}@example.test`, password: "correct horse battery" } });
  expect(auth.ok()).toBeTruthy();
  const csrf = auth.headers()["set-cookie"].match(/game2web_csrf=([^;]+)/)?.[1] ?? "";
  const archive = await readFile("examples/sdl-demo.zip");
  const projectResponse = await request.post(`${api}/api/projects`, { headers: { "x-csrf-token": csrf }, multipart: { name: "sdl-demo", archive: { name: "sdl-demo.zip", mimeType: "application/zip", buffer: archive } } });
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
    if (status.status === "FAILED") throw new Error(status.error ?? "SDL build failed without an error message");
    return status.status;
  }, { timeout: 180_000 }).toBe("READY");
  const finalBuild = await (await request.get(`${api}/api/builds/${build.id}`)).json();
  expect(finalBuild.artifacts.some((artifact: { path: string; mimeType: string }) => artifact.path.endsWith(".wasm") && artifact.mimeType === "application/wasm")).toBeTruthy();
  expect(finalBuild.artifacts.some((artifact: { path: string; mimeType: string }) => artifact.path.endsWith(".js") && artifact.mimeType === "application/javascript")).toBeTruthy();
  await page.goto(`/play/${created.project.slug}`);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator("#game-ready")).toBeVisible({ timeout: 30_000 });
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

test("M7 origin and public access boundaries are enforced", async ({ playwright }) => {
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
    multipart: { name: "concurrency", archive: { name: "godot-demo.zip", mimeType: "application/zip", buffer: archive } }
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

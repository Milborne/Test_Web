import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";

const api = "http://127.0.0.1:4000";

test("Godot upload, build, deployment and player", async ({ page, request }) => {
  const archive = await readFile("examples/godot-demo.zip");
  const projectResponse = await request.post(`${api}/api/projects`, { multipart: { name: "godot-demo", archive: { name: "godot-demo.zip", mimeType: "application/zip", buffer: archive } } });
  expect(projectResponse.ok()).toBeTruthy();
  const created = await projectResponse.json();
  expect(created.compatibility.provider).toBe("godot");
  expect(created.compatibility.compatible).toBeTruthy();
  const buildResponse = await request.post(`${api}/api/projects/${created.project.id}/builds`, { data: {} });
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

test("invalid archive is rejected before queueing", async ({ request }) => {
  const zip = new AdmZip();
  zip.addFile("README.txt", Buffer.from("not a supported project"));
  const response = await request.post(`${api}/api/projects`, { multipart: { name: "invalid", archive: { name: "invalid.zip", mimeType: "application/zip", buffer: zip.toBuffer() } } });
  expect(response.ok()).toBeTruthy();
  const created = await response.json();
  expect(created.compatibility.compatible).toBeFalsy();
  const build = await request.post(`${api}/api/projects/${created.project.id}/builds`, { data: {} });
  expect(build.status()).toBe(422);
});

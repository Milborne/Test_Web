"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
  engine?: string;
  slug: string;
  builds?: { id: string; provider: string; status: string; mode: string; preview?: { id: string; status: string; expiresAt: string } | null }[];
}

interface PreviewLink {
  url: string;
  expiresAt: string;
  persistent: boolean;
  technicalStatus: string;
  redistributionStatus: string;
}

interface UploadPreflight {
  status: string;
  errors: string[];
  warnings: string[];
}

function hasActivePreview(project: Project) {
  const build = project.builds?.[0];
  const preview = build?.preview;
  return build?.mode === "PREVIEW"
    && build.status === "READY"
    && preview?.status === "READY"
    && new Date(preview.expiresAt) > new Date();
}

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [redistributionCleared, setRedistributionCleared] = useState(false);
  const [previewingProjectId, setPreviewingProjectId] = useState("");
  const [previewLinks, setPreviewLinks] = useState<Record<string, PreviewLink>>({});
  const [previewError, setPreviewError] = useState("");

  function csrfHeaders() {
    const csrf = document.cookie.match(/(?:^|; )game2web_csrf=([^;]+)/)?.[1] ?? "";
    return { "x-csrf-token": decodeURIComponent(csrf) };
  }

  async function createPreview(project: Project) {
    setPreviewingProjectId(project.id);
    setPreviewError("");
    setMessage("");
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const latestBuild = project.builds?.[0];
      const activePreviewExists = hasActivePreview(project);
      let buildId = latestBuild?.id;
      if (!activePreviewExists) {
        const buildResponse = await fetch(`${apiUrl}/api/projects/${project.id}/builds`, {
          method: "POST",
          credentials: "include",
          headers: { ...csrfHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ mode: "PREVIEW" })
        });
        const build = await buildResponse.json();
        if (!buildResponse.ok) throw new Error(build.error ?? "Preview build could not be started.");
        buildId = build.id;

        let status = build.status;
        for (let attempt = 0; attempt < 180 && status !== "READY" && status !== "FAILED"; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          const statusResponse = await fetch(`${apiUrl}/api/builds/${build.id}`, { credentials: "include" });
          const statusBody = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusBody.error ?? "Could not read the build status.");
          status = statusBody.status;
          if (status === "FAILED") throw new Error(statusBody.error ?? "Preview build failed.");
        }
        if (status !== "READY") throw new Error("Preview build did not finish within six minutes.");
      }
      if (!buildId) throw new Error("Preview build ID is missing.");

      const previewResponse = await fetch(`${apiUrl}/api/builds/${buildId}/previews${activePreviewExists ? "/link" : ""}`, {
        method: "POST",
        credentials: "include",
        headers: { ...csrfHeaders(), "content-type": "application/json" },
        body: "{}"
      });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error ?? "Preview deployment could not be created.");
      setPreviewLinks((current) => ({ ...current, [project.id]: preview }));
      setProjects((current) => current.map((item) => item.id === project.id ? {
        ...item,
        builds: [{ id: buildId, provider: latestBuild?.provider ?? "", status: "READY", mode: "PREVIEW", preview: { id: preview.id, status: "READY", expiresAt: preview.expiresAt } }]
      } : item));
      setMessage(`Preview ready for ${project.name}.`);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "Preview creation failed.");
    } finally {
      setPreviewingProjectId("");
    }
  }

  async function copyPreviewLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Preview link copied.");
    } catch {
      setPreviewError("Could not copy the preview link. Select and copy the URL above.");
    }
  }

  async function create() {
    if (!name.trim() || !archive) {
      setError("Choose a project name and a .zip source archive.");
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    const form = new FormData();
    form.set("name", name);
    form.set("archive", archive);
    if (redistributionCleared) form.set("redistributionStatus", "REDISTRIBUTION_CLEARED");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/projects`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: form
      });
      if (response.ok) {
        const data = await response.json();
        setProjects((current) => [...current, { ...data.project, engine: data.compatibility.engine }]);
        const preflight = data.compatibility.preflight as UploadPreflight | undefined;
        setMessage(preflight
          ? `Godot preflight: ${preflight.status}. ${[...preflight.errors, ...preflight.warnings].join(" ")}`
          : "Source uploaded and stored.");
        setName("");
        setArchive(null);
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Upload failed. Check the archive and try again.");
      }
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/auth/me`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          router.push("/auth");
          throw new Error("unauthorized");
        }
        return response;
      })
      .then(() => fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/projects`, { credentials: "include" }))
      .then((response) => response.json())
      .then((data) => setProjects(data.map((project: Project) => ({
        ...project,
        engine: project.builds?.[0]?.provider === "emscripten-sdl" ? "C/C++ + SDL" : project.builds?.[0]?.provider === "godot" ? "Godot" : "Awaiting build"
      }))))
      .catch(() => undefined);
  }, [router]);

  return (
    <main id="main-content" className="dashboard">
      <nav><strong>GAME2WEB<span>.</span></strong><a href="/">← Back to home</a></nav>
      <section className="dash-header">
        <div><p className="eyebrow">WORKSPACE</p><h1>Your games</h1><p className="muted">Upload a source archive, then run a real provider build.</p></div>
        <div className="create">
          <label htmlFor="project-name">Project name</label>
          <input id="project-name" name="name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name…" />
          <label htmlFor="source-archive">Source archive</label>
          <input id="source-archive" name="archive" aria-describedby="upload-status" type="file" accept=".zip,application/zip" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} />
          <label className="license-attestation"><input type="checkbox" checked={redistributionCleared} onChange={(event) => setRedistributionCleared(event.target.checked)} /> I have verified the rights required to publish this game and its assets.</label>
          <button className="button" onClick={create} disabled={uploading}>{uploading ? "Uploading…" : "Upload game"}</button>
        </div>
      </section>
      <p id="upload-status" aria-live="polite" role={error ? "alert" : undefined} className="muted">{error || message || (uploading ? "Uploading…" : "")}</p>
      {previewError && <p className="muted" role="alert">{previewError}</p>}
      <section className="project-list">
        {projects.length ? projects.map((project) => (
          <article className="project-card" key={project.id}>
            <div className="project-card-details">
              <span><span className="status-dot" aria-hidden="true" />{project.name}</span>
              <p>{project.engine}</p>
              <button className="button small" type="button" onClick={() => void createPreview(project)} disabled={previewingProjectId === project.id}>
                {previewingProjectId === project.id ? "Building preview…" : hasActivePreview(project) ? "Open existing preview link" : "Create preview"}
              </button>
              {previewLinks[project.id] && (
                <div className="preview-ready" aria-live="polite">
                  <strong>Your preview is ready</strong>
                  <p>Technical status: {previewLinks[project.id].technicalStatus}. Redistribution: {previewLinks[project.id].redistributionStatus.replaceAll("_", " ").toLowerCase()}.</p>
                  <p>Expires: {new Date(previewLinks[project.id].expiresAt).toLocaleString()}</p>
                  <a className="preview-url" href={previewLinks[project.id].url} target="_blank" rel="noreferrer">{previewLinks[project.id].url}</a>
                  <div className="preview-actions">
                    <a className="button small" href={previewLinks[project.id].url} target="_blank" rel="noreferrer">Open preview</a>
                    <button className="button small" type="button" onClick={() => void copyPreviewLink(previewLinks[project.id].url)}>Copy link</button>
                  </div>
                  <p>{previewLinks[project.id].persistent ? "Configured for durable storage and HTTPS origins; availability still depends on the deployed preview and player services." : "Temporary preview; it may not remain available after the local service or CI run ends."}</p>
                </div>
              )}
            </div>
            <span className="tag">PRIVATE SOURCE</span>
          </article>
        )) : <div className="empty"><h2>No games yet.</h2><p>Start with a compatible Godot or C/C++ project. A project is not marked ready until a real worker build completes.</p></div>}
      </section>
    </main>
  );
}

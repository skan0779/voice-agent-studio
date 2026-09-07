import { Database, FileJson2, FileText, FileUp, Plus, Search, Trash2, Type, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import type { DataAsset } from "../../domain/workspaces";
import type { StateSchema } from "../../domain/state";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/cn";

const MAX_FILE_SIZE = 2 * 1024 * 1024;

function slugify(value: string) {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `data-${Date.now().toString(36)}`
  );
}

function detectFormat(fileName: string): DataAsset["format"] | null {
  const extension = fileName.split(".").pop()?.toLocaleLowerCase();
  if (extension === "json") return "JSON";
  return null;
}

function isValidJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes?: number) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DataScreen({
  assets,
  stateSchemas,
  onCreate,
  onDelete,
}: {
  assets: DataAsset[];
  stateSchemas: StateSchema[];
  onCreate: (asset: Omit<DataAsset, "updatedAt">) => void;
  onDelete: (assetId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<DataAsset["sourceType"]>("file");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [fileSize, setFileSize] = useState<number | undefined>();
  const [fileError, setFileError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? assets.filter((asset) =>
          `${asset.name} ${asset.description} ${asset.format} ${asset.fileName ?? ""}`
            .toLocaleLowerCase()
            .includes(normalized),
        )
      : assets;
  }, [assets, query]);

  const resetEditor = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setSourceType("file");
    setContent("");
    setFileName(undefined);
    setFileSize(undefined);
    setFileError(null);
  };
  const openCreate = () => {
    resetEditor();
    setEditorOpen(true);
  };
  const openEdit = (asset: DataAsset) => {
    setEditingId(asset.id);
    setName(asset.name);
    setDescription(asset.description);
    setSourceType(asset.sourceType);
    setContent(asset.content);
    setFileName(asset.fileName);
    setFileSize(asset.fileSize);
    setFileError(null);
    setEditorOpen(true);
  };

  const readFile = async (file: File) => {
    const detected = detectFormat(file.name);
    if (!detected) {
      setFileError("Only JSON files are supported in this prototype.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("Files must be 2 MB or smaller in this prototype.");
      return;
    }
    try {
      const nextContent = await file.text();
      JSON.parse(nextContent);
      setContent(nextContent);
      setFileName(file.name);
      setFileSize(file.size);
      setFileError(null);
    } catch {
      setFileError("This file does not contain valid JSON.");
    }
  };

  const changeSourceType = (next: DataAsset["sourceType"]) => {
    setSourceType(next);
    setContent("");
    setFileName(undefined);
    setFileSize(undefined);
    setFileError(null);
  };

  const submit = () => {
    const hasContent = sourceType === "text" ? Boolean(content.trim()) : Boolean(fileName && (content || editingId));
    if (!name.trim() || !hasContent || fileError) return;
    if (!isValidJson(content)) {
      setFileError(
        sourceType === "file" ? "This file does not contain valid JSON." : "The text does not contain valid JSON.",
      );
      return;
    }
    const baseId = slugify(name);
    const id =
      editingId ?? (assets.some((asset) => asset.id === baseId) ? `${baseId}-${Date.now().toString(36)}` : baseId);
    const contentVersion = editingId ? assets.find((asset) => asset.id === editingId)?.contentVersion : undefined;
    onCreate({
      id,
      name: name.trim(),
      description: description.trim(),
      sourceType,
      format: "JSON",
      content,
      fileName: sourceType === "file" ? fileName : undefined,
      fileSize: sourceType === "file" ? fileSize : undefined,
      contentVersion,
    });
    setEditorOpen(false);
  };

  const stateBindingConflict = Boolean(
    name.trim() && stateSchemas.some((schema) => schema.key === name.trim().toLocaleLowerCase()),
  );
  const canSubmit = Boolean(
    name.trim() && !stateBindingConflict && !fileError && content.trim() && (sourceType === "text" || fileName),
  );
  const pendingDelete = assets.find((asset) => asset.id === pendingDeleteId) ?? null;
  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1280px]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Data</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Manage files and text content that agents can use.
            </p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Data
          </Button>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="relative w-80 max-sm:w-full">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search data"
              placeholder="Search name, description, or format"
              className="border-0 bg-[var(--surface-subtle)] pl-9 text-xs"
            />
          </div>
          <Badge>{filtered.length} assets</Badge>
        </div>

        {assets.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
            <Database className="mx-auto h-7 w-7 text-[var(--text-muted)]" />
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No data yet</h3>
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              Upload a file or add text content for your agents.
            </p>
          </div>
        ) : (
          <section
            className="mt-4 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs"
            aria-label="Data assets"
          >
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-3 py-3">Format</th>
                  <th className="px-3 py-3">Content</th>
                  <th className="px-3 py-3">Updated</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((asset) => (
                  <tr
                    key={asset.id}
                    tabIndex={0}
                    aria-label={`Edit ${asset.name}`}
                    onClick={() => openEdit(asset)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      openEdit(asset);
                    }}
                    className="cursor-pointer outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--blue-soft)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-subtle)]">
                          {asset.format === "JSON" ? (
                            <FileJson2 className="h-4 w-4 text-[var(--blue)]" />
                          ) : (
                            <FileText className="h-4 w-4 text-[var(--text-secondary)]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-72 truncate text-xs font-bold text-[var(--text)]">{asset.name}</p>
                          <p className="mt-0.5 max-w-80 truncate text-[9px] text-[var(--text-muted)]">
                            {asset.description || "No description"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge tone="blue">{asset.format}</Badge>
                    </td>
                    <td className="px-3 py-3.5">
                      <p className="max-w-48 truncate text-[10px] font-semibold text-[var(--text-secondary)]">
                        {asset.sourceType === "file" ? (asset.fileName ?? "Uploaded file") : "Text input"}
                      </p>
                      <p className="mt-0.5 text-[9px] text-[var(--text-muted)]">
                        {asset.sourceType === "file"
                          ? (formatBytes(asset.fileSize) ?? "File")
                          : `${asset.content.length.toLocaleString()} characters`}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-[10px] text-[var(--text-muted)]">
                      {new Date(asset.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-3">
                      <div className="flex items-center justify-end">
                        <Tooltip content="Delete data">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteId(asset.id);
                            }}
                            aria-label={`Delete ${asset.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={editingId ? "Edit Data" : "Add Data"}
        description="Add reusable content to this workspace."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {editingId ? "Save" : "Add Data"}
            </Button>
          </>
        }
      >
        <div className="max-h-[62vh] space-y-5 overflow-y-auto pr-1">
          <Field
            label="Name"
            htmlFor="data-name"
            hint={stateBindingConflict ? "This name conflicts with an existing State Key." : undefined}
          >
            <Input
              id="data-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Call safety policy"
              autoFocus
            />
          </Field>
          <Field label="Description" htmlFor="data-description">
            <Textarea
              id="data-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe when and how agents should use this data."
              className="min-h-20"
            />
          </Field>
          <div>
            <p className="mb-2 text-xs font-semibold text-[var(--text)]">Content</p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-subtle)] p-1">
              <button
                type="button"
                onClick={() => sourceType !== "file" && changeSourceType("file")}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  sourceType === "file"
                    ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                <FileUp className="h-3.5 w-3.5" /> File Upload
              </button>
              <button
                type="button"
                onClick={() => sourceType !== "text" && changeSourceType("text")}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  sourceType === "text"
                    ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                <Type className="h-3.5 w-3.5" /> Text Input
              </button>
            </div>
          </div>

          {sourceType === "file" ? (
            <div>
              <label
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-5 py-8 text-center transition-colors hover:bg-[var(--surface-hover)]",
                  fileError
                    ? "border-[var(--red)] bg-[var(--red-soft)]"
                    : fileName
                      ? "border-[var(--blue-border)] bg-[var(--blue-soft)]"
                      : "border-[var(--border-strong)]",
                )}
              >
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                  }}
                />
                <UploadCloud className={cn("h-6 w-6", fileName ? "text-[var(--blue)]" : "text-[var(--text-muted)]")} />
                <p className="mt-3 text-xs font-bold text-[var(--text)]">
                  {fileName ?? "Drop a file here or click to browse"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {fileName ? `JSON · ${formatBytes(fileSize) ?? "Bundled file"}` : "JSON · up to 2 MB"}
                </p>
              </label>
              {fileError && <p className="mt-2 text-[10px] font-semibold text-[var(--red)]">{fileError}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Format" htmlFor="data-format">
                <Input
                  id="data-format"
                  value="JSON"
                  readOnly
                  aria-readonly="true"
                  className="bg-[var(--surface-subtle)] font-semibold text-[var(--text-secondary)]"
                />
              </Field>
              <Field label="JSON Content" htmlFor="data-content">
                <Textarea
                  id="data-content"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setFileError(null);
                  }}
                  placeholder={'{\n  "key": "value"\n}'}
                  className="min-h-44 font-mono text-xs"
                />
                {fileError && <p className="mt-2 text-[10px] font-semibold text-[var(--red)]">{fileError}</p>}
              </Field>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete this data?"
        description={
          pendingDelete ? `“${pendingDelete.name}” will be permanently removed from this workspace.` : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDeleteId(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete Data
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          This action cannot be undone. Any agent references to this data may stop working.
        </div>
      </Dialog>
    </main>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import {
  Upload,
  Trash2,
  Copy,
  Check,
  Download,
  ImageIcon,
  FileIcon,
  HardDrive,
  X,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface StoredFile {
  name: string;
  path: string;
  url: string;
  size: number;
  type: string;
  createdAt: string;
}

interface Props {
  token: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function isImageType(type: string) {
  return type.startsWith("image/");
}

export function StoragePanel({ token }: Props) {
  const { addToast } = useToast();
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoredFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/storage", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { files: StoredFile[] };
        setFiles(data.files ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const uploadFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      setUploading(true);
      let uploaded = 0;
      for (const file of fileList) {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/storage", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          if (res.ok) {
            const f = (await res.json()) as StoredFile;
            setFiles((prev) => [f, ...prev]);
            uploaded++;
          } else {
            const err = (await res.json()) as { error?: string };
            addToast({ title: `Upload failed: ${err.error ?? "Unknown error"}`, variant: "error" });
          }
        } catch {
          addToast({ title: "Upload failed", variant: "error" });
        }
      }
      setUploading(false);
      if (uploaded > 0) {
        addToast({ title: `${uploaded} file${uploaded > 1 ? "s" : ""} uploaded`, variant: "success" });
      }
    },
    [token, addToast],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = Array.from(e.target.files ?? []);
      void uploadFiles(fileList);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFiles],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const fileList = Array.from(e.dataTransfer.files);
      void uploadFiles(fileList);
    },
    [uploadFiles],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageFiles = items
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length > 0) void uploadFiles(imageFiles);
    },
    [uploadFiles],
  );

  const handleDelete = useCallback(
    async (file: StoredFile) => {
      setDeleting(file.path);
      try {
        const res = await fetch("/api/storage", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: file.path }),
        });
        if (res.ok) {
          setFiles((prev) => prev.filter((f) => f.path !== file.path));
          if (preview?.path === file.path) setPreview(null);
          addToast({ title: "File deleted", variant: "success" });
        } else {
          addToast({ title: "Delete failed", variant: "error" });
        }
      } catch {
        addToast({ title: "Delete failed", variant: "error" });
      } finally {
        setDeleting(null);
      }
    },
    [token, preview, addToast],
  );

  const handleCopyUrl = useCallback(
    async (url: string) => {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    },
    [],
  );

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div
      className="flex flex-col gap-6"
      onPaste={handlePaste}
    >
      {/* Header stats */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <HardDrive className="h-4 w-4" />
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
        <span>{formatBytes(totalSize)} used</span>
        <span className="ml-auto text-xs text-muted-foreground/60">Max 50 MB per file · Paste images anywhere on this page</span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all",
          dragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
        )}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={handleFileInput}
        />
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Uploading…</p>
          </>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-indigo-500/20">
              <Upload className="h-6 w-6 text-indigo-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {dragOver ? "Drop to upload" : "Drop files, paste images, or click to browse"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Any file type up to 50 MB</p>
            </div>
          </>
        )}
      </div>

      {/* Files grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No files yet. Upload something above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {files.map((file) => (
            <FileCard
              key={file.path}
              file={file}
              copiedUrl={copiedUrl}
              deleting={deleting}
              onCopyUrl={handleCopyUrl}
              onDelete={handleDelete}
              onPreview={setPreview}
            />
          ))}
        </div>
      )}

      {/* Image preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="max-w-xs truncate text-sm font-medium">{preview.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatBytes(preview.size)}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPreview(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {isImageType(preview.type) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={preview.name}
                className="max-h-[80vh] max-w-[85vw] object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 p-12">
                <FileIcon className="h-16 w-16 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{preview.name}</p>
                <a href={preview.url} download={preview.name} target="_blank" rel="noopener noreferrer">
                  <Button size="sm">
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FileCard({
  file,
  copiedUrl,
  deleting,
  onCopyUrl,
  onDelete,
  onPreview,
}: {
  file: StoredFile;
  copiedUrl: string | null;
  deleting: string | null;
  onCopyUrl: (url: string) => Promise<void>;
  onDelete: (file: StoredFile) => Promise<void>;
  onPreview: (file: StoredFile) => void;
}) {
  const isImage = isImageType(file.type);
  const isCopied = copiedUrl === file.url;
  const isDeleting = deleting === file.path;

  const displayName = file.name.replace(/^\d+-/, "").slice(0, 40);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-md">
      {/* Thumbnail */}
      <button
        type="button"
        className="relative aspect-square w-full overflow-hidden bg-muted/50"
        onClick={() => onPreview(file)}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.url}
            alt={displayName}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileIcon className="h-10 w-10 text-muted-foreground/40" />
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/20">
          <ImageIcon className="h-6 w-6 text-white opacity-0 transition-opacity group-hover:opacity-80" />
        </div>
      </button>

      {/* Info */}
      <div className="px-2 py-1.5">
        <p className="truncate text-[11px] font-medium leading-tight" title={displayName}>
          {displayName}
        </p>
        <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 border-t border-border px-1.5 py-1">
        <button
          type="button"
          title="Copy URL"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => void onCopyUrl(file.url)}
        >
          {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <a
          href={file.url}
          download={file.name}
          target="_blank"
          rel="noopener noreferrer"
          title="Download"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          title="Delete"
          disabled={isDeleting}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          onClick={() => void onDelete(file)}
        >
          {isDeleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

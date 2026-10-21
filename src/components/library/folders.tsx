"use client";

import { Check, ChevronLeft, Folder as FolderIcon, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFolderActions } from "@/lib/api";
import { DEFAULT_FOLDER_COLOR, FOLDER_COLORS, folderSwatch, type Folder } from "@/lib/library";
import { cn } from "@/lib/utils";
import { MediaThumb } from "@/components/studio/result-media";

/** Generation ids dragged from a card (the selection when the card is selected). */
export const DRAG_TYPE = "application/x-fuobe-generations";

export function readDrag(e: React.DragEvent): string[] | null {
  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return null;
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
  } catch {
    return null;
  }
}

/** A drop target for dragged cards (folders, the "Library" crumb). */
export function useDropTarget(onDrop: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const ids = readDrag(e);
        if (!ids?.length) return;
        e.preventDefault();
        onDrop(ids);
      },
    },
  };
}

export function FolderDialog({ folder, open, onOpenChange, onSaved }: { folder?: Folder; open: boolean; onOpenChange: (v: boolean) => void; onSaved?: (f: Folder) => void }) {
  const actions = useFolderActions();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(folder?.color ?? DEFAULT_FOLDER_COLOR);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      const f = folder ? await actions.update(folder.id, { name, color }) : await actions.create({ name, color });
      onOpenChange(false);
      onSaved?.(f);
      if (!folder) toast.success(`Created “${f.name}”`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,400px)] gap-4"
        // Straight into the name field, also when opened from a menu that was still handing focus back.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
      >
        <DialogTitle className="font-heading text-[22px] font-normal">{folder ? "Edit folder" : "New folder"}</DialogTitle>
        <DialogDescription className="sr-only">Name and colour</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <input
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. “Spring campaign”"
            aria-label="Folder name"
            className="h-10 w-full rounded-lg border bg-background px-3 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-brand-faint"
          />
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => setColor(c.id)}
                className={cn("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition", color === c.id && "ring-2 ring-foreground")}
                style={{ background: folderSwatch(c.id) }}
              >
                {color === c.id && <Check className="size-4 text-black/70" />}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50">
              {folder ? "Save" : "Create folder"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FolderCard({ folder, onOpen, onDropIds }: { folder: Folder; onOpen: () => void; onDropIds: (ids: string[]) => void }) {
  const drop = useDropTarget(onDropIds);
  return (
    <button
      onClick={onOpen}
      {...drop.props}
      className={cn(
        "group flex w-[min(44vw,190px)] shrink-0 items-center gap-2.5 rounded-xl border bg-background p-2 text-left transition-[background-color,box-shadow,border-color] hover:bg-accent",
        drop.over && "border-primary shadow-heavy ring-4 ring-brand-faint",
      )}
    >
      <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: folderSwatch(folder.color) }}>
        {folder.cover ? <MediaThumb output={folder.cover} className="pointer-events-none" /> : <FolderIcon className="size-5 text-black/60" />}
        {folder.cover && <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: folderSwatch(folder.color) }} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{folder.name}</span>
        <span className="block text-[12px] text-muted-foreground">{drop.over ? "Drop to move here" : `${folder.count} item${folder.count === 1 ? "" : "s"}`}</span>
      </span>
    </button>
  );
}

export function FolderStrip({ folders, onOpen, onMove }: { folders: Folder[]; onOpen: (f: Folder) => void; onMove: (ids: string[], f: Folder) => void }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {folders.map((f) => (
        <FolderCard key={f.id} folder={f} onOpen={() => onOpen(f)} onDropIds={(ids) => onMove(ids, f)} />
      ))}
      <button
        onClick={() => setCreating(true)}
        className="flex w-[min(44vw,160px)] shrink-0 items-center gap-2.5 rounded-xl border border-dashed p-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
          <FolderPlus className="size-5" />
        </span>
        <span className="text-[13px] font-medium">New folder</span>
      </button>
      {creating && <FolderDialog open onOpenChange={setCreating} />}
    </div>
  );
}

/** Folder view header: back to the Library (also a drop target to take items out), rename, colour, delete. */
export function FolderHeader({ folder, onBack, onMoveOut }: { folder: Folder; onBack: () => void; onMoveOut: (ids: string[]) => void }) {
  const actions = useFolderActions();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const drop = useDropTarget(onMoveOut);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        onClick={onBack}
        {...drop.props}
        className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full pr-3 pl-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", drop.over && "bg-brand-faint text-brand-text ring-4 ring-brand-faint")}
      >
        <ChevronLeft className="size-4" /> {drop.over ? "Drop to take out" : "Library"}
      </button>
      <span className="size-3 shrink-0 rounded-full" style={{ background: folderSwatch(folder.color) }} />
      <h2 className="min-w-0 truncate font-heading text-[24px] leading-none">{folder.name}</h2>
      <span className="shrink-0 text-[13px] text-muted-foreground">{folder.count}</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Folder actions">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* Open dialogs once the menu has closed and handed focus back, so the dialog keeps it. */}
          <DropdownMenuItem onSelect={() => setTimeout(() => setEditing(true), 0)}>
            <Pencil /> Rename or recolour
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(() => setDeleting(true), 0)}>
            <Trash2 /> Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && <FolderDialog folder={folder} open onOpenChange={setEditing} />}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{folder.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The folder goes away; the {folder.count} item{folder.count === 1 ? "" : "s"} in it stay in your Library.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await actions.remove(folder.id);
                toast("Folder deleted");
                onBack();
              }}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** "Move to folder" choices for the bulk bar and card menus. */
export function MoveMenuItems({ folders, current, onMove, onNew }: { folders: Folder[]; current?: string; onMove: (folderId: string | null, name: string) => void; onNew: () => void }) {
  return (
    <>
      {folders.map((f) => (
        <DropdownMenuItem key={f.id} disabled={f.id === current} onSelect={() => onMove(f.id, f.name)}>
          <span className="size-3 rounded-full" style={{ background: folderSwatch(f.color) }} /> {f.name}
        </DropdownMenuItem>
      ))}
      {current && (
        <DropdownMenuItem onSelect={() => onMove(null, "Library")}>
          <ChevronLeft /> Take out of the folder
        </DropdownMenuItem>
      )}
      {folders.length > 0 && <DropdownMenuSeparator />}
      {/* After the menu has closed and handed focus back, so the dialog keeps it. */}
      <DropdownMenuItem onSelect={() => setTimeout(onNew, 0)}>
        <FolderPlus /> New folder…
      </DropdownMenuItem>
    </>
  );
}

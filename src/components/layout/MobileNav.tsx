"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Toc } from "@/lib/types";
import { OPEN_MENU_EVENT } from "./Header";
import { SidebarToc, type NewTocEntry } from "./SidebarToc";

interface MobileNavProps {
  toc: Toc;
  amended?: string[];
  newEntries?: Record<string, NewTocEntry[]>;
}

/** Off-canvas TOC drawer for small screens, opened from the header button. */
export function MobileNav({ toc, amended, newEntries }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] overflow-y-auto bg-background p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="font-semibold">Inhoudsopgave</Dialog.Title>
            <Dialog.Close
              aria-label="Sluiten"
              className="flex size-8 items-center justify-center rounded-md text-muted hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <SidebarToc
            toc={toc}
            amended={amended}
            newEntries={newEntries}
            onNavigate={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

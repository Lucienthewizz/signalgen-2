import { useRef, type ReactNode, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared centered disclosure, using the same focus and surface as confirmations. */
export function InfoDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  returnFocus,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
  actions?: ReactNode;
  returnFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="signalgen-confirm__backdrop" />
        <Dialog.Viewport className="signalgen-confirm__viewport">
          <Dialog.Popup
            className="signalgen-confirm signalgen-info"
            data-wide={wide || undefined}
            initialFocus={closeRef}
            finalFocus={() => returnFocus?.current ?? true}
          >
            <Dialog.Close
              render={
                <Button
                  ref={closeRef}
                  variant="ghost"
                  size="icon"
                  className="signalgen-info__close"
                  aria-label="Close dialog"
                />
              }
            >
              <X />
            </Dialog.Close>
            <Dialog.Title className="signalgen-confirm__title">
              {title}
            </Dialog.Title>
            <Dialog.Description className="signalgen-confirm__description">
              {description}
            </Dialog.Description>
            {children}
            <div className="signalgen-confirm__actions">
              <Dialog.Close render={<Button variant="outline" />}>
                Close
              </Dialog.Close>
              {actions}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

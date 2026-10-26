import { useRef, type RefObject } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { ListChecks, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  returnFocus,
  onCancel,
  onConfirm,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const Icon = destructive ? Trash2 : ListChecks;
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="signalgen-confirm__backdrop" />
        <AlertDialog.Viewport className="signalgen-confirm__viewport">
          <AlertDialog.Popup
            className="signalgen-confirm"
            initialFocus={cancelRef}
            finalFocus={returnFocus}
          >
            <span
              className="signalgen-confirm__icon"
              data-destructive={destructive || undefined}
              aria-hidden="true"
            >
              <Icon />
            </span>
            <AlertDialog.Title className="signalgen-confirm__title">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="signalgen-confirm__description">
              {description}
            </AlertDialog.Description>
            <div className="signalgen-confirm__actions">
              <AlertDialog.Close
                render={
                  <Button
                    ref={cancelRef}
                    variant="outline"
                    className="ui-button"
                  />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant={destructive ? "destructive" : "default"}
                className={
                  destructive ? "ui-button" : "ui-button ui-button--primary"
                }
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

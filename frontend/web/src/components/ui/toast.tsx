import { useEffect, useRef, type ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { CircleCheck, CircleAlert, X } from "lucide-react";

// Shared Base UI manager: notifications survive route changes, not page reloads.
export const toast = Toast.createToastManager();

export function useActionNotifications(
  success: string | null,
  error: string | null,
) {
  const previous = useRef({
    success: null as string | null,
    error: null as string | null,
  });
  useEffect(() => {
    if (error && error !== previous.current.error) {
      toast.add({
        type: "error",
        title: "Tindakan belum berhasil",
        description: error,
        priority: "high",
        timeout: 8000,
      });
    } else if (success && success !== previous.current.success) {
      toast.add({
        type: "success",
        title: "Berhasil",
        description: success,
        timeout: 5000,
      });
    }
    previous.current = { success, error };
  }, [success, error]);
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => (
    <Toast.Root
      key={item.id}
      toast={item}
      className="notification-toast"
      data-slot="toast"
    >
      <Toast.Content className="notification-toast__content">
        {item.type === "error" ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <CircleCheck aria-hidden="true" />
        )}
        <div className="notification-toast__copy">
          <Toast.Title className="notification-toast__title" />
          <Toast.Description className="notification-toast__description" />
        </div>
        <Toast.Close
          className="notification-toast__close"
          aria-label="Tutup notifikasi"
        >
          <X aria-hidden="true" />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}

export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toast} limit={3}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          className="notification-viewport"
          aria-label="Notifikasi"
        >
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

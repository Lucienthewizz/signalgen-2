// Loads Midtrans Snap once and wraps its popup in a promise. The popup result
// is only a hint for the UI; access changes only after the backend confirms
// the payment with Midtrans.
type SnapCallbacks = {
  onSuccess: () => void;
  onPending: () => void;
  onError: () => void;
  onClose: () => void;
};
type Snap = { pay: (token: string, callbacks: SnapCallbacks) => void };
declare global {
  interface Window {
    snap?: Snap;
  }
}

export type SnapOutcome = "success" | "pending" | "error" | "closed";

const clientKey = (import.meta.env.VITE_MIDTRANS_CLIENT_KEY ?? "").trim();

export const midtransConfigured = clientKey !== "";

let loading: Promise<Snap> | null = null;

function loadSnap(): Promise<Snap> {
  if (window.snap) return Promise.resolve(window.snap);
  if (!clientKey) return Promise.reject(Error("Online payment is not set up."));
  loading ??= new Promise<Snap>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = clientKey.startsWith("SB-")
      ? "https://app.sandbox.midtrans.com/snap/snap.js"
      : "https://app.midtrans.com/snap/snap.js";
    script.dataset.clientKey = clientKey;
    script.async = true;
    script.onload = () =>
      window.snap
        ? resolve(window.snap)
        : reject(Error("The payment window could not load."));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(
        Error("The payment window could not load. Check your connection."),
      );
    };
    document.head.append(script);
  });
  return loading;
}

export async function payWithSnap(token: string): Promise<SnapOutcome> {
  const snap = await loadSnap();
  return new Promise((resolve) =>
    snap.pay(token, {
      onSuccess: () => resolve("success"),
      onPending: () => resolve("pending"),
      onError: () => resolve("error"),
      onClose: () => resolve("closed"),
    }),
  );
}

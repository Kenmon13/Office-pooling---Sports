import { useEffect, useRef, useState } from "react";
import { setPushForegroundHandler, openFromPush } from "../push";

// Long enough to read a scoreline, short enough not to sit over the pick you are
// in the middle of making.
const DISMISS_MS = 6000;

// Shows a push that arrived while the app was already open. Android hands those
// straight to the app rather than posting them to the notification tray, so
// without this they are received and then silently dropped.
//
// Mounted beside App rather than inside it: App returns early for the auth,
// invite and loading screens, and a notice that vanishes on those transitions
// would be missed exactly when a reminder matters.
export default function PushToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setPushForegroundHandler((incoming) => {
      // A second push replaces the first rather than queueing — the newer one is
      // always the more relevant, and stacked notices cover the screen.
      clearTimeout(timerRef.current);
      setToast(incoming);
      timerRef.current = setTimeout(() => setToast(null), DISMISS_MS);
    });
    return () => {
      setPushForegroundHandler(null);
      clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  const dismiss = () => {
    clearTimeout(timerRef.current);
    setToast(null);
  };

  const open = () => {
    const { data } = toast;
    dismiss();
    openFromPush(data);
  };

  return (
    <div className="push-toast" role="status" aria-live="polite">
      <button type="button" className="push-toast-main" onClick={open}>
        {toast.title && <span className="push-toast-title">{toast.title}</span>}
        {toast.body && <span className="push-toast-body">{toast.body}</span>}
      </button>
      <button
        type="button"
        className="push-toast-close"
        onClick={dismiss}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}

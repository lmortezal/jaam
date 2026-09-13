import { useEffect, useRef, type ReactNode } from "react";
import {
  Box,
  Boxes,
  Building2,
  Database,
  FlaskConical,
  Globe2,
  Network,
  Server,
  X,
} from "lucide-react";
export function Icon({
  name,
  size = 18,
  ...props
}: {
  name?: string;
  size?: number;
  className?: string;
}) {
  const I =
    (
      {
        server: Server,
        globe: Globe2,
        network: Network,
        boxes: Boxes,
        database: Database,
        building: Building2,
        flask: FlaskConical,
        box: Box,
      } as Record<string, typeof Box>
    )[name || "box"] || Box;
  return <I size={size} {...props} />;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  icon = "box",
  title,
  children,
}: {
  icon?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

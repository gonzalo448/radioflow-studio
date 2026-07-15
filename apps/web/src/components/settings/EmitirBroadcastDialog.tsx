import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Redirige al hub unificado /emitir (ya no usa diálogo modal). */
export function EmitirBroadcastDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const openedRef = useRef(false);

  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      onClose();
      navigate("/emitir");
    }
    if (!open) openedRef.current = false;
  }, [open, onClose, navigate]);

  return null;
}

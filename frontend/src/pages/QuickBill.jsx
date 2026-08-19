import { useEffect, useRef } from "react";
import Billing from "@/pages/Billing";

/**
 * QuickBill route — reuses the Billing screen and auto-opens the Quick Bill modal.
 * We do this by simulating a click on the header "Quick Bill" button once the page mounts.
 */
export default function QuickBillPage() {
  const ref = useRef(false);
  useEffect(() => {
    if (ref.current) return;
    ref.current = true;
    const t = setTimeout(() => {
      const btn = document.querySelector('[data-testid="open-quick-bill"]');
      if (btn) btn.click();
    }, 250);
    return () => clearTimeout(t);
  }, []);
  return <Billing />;
}

// /driver/orders/:orderId/pod — POD form: receiver's name, photo, note → delivered.
// Phase 0 placeholder. Owner: see the file ownership table.
import { PageHeader } from "../../shell/AppShell";

export default function PodPage() {
  return (
    <>
      <PageHeader title="Proof of delivery" />
      <div className="placeholder">POD form: receiver's name, photo, note → delivered.</div>
    </>
  );
}

// /driver/orders/:orderId/pod — Proof of delivery: receiver's name, a photo
// and an optional note. Submitting records the POD and marks the order
// delivered, then goes back to the run.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { ApiError, errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { QueryState } from "../../shell/QueryState";
import { STATUS_LABEL } from "../../shell/format";
import { useDriverOrder, type DriverOrder } from "../util";

/** The server's limit (MAX_UPLOAD_BYTES); checked here first to save a slow upload. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const sizeMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function PodPage() {
  const orderId = Number(useParams().orderId);
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back ?? "/driver/run";
  const query = useDriverOrder(orderId);
  return (
    <>
      <p className="breadcrumb"><Link className="back-link" to={`/driver/orders/${orderId}`} state={{ date: back.split("date=")[1] }}>← Stop</Link></p>
      <QueryState query={query} loadingLabel="Loading the order…">
        {(o) => <PodForm order={o} back={back} />}
      </QueryState>
    </>
  );
}

function photoProblem(file: File | null): string | null {
  if (!file) return null;
  if (file.type && !PHOTO_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP photo.";
  if (file.size > MAX_PHOTO_BYTES) return `The photo is ${sizeMb(file.size)}; the limit is 5 MB. Take it again at a lower resolution.`;
  return null;
}

/** A readable message for the upload errors the API documents. */
function submitError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return `The photo is too large. ${e.message}`.trim();
    if (e.status === 415) return `That photo format isn't accepted. ${e.message}`.trim();
    if (e.status === 409) return `The delivery can't be recorded now: ${e.message}`;
  }
  return errorMessage(e);
}

function PodForm({ order, back }: { order: DriverOrder; back: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [signedBy, setSignedBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // object URL for the preview: replaced (and the old one revoked) when the
  // photo changes, revoked when the page closes
  const previewRef = useRef<string | null>(null);
  const choosePhoto = (file: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = file ? URL.createObjectURL(file) : null;
    setPhoto(file);
    setPreview(previewRef.current);
  };
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const submit = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/driver/orders/{order_id}/pod", {
        params: { path: { order_id: order.order_id } },
        // the file goes in the FormData below; the typed body is only for the schema
        body: { signed_by: signedBy.trim(), photo: "", note: note.trim() || null },
        bodySerializer: () => {
          const fd = new FormData();
          fd.append("signed_by", signedBy.trim());
          fd.append("photo", photo!);
          if (note.trim()) fd.append("note", note.trim());
          return fd;
        },
      })),
    onSuccess: (o) => {
      qc.setQueryData(["driver", "order", o.order_id], o);
      void qc.invalidateQueries({ queryKey: ["driver"] });
      navigate(back, { state: { message: `✓ ${o.reference} delivered. Received by ${signedBy.trim()}.` } });
    },
  });

  if (!order.next_statuses.includes("delivered")) {
    return (
      <>
        <PageHeader title="Proof of delivery" subtitle={order.reference} />
        <p className="notice">
          {order.status === "delivered"
            ? `${order.reference} is already delivered.`
            : `${order.reference} is ${STATUS_LABEL[order.status].toLowerCase()}: mark it “In transit” before recording the delivery.`}
        </p>
        <Link className="tap-button secondary" to={`/driver/orders/${order.order_id}`}>Back to the stop</Link>
      </>
    );
  }

  const problem = photoProblem(photo);
  const nameMissing = !signedBy.trim();
  const photoMissing = !photo;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameMissing || photoMissing || problem) return;
    submit.mutate();
  };

  return (
    <>
      <PageHeader title="Proof of delivery" subtitle={`${order.reference} · ${order.delivery_address.label}`} />
      <form className="card pod-form" onSubmit={onSubmit} noValidate>
        <label className="field" htmlFor="pod-name">
          <span>Receiver's name</span>
          <input
            id="pod-name"
            autoComplete="off"
            autoCapitalize="words"
            maxLength={200}
            required
            value={signedBy}
            aria-invalid={touched && nameMissing ? true : undefined}
            aria-describedby={touched && nameMissing ? "pod-name-err" : undefined}
            onChange={(e) => setSignedBy(e.target.value)}
          />
        </label>
        {touched && nameMissing ? <p id="pod-name-err" className="field-error">Enter the name of the person who received the goods.</p> : null}

        <div className="field">
          <span id="pod-photo-label">Photo of the delivered goods</span>
          <input
            id="pod-photo"
            className="photo-input"
            type="file"
            accept="image/*"
            capture="environment"
            aria-labelledby="pod-photo-label"
            aria-invalid={(touched && photoMissing) || problem ? true : undefined}
            aria-describedby="pod-photo-help"
            onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
          />
          {/* the real input is visually hidden; this big label opens the camera */}
          <label className="tap-button secondary photo-pick" htmlFor="pod-photo" aria-hidden="true">
            📷 {photo ? "Take another photo" : "Take a photo"}
          </label>
          <p id="pod-photo-help" className="small muted">JPEG, PNG or WebP, up to 5 MB.</p>
        </div>
        <div role="status" aria-live="polite">
          {photo ? <p className="small">Selected: {photo.name || "photo"} ({sizeMb(photo.size)})</p> : null}
        </div>
        {preview ? <img className="pod-preview" src={preview} alt="Preview of the delivery photo" /> : null}
        {problem ? <p className="field-error" role="alert">{problem}</p> : null}
        {touched && photoMissing ? <p className="field-error">Take a photo of the delivered goods.</p> : null}

        <label className="field" htmlFor="pod-note">
          <span>Note <span className="hint">(optional)</span></span>
          <textarea id="pod-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <button type="submit" className="tap-button primary big" disabled={submit.isPending}>
          {submit.isPending ? "Uploading…" : "Record delivery"}
        </button>
        {submit.error ? <div className="error" role="alert">⚠️ {submitError(submit.error)}</div> : null}
      </form>
    </>
  );
}

// The demo's 2D bars / 3D trucks switch.
export type TruckView = "2d" | "3d";

export default function ViewToggle({ view, onChange }: { view: TruckView; onChange: (v: TruckView) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Truck view">
      {([["2d", "2D bars"], ["3d", "3D trucks"]] as const).map(([v, label]) => (
        <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

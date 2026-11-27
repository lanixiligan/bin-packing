// Warnings grouped by severity (errors, then warnings, then info), each with what is wrong, what
// to try next ("Try: ..."), and the freight lines it concerns, named by their labels.
import { useId } from "react";
import type { FreightItem, PlanRequest, PlanWarning, Severity } from "../api/types.ts";
import { AlertIcon, CheckIcon, CrossIcon, InfoIcon, type IconProps } from "./icons.tsx";
import "./WarningsList.css";

export interface WarningsListProps {
  warnings: PlanWarning[];
  /** To name the freight lines a warning concerns. */
  request: PlanRequest;
}

const GROUPS: {
  severity: Severity; title: string; one: string; many: string; label: string;
  Icon(props: IconProps): React.JSX.Element; badge: string;
}[] = [
  { severity: "error", title: "Errors", one: "error", many: "errors", label: "Error", Icon: CrossIcon, badge: "badge-error" },
  { severity: "warning", title: "Warnings", one: "warning", many: "warnings", label: "Warning", Icon: AlertIcon, badge: "badge-warning" },
  { severity: "info", title: "Information", one: "note", many: "notes", label: "Info", Icon: InfoIcon, badge: "badge-info" },
];

/** "Try: <suggestion>", unless the planner's suggestion already starts with "Try". */
function tryText(suggestion: string): string {
  return /^try\b/i.test(suggestion.trim()) ? suggestion : `Try: ${suggestion}`;
}

/** The labels of the freight lines a warning names, in the order they were entered. */
function lineNames(itemIds: string[], items: FreightItem[]): string[] {
  const order = new Map(items.map((it, i) => [it.id, i]));
  return [...new Set(itemIds)]
    .sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    .map((id) => items.find((it) => it.id === id)?.label?.trim() || id);
}

export default function WarningsList({ warnings, request }: WarningsListProps) {
  const headingId = useId();
  const groups = GROUPS.map((g) => ({ ...g, items: warnings.filter((w) => w.severity === g.severity) }))
    .filter((g) => g.items.length > 0);

  return (
    <section className="card warnings" aria-labelledby={headingId} data-testid="warnings">
      <div className="card-header">
        <h3 id={headingId} className="card-title">Warnings</h3>
        {groups.length > 0 && (
          <div className="row">
            {groups.map((g) => (
              <span key={g.severity} className={`badge ${g.badge}`}>
                <g.Icon size={12} />
                <span className="num">{g.items.length}</span> {g.items.length === 1 ? g.one : g.many}
              </span>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="warnings-empty">
          <CheckIcon size={20} />
          No warnings: the plan is within every limit we check.
        </p>
      ) : (
        <div className="warnings-groups">
          {groups.map((g) => (
            <section key={g.severity} className={`warnings-group warnings-group--${g.severity}`}
                     aria-labelledby={`${headingId}-${g.severity}`}>
              <h4 id={`${headingId}-${g.severity}`} className="warnings-group-title">
                {g.title} <span className="num muted">({g.items.length})</span>
              </h4>
              <ul className="warnings-items">
                {g.items.map((w, i) => {
                  const names = lineNames(w.item_ids, request.items);
                  return (
                    <li key={`${w.code}-${i}`} className={`warning warning--${w.severity}`} data-code={w.code}>
                      <span className="warning-icon"><g.Icon size={18} /></span>
                      <div className="warning-body">
                        <p className="warning-message">
                          <span className="visually-hidden">{g.label}: </span>{w.message}
                        </p>
                        {w.suggestion && <p className="warning-suggestion">{tryText(w.suggestion)}</p>}
                        {names.length > 0 && (
                          <p className="warning-lines">
                            {names.length === 1 ? "Freight line: " : "Freight lines: "}
                            {names.map((n, j) => (
                              <span key={j}>
                                {j > 0 && ", "}
                                <span className="warning-line">{n}</span>
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

// The page header: logo mark, title, subtitle and the Auto / Light / Dark theme toggle
// (useTheme.js).

const THEMES = [["system", "Auto"], ["light", "Light"], ["dark", "Dark"]];

export default function DemoHeader({ theme, onTheme }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 6h12v9H2zM14 9h4l3 3v3h-7z" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinejoin="round" />
            <circle cx="6" cy="17" r="1.8" fill="currentColor" />
            <circle cx="17" cy="17" r="1.8" fill="currentColor" />
          </svg>
          <div>
            <h1>Bin packing demo</h1>
            <p className="subtle">Load every shipment into the fewest trucks</p>
          </div>
        </div>
        <div className="header-controls">
          <fieldset className="segmented" aria-label="Colour theme">
            {THEMES.map(([value, label]) => (
              <label key={value}>
                <input type="radio" name="theme" value={value} checked={theme === value}
                       onChange={() => onTheme(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    </header>
  );
}

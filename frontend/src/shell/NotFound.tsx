import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="app">
      <div className="card">
        <h1>Page not found</h1>
        <p><Link to="/">Go to the start page</Link></p>
      </div>
    </div>
  );
}

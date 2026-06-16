// Raw-text asset imports (`import x from "./y.md" with { type: "text" }`). Bun
// ships an ambient type for `*.html` (HTMLBundle) but not for `*.md`/`*.css`, so
// we declare those here. The `type: "text"` attribute makes Bun hand back the
// file contents as a string at runtime regardless of the declared type.
declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}
